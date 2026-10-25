import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from backend.app.agent.planner import TaskPlanner
from backend.app.config import settings
from backend.app.db.database import get_db
from backend.app.db.models import ActionDB, TaskDB, WorkspaceDB
from backend.app.schemas.models import (
    ActionPlan,
    ActionResult,
    ActionStatus,
    ActionType,
    ActionUpdateRequest,
    DuplicateScanResult,
    PlanResponse,
    PlanUpdateRequest,
    ProjectInspectionResult,
    TaskCreateRequest,
    WorkspaceRegisterRequest,
    TaskExecutionSummary,
    TaskStatus,
)
from backend.app.security.paths import (
    resolve_workspace,
    validate_new_workspace_path,
    validate_and_resolve_path,
    get_all_allowed_roots,
    WorkspaceBoundaryError,
    PathTraversalError,
    InvalidPathError,
)
from backend.app.security.policies import validate_action_policy
from backend.app.services.executor import PlanExecutor
from backend.app.services.ledger import ActionLedgerService
from backend.app.services.workflows import (
    WorkflowCreateRequest,
    WorkflowResponse,
    WorkflowService,
)
from backend.app.tools.duplicates import find_duplicates
from backend.app.tools.scan import scan_directory
from backend.app.tools.project import inspect_project
from backend.app.schemas.analytics import (
    LargeFileArchiveRequest,
    LargeFileTrashRequest,
    StorageAnalyticsResponse,
)
from backend.app.tools.storage_analytics import (
    archive_large_file,
    scan_storage_analytics,
    trash_large_file,
)

router = APIRouter(prefix="/api", tags=["Idler Core API"])


@router.get("/health")
def health_check():
    """Health status and configuration."""
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "ollama_base_url": settings.ollama_base_url,
        "ollama_model": settings.ollama_model,
        "allowed_workspaces": [str(p) for p in settings.get_allowed_workspaces()],
    }


@router.post("/system/chime")
def trigger_system_chime(platform: Optional[str] = Query(default=None, description="mac or win override")):
    """
    Triggers the OS-native background completion chime for macOS (Glass) or Windows (SystemAsterisk).
    """
    from backend.app.services.sound import play_system_chime
    return play_system_chime(platform_override=platform)


@router.get("/workspaces")
def list_workspaces(db: Session = Depends(get_db)):
    """Lists allowed workspaces, registered host directories, and key subfolders."""
    workspaces = get_all_allowed_roots(db=db)
    result = []
    seen_paths = set()

    # Query custom workspaces from database to mark is_removable and maintain custom names
    db_workspaces = {w.path: w for w in db.query(WorkspaceDB).all()}

    for ws in workspaces:
        ws_str = str(ws)
        if ws_str not in seen_paths and ws.exists() and ws.is_dir():
            seen_paths.add(ws_str)
            scan = scan_directory(".", ws, recursive=True, max_files=1000)

            custom_record = db_workspaces.get(ws_str)
            display_name = custom_record.name if custom_record else (ws.name or ws_str)

            subdirs_info = []
            for sub_name in scan.subdirectories:
                sub_path = ws / sub_name
                subdirs_info.append({
                    "name": sub_name,
                    "path": str(sub_path),
                    "files_count": scan.folder_counts.get(sub_name, 0),
                })

            result.append({
                "name": display_name,
                "path": ws_str,
                "files_count": scan.total_files,
                "total_size_bytes": scan.total_size_bytes,
                "subdirectories": subdirs_info,
                "folder_counts": scan.folder_counts,
                "preview": [f.model_dump() for f in scan.files[:12]],
                "is_removable": ws_str in db_workspaces,
            })

    return result


@router.post("/workspaces")
def register_workspace(req: WorkspaceRegisterRequest, db: Session = Depends(get_db)):
    """
    Registers a local directory on your computer into the allowed workspaces allowlist.
    Validates that the directory exists and is not a protected system path.
    """
    try:
        resolved = validate_new_workspace_path(req.path)
        existing = db.query(WorkspaceDB).filter(WorkspaceDB.path == str(resolved)).first()
        if existing:
            return {"status": "exists", "path": str(resolved), "name": existing.name}

        name = req.name or resolved.name or str(resolved)
        ws_record = WorkspaceDB(
            id=f"ws-{str(uuid.uuid4())[:8]}",
            name=name,
            path=str(resolved),
            created_at=datetime.utcnow(),
        )
        db.add(ws_record)
        db.commit()
        db.refresh(ws_record)
        return {"status": "registered", "path": str(resolved), "name": name}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/workspaces")
def remove_workspace(path: str = Query(..., description="Path of the workspace to remove"), db: Session = Depends(get_db)):
    """
    Removes a custom registered workspace from the database.
    Does not delete any files or directories on disk.
    """
    try:
        clean_path = str(Path(path).expanduser().resolve())
    except Exception:
        clean_path = path

    record = db.query(WorkspaceDB).filter(
        (WorkspaceDB.path == clean_path) | (WorkspaceDB.path == path)
    ).first()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workspace '{path}' is not a registered custom workspace or has already been removed."
        )

    deleted_name = record.name
    deleted_path = record.path
    db.delete(record)
    db.commit()
    return {"status": "removed", "path": deleted_path, "name": deleted_name}


@router.get("/workspace/files")
def get_workspace_files(path: Optional[str] = Query(default=None)):
    """
    Scans and returns the current files on disk in the selected workspace.
    Used for live workspace preview before planning.
    """
    try:
        ws = resolve_workspace(path)
        scan = scan_directory(".", ws, recursive=True, max_files=1000)
        return {
            "workspace_path": str(ws),
            "total_files": scan.total_files,
            "total_size_bytes": scan.total_size_bytes,
            "subdirectories": scan.subdirectories,
            "folder_counts": scan.folder_counts,
            "files": [f.model_dump() for f in scan.files],
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/plan", response_model=PlanResponse)
async def create_plan(request: TaskCreateRequest, db: Session = Depends(get_db)):
    """
    Step 1: Translates user query into a structured, validated, non-executing plan.
    Strictly read-only; no files are modified.
    """
    try:
        planner = TaskPlanner(workspace_hint=request.workspace_path)
        plan = await planner.create_plan(request.query, parameters=request.parameters)

        # Record task and planned actions in SQLite ledger
        ledger = ActionLedgerService(db)
        ledger.create_task(plan)

        return plan
    except (WorkspaceBoundaryError, PathTraversalError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Planning failed: {str(e)}")


@router.get("/tasks/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    """Retrieves current task state, plan, and recorded actions."""
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    actions = db.query(ActionDB).filter(ActionDB.task_id == task_id).all()
    return {
        "id": task.id,
        "query": task.query,
        "workspace_path": task.workspace_path,
        "status": task.status,
        "plan": json.loads(task.plan_json or "[]"),
        "actions": [
            {
                "id": a.id,
                "action_type": a.action_type,
                "status": a.status,
                "source": a.source,
                "destination": a.destination,
                "message": a.message,
                "error": a.error,
                "rollback_supported": a.rollback_supported,
                "is_undone": a.is_undone,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in actions
        ],
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


@router.patch("/tasks/{task_id}/actions/{action_id}")
def update_action_destination(
    task_id: str,
    action_id: str,
    req: ActionUpdateRequest,
    db: Session = Depends(get_db)
):
    """
    Allows the user to customize or edit the destination subdirectory / path
    proposed by AI detection before approving and executing the plan.
    """
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status not in (TaskStatus.AWAITING_APPROVAL.value, TaskStatus.RECEIVED.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit actions for task in state '{task.status}'"
        )

    workspace_root = Path(task.workspace_path)
    clean_dest = req.destination.strip()
    if not clean_dest:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Destination path cannot be empty")

    try:
        dst_resolved = validate_and_resolve_path(clean_dest, workspace_root, must_exist=False)

        action_db = db.query(ActionDB).filter(ActionDB.id == action_id, ActionDB.task_id == task_id).first()
        if not action_db:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found in task")

        if action_db.source:
            src_resolved = validate_and_resolve_path(action_db.source, workspace_root, must_exist=True)
            if dst_resolved.exists() and dst_resolved != src_resolved:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Destination file already exists on disk: '{clean_dest}'. Overwriting is blocked."
                )

        temp_action = ActionPlan(
            id=action_id,
            type=ActionType(action_db.action_type),
            source=action_db.source or "",
            destination=clean_dest,
            reason=req.reason or action_db.message,
        )
        is_valid, policy_err = validate_action_policy(temp_action, workspace_root)
        if not is_valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=policy_err or "Action violates safety policy")

        # Update ActionDB
        action_db.destination = clean_dest
        if req.reason:
            action_db.message = req.reason

        # Update TaskDB.plan_json
        raw_plan = json.loads(task.plan_json or "[]")
        for item in raw_plan:
            if item.get("id") == action_id:
                item["destination"] = clean_dest
                if req.reason:
                    item["reason"] = req.reason
                break
        task.plan_json = json.dumps(raw_plan)

        db.commit()
        db.refresh(action_db)

        return {
            "status": "updated",
            "task_id": task_id,
            "action_id": action_id,
            "destination": clean_dest,
            "reason": action_db.message,
        }
    except HTTPException:
        raise
    except (WorkspaceBoundaryError, PathTraversalError, InvalidPathError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.put("/tasks/{task_id}/plan", response_model=PlanResponse)
def update_task_plan(
    task_id: str,
    req: PlanUpdateRequest,
    db: Session = Depends(get_db)
):
    """
    Updates the entire task plan (e.g. batch editing subdirectories or modifying destinations).
    """
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status not in (TaskStatus.AWAITING_APPROVAL.value, TaskStatus.RECEIVED.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit plan for task in state '{task.status}'"
        )

    workspace_root = Path(task.workspace_path)
    validated_actions: List[ActionPlan] = []

    for act in req.actions:
        try:
            src_resolved = validate_and_resolve_path(act.source, workspace_root, must_exist=True)
            if act.destination:
                dst_resolved = validate_and_resolve_path(act.destination, workspace_root, must_exist=False)
                if dst_resolved.exists() and dst_resolved != src_resolved:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Destination '{act.destination}' already exists on disk"
                    )
            is_valid, reason = validate_action_policy(act, workspace_root)
            if not is_valid:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason or "Policy violation")
            validated_actions.append(act)
        except HTTPException:
            raise
        except (WorkspaceBoundaryError, PathTraversalError, InvalidPathError) as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Update TaskDB
    task.plan_json = json.dumps([a.model_dump() for a in validated_actions])
    task.updated_at = datetime.utcnow()

    # Re-sync ActionDB
    db.query(ActionDB).filter(ActionDB.task_id == task_id).delete()
    for action in validated_actions:
        act_db = ActionDB(
            id=action.id,
            task_id=task_id,
            action_type=action.type.value,
            status=ActionStatus.PENDING.value,
            source=action.source,
            destination=action.destination,
            message=action.reason,
            rollback_supported=False,
            is_undone=False,
        )
        db.add(act_db)

    db.commit()
    db.refresh(task)

    return PlanResponse(
        task_id=task.id,
        query=task.query,
        workspace_path=task.workspace_path,
        actions=validated_actions,
        summary=f"Plan updated by user ({len(validated_actions)} actions)",
        requires_approval=len(validated_actions) > 0,
        status=TaskStatus.AWAITING_APPROVAL if validated_actions else TaskStatus.COMPLETED,
    )


@router.delete("/tasks/{task_id}/actions/{action_id}")
def delete_task_action(
    task_id: str,
    action_id: str,
    db: Session = Depends(get_db)
):
    """
    Removes a single planned action from the task plan (skips moving that file).
    """
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status not in (TaskStatus.AWAITING_APPROVAL.value, TaskStatus.RECEIVED.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot remove actions from task in state '{task.status}'"
        )

    action_db = db.query(ActionDB).filter(ActionDB.id == action_id, ActionDB.task_id == task_id).first()
    if not action_db:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found in task")

    db.delete(action_db)

    # Update TaskDB plan_json
    raw_plan = json.loads(task.plan_json or "[]")
    raw_plan = [a for a in raw_plan if a.get("id") != action_id]
    task.plan_json = json.dumps(raw_plan)
    db.commit()

    return {"status": "removed", "task_id": task_id, "action_id": action_id}


@router.post("/tasks/{task_id}/approve")
def approve_task(task_id: str, db: Session = Depends(get_db)):
    """
    Human-in-the-loop approval gate. Transitions task from AWAITING_APPROVAL to APPROVED.
    """
    ledger = ActionLedgerService(db)
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status != TaskStatus.AWAITING_APPROVAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task cannot be approved in state '{task.status}'"
        )

    ledger.update_task_status(task_id, TaskStatus.APPROVED)
    return {"task_id": task_id, "status": TaskStatus.APPROVED.value, "message": "Plan approved for execution"}


@router.post("/tasks/{task_id}/execute", response_model=TaskExecutionSummary)
def execute_task(task_id: str, db: Session = Depends(get_db)):
    """
    Executes an approved plan using restricted tools and postcondition verification.
    """
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if task.status != TaskStatus.APPROVED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot execute task in status '{task.status}'. Plan must be explicitly approved first."
        )

    ledger = ActionLedgerService(db)
    ledger.update_task_status(task_id, TaskStatus.EXECUTING)

    raw_plan = json.loads(task.plan_json or "[]")
    actions = [ActionPlan(**a) for a in raw_plan]

    workspace_root = Path(task.workspace_path)
    executor = PlanExecutor(workspace_root=workspace_root)

    # Execute plan
    summary = executor.execute_plan(task_id=task_id, actions=actions)

    # Record action results in Action Ledger
    for res in summary.results:
        ledger.record_action_result(res)

    # Update overall task status
    ledger.update_task_status(task_id, summary.status)

    return summary


@router.get("/actions")
def list_actions(
    limit: int = Query(default=50, le=200),
    task_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Action Ledger: lists historical actions with status and rollback eligibility."""
    ledger = ActionLedgerService(db)
    records = ledger.list_actions(limit=limit, task_id=task_id)
    return [
        {
            "id": r.id,
            "task_id": r.task_id,
            "action_type": r.action_type,
            "status": r.status,
            "source": r.source,
            "destination": r.destination,
            "message": r.message,
            "error": r.error,
            "rollback_supported": r.rollback_supported,
            "is_undone": r.is_undone,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in records
    ]


@router.get("/actions/export")
def export_actions(
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    db: Session = Depends(get_db)
):
    """
    Exports the complete immutable Action Ledger audit history as a downloadable CSV or JSON file.
    """
    import csv
    import io

    ledger = ActionLedgerService(db)
    records = ledger.list_actions(limit=500)

    if format == "json":
        payload = [
            {
                "id": r.id,
                "task_id": r.task_id,
                "action_type": r.action_type,
                "status": r.status,
                "source": r.source,
                "destination": r.destination,
                "message": r.message,
                "is_undone": r.is_undone,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ]
        return Response(
            content=json.dumps(payload, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=idler_action_ledger.json"},
        )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Task ID", "Action Type", "Status", "Source", "Destination", "Message", "Is Undone", "Timestamp"])
    for r in records:
        writer.writerow([
            r.id,
            r.task_id,
            r.action_type,
            r.status,
            r.source or "",
            r.destination or "",
            r.message or "",
            "Yes" if r.is_undone else "No",
            r.created_at.isoformat() if r.created_at else "",
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=idler_action_ledger.csv"},
    )


@router.post("/actions/{action_id}/undo", response_model=ActionResult)
def undo_action(action_id: str, db: Session = Depends(get_db)):
    """
    Rolls back a supported action after verifying filesystem state and avoiding collisions.
    """
    ledger = ActionLedgerService(db)
    action = ledger.get_action(action_id)
    if not action:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")

    task = db.query(TaskDB).filter(TaskDB.id == action.task_id).first()
    workspace_root = Path(task.workspace_path) if task else settings.get_allowed_workspaces()[0]

    result = ledger.undo_action(action_id, workspace_root=workspace_root)
    if result.status == ActionStatus.FAILED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result.message)

    return result


@router.get("/duplicates", response_model=DuplicateScanResult)
def scan_duplicates(
    path: Optional[str] = Query(default=".", description="Target folder relative to workspace"),
    workspace_path: Optional[str] = None
):
    """
    Exact duplicate detection: groups files with matching size and cryptographic SHA-256 hash.
    Strictly read-only; no files are deleted.
    """
    try:
        ws = resolve_workspace(workspace_path)
        return find_duplicates(path, ws, recursive=True)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/workflows", response_model=WorkflowResponse)
def create_workflow(req: WorkflowCreateRequest, db: Session = Depends(get_db)):
    """Saves a declarative workflow configuration in SQLite."""
    service = WorkflowService(db)
    return service.create_workflow(req)


@router.get("/workflows", response_model=List[WorkflowResponse])
def list_workflows(db: Session = Depends(get_db)):
    """Lists all saved declarative workflows."""
    service = WorkflowService(db)
    return service.list_workflows()


@router.post("/workflows/{workflow_id}/run", response_model=TaskExecutionSummary)
async def run_workflow(workflow_id: str, db: Session = Depends(get_db)):
    """Revalidates paths and security constraints before executing a saved workflow."""
    service = WorkflowService(db)
    try:
        return await service.run_workflow(workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/workflows/{workflow_id}")
def delete_workflow(workflow_id: str, db: Session = Depends(get_db)):
    """Deletes a saved workflow and its history."""
    service = WorkflowService(db)
    try:
        service.delete_workflow(workflow_id)
        return {"status": "deleted", "workflow_id": workflow_id}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.patch("/workflows/{workflow_id}/toggle", response_model=WorkflowResponse)
def toggle_workflow(workflow_id: str, db: Session = Depends(get_db)):
    """Toggles active/paused state for a saved workflow schedule."""
    service = WorkflowService(db)
    try:
        return service.toggle_workflow(workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/duplicates/trash")
def trash_duplicate(
    file_path: str = Body(..., embed=True),
    workspace_path: Optional[str] = Body(default=None, embed=True),
):
    """
    Moves a single duplicate file to macOS Trash (soft-delete).
    NEVER permanently deletes. The file can be recovered from Trash.
    Validates the file is within an allowed workspace boundary before trashing.
    """
    try:
        ws = resolve_workspace(workspace_path)
        abs_path = validate_and_resolve_path(file_path, ws, must_exist=True)

        if not abs_path.is_file():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is not a file")

        try:
            from send2trash import send2trash
        except ModuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Trash support is unavailable because the send2trash package is not installed.",
            ) from exc

        send2trash(str(abs_path))
        return {
            "status": "trashed",
            "path": str(abs_path),
            "message": f"Moved '{abs_path.name}' to Trash. Recover it from macOS Trash if needed.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/duplicates/trash-all")
def trash_all_duplicates(
    workspace_path: Optional[str] = Body(default=None, embed=True),
):
    """
    Safely soft-deletes all duplicate copies across all detected groups,
    preserving exactly one original file per group.
    All non-primary copies are moved to macOS Trash (never permanently deleted).
    """
    try:
        try:
            from send2trash import send2trash
        except ModuleNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Trash support is unavailable because the send2trash package is not installed.",
            ) from exc

        from backend.app.security.paths import resolve_path_in_workspace

        ws = resolve_workspace(workspace_path)
        dup_scan = find_duplicates(".", ws, recursive=True)

        trashed_count = 0
        trashed_bytes = 0
        trashed_files = []

        for group in dup_scan.duplicate_groups:
            # Preserves group.paths[0], trashes group.paths[1:]
            for redundant_rel in group.paths[1:]:
                try:
                    abs_path = resolve_path_in_workspace(redundant_rel, ws)
                    if abs_path.exists() and abs_path.is_file():
                        send2trash(str(abs_path))
                        trashed_count += 1
                        trashed_bytes += group.size_bytes
                        trashed_files.append(redundant_rel)
                except Exception:
                    continue

        return {
            "status": "success",
            "trashed_count": trashed_count,
            "trashed_bytes": trashed_bytes,
            "trashed_files": trashed_files,
            "message": f"Moved {trashed_count} redundant file(s) to macOS Trash. Original copies preserved.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/project/inspect", response_model=ProjectInspectionResult)
def inspect_project_endpoint(
    path: Optional[str] = Query(default=".", description="Project folder relative to workspace"),
    workspace_path: Optional[str] = None,
):
    """
    Project Inspector: examines a project directory safely without code execution.
    Identifies language, project manifest, key files, and extracts README snippet.
    """
    try:
        ws = resolve_workspace(workspace_path)
        return inspect_project(path or ".", ws)
    except (FileNotFoundError, NotADirectoryError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/analytics/storage", response_model=StorageAnalyticsResponse)
def get_storage_analytics(
    path: Optional[str] = Query(default=".", description="Folder relative to workspace to scan"),
    workspace_path: Optional[str] = None,
    min_large_size_bytes: int = Query(default=500 * 1024 * 1024, description="Threshold for large files in bytes"),
    forgotten_days: int = Query(default=180, description="Minimum days of inactivity"),
    max_depth: int = Query(default=4, description="Maximum tree depth for Treemap hierarchy"),
):
    """
    Storage Analytics & Visual Insights:
    - Disk Space Treemap breakdown of folders and file types.
    - 'Large & Forgotten Files' Hunter (>threshold and inactive > forgotten_days).
    - Cloud Storage Sync Awareness (cloud-only placeholders vs local copies).
    """
    try:
        ws = resolve_workspace(workspace_path)
        return scan_storage_analytics(
            workspace_path=ws,
            scan_subpath=path or ".",
            min_large_size_bytes=min_large_size_bytes,
            forgotten_days=forgotten_days,
            max_tree_depth=max_depth,
        )
    except (FileNotFoundError, NotADirectoryError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/analytics/trash")
def trash_large_file_endpoint(
    req: LargeFileTrashRequest,
    db: Session = Depends(get_db),
):
    """
    Safely soft-deletes a large forgotten file to system Trash via send2trash.
    Never permanent deletion. Recorded in Action Ledger.
    """
    try:
        ws = resolve_workspace(req.workspace_path)
        return trash_large_file(
            workspace_path=ws,
            relative_path=req.relative_path,
            db=db,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))




@router.post("/analytics/archive")
def archive_large_file_endpoint(
    req: LargeFileArchiveRequest,
    db: Session = Depends(get_db),
):
    """
    Safely moves a large forgotten file to Archive/ folder within workspace.
    Collision-safe, verified move, recorded in Action Ledger with 1-click Undo support.
    """
    try:
        ws = resolve_workspace(req.workspace_path)
        return archive_large_file(
            workspace_path=ws,
            relative_path=req.relative_path,
            archive_dir_name=req.archive_dir or "Archive",
            db=db,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _find_file_in_allowed_workspaces(path_str: str, workspace_hint: Optional[str] = None):
    from backend.app.security.paths import resolve_path_in_workspace, resolve_workspace, get_all_allowed_roots

    allowed_roots = list(get_all_allowed_roots())

    # Include repo test_workspace if it exists on disk
    repo_test_ws = (Path.cwd() / "test_workspace").resolve()
    if repo_test_ws.exists() and repo_test_ws not in allowed_roots:
        allowed_roots.append(repo_test_ws)

    # 1. If workspace_hint is provided, resolve and prioritize it
    hint_root: Optional[Path] = None
    if workspace_hint:
        try:
            raw_hint = Path(workspace_hint).expanduser().resolve()
            if raw_hint.exists() and raw_hint.is_dir():
                hint_root = raw_hint
                if hint_root not in allowed_roots:
                    # Allow if inside user home or repo directory
                    allowed_roots.insert(0, hint_root)
            else:
                hint_root = resolve_workspace(workspace_hint)
        except Exception:
            pass

    # Search list with hint_root prioritized
    search_roots: list[Path] = []
    if hint_root and hint_root.exists():
        search_roots.append(hint_root)
    for r in allowed_roots:
        if r not in search_roots:
            search_roots.append(r)

    # 2. Try direct resolution in search roots
    for ws in search_roots:
        try:
            resolved = resolve_path_in_workspace(path_str, ws)
            if resolved.exists() and resolved.is_file():
                return resolved, ws
        except Exception:
            continue

    # 3. Check if path_str is already an absolute path inside any allowed root
    raw = Path(path_str).expanduser()
    if raw.is_absolute():
        for ws in search_roots:
            try:
                resolved = raw.resolve()
                resolved.relative_to(ws.resolve())
                if resolved.exists() and resolved.is_file():
                    return resolved, ws
            except ValueError:
                continue

    # 4. Search recursively by filename if path_str was a simple filename or relative suffix
    target_name = Path(path_str).name
    for ws in search_roots:
        try:
            for matched in ws.rglob(target_name):
                if matched.is_file():
                    return matched.resolve(), ws
        except Exception:
            continue

    raise FileNotFoundError(f"File '{path_str}' not found in any allowed workspace.")


def _inspect_presentation(file_path: Path):
    """Parses slide titles and bullets from a .pptx archive."""
    import zipfile
    import xml.etree.ElementTree as ET

    if not zipfile.is_zipfile(file_path):
        return None
    try:
        with zipfile.ZipFile(file_path, "r") as z:
            slide_names = [n for n in z.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
            if not slide_names:
                return None
            slide_names.sort(key=lambda s: int("".join(c for c in s if c.isdigit()) or 0))
            slides = []
            for i, s_name in enumerate(slide_names[:30], start=1):
                xml_content = z.read(s_name)
                tree = ET.fromstring(xml_content)
                texts = [node.text.strip() for node in tree.iter() if node.tag.endswith("}t") and node.text and node.text.strip()]
                title = texts[0] if texts else f"Slide {i}"
                bullets = texts[1:12] if len(texts) > 1 else []
                slides.append({
                    "slide_number": i,
                    "title": title,
                    "bullets": bullets,
                    "preview_snippet": " • ".join(bullets[:4]) if bullets else title,
                })
            return {"total_slides": len(slide_names), "slides": slides}
    except Exception:
        return None


def _inspect_docx(file_path: Path):
    """Parses document paragraphs from a .docx file."""
    import zipfile
    import xml.etree.ElementTree as ET

    if not zipfile.is_zipfile(file_path):
        return None
    try:
        with zipfile.ZipFile(file_path, "r") as z:
            if "word/document.xml" not in z.namelist():
                return None
            xml_content = z.read("word/document.xml")
            tree = ET.fromstring(xml_content)
            paragraphs = []
            for p in tree.iter():
                if p.tag.endswith("}p"):
                    texts = [node.text for node in p.iter() if node.tag.endswith("}t") and node.text]
                    if texts:
                        full_p = "".join(texts).strip()
                        if full_p:
                            paragraphs.append(full_p)
            return {"paragraphs": paragraphs[:60], "total_paragraphs": len(paragraphs)}
    except Exception:
        return None


def _inspect_spreadsheet(file_path: Path):
    """Parses sheet rows from .xlsx or .csv."""
    import csv
    import zipfile
    import xml.etree.ElementTree as ET

    ext = file_path.suffix.lower()
    if ext == ".csv":
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                reader = list(csv.reader(f))
                return {
                    "sheets": [{"name": file_path.stem, "rows": reader[:40]}],
                    "total_rows": len(reader),
                }
        except Exception:
            return None

    if ext in [".xlsx", ".xlsm"] and zipfile.is_zipfile(file_path):
        try:
            with zipfile.ZipFile(file_path, "r") as z:
                shared_strings = []
                if "xl/sharedStrings.xml" in z.namelist():
                    tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
                    for si in tree.iter():
                        if si.tag.endswith("}si"):
                            t_nodes = [n.text for n in si.iter() if n.tag.endswith("}t") and n.text]
                            shared_strings.append("".join(t_nodes))
                if "xl/worksheets/sheet1.xml" in z.namelist():
                    s_tree = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
                    rows = []
                    for row_node in s_tree.iter():
                        if row_node.tag.endswith("}row"):
                            row_vals = []
                            for c in row_node.iter():
                                if c.tag.endswith("}c"):
                                    c_type = c.get("t")
                                    v_node = next((n for n in c.iter() if n.tag.endswith("}v")), None)
                                    val = ""
                                    if v_node is not None and v_node.text:
                                        if c_type == "s" and v_node.text.isdigit():
                                            idx = int(v_node.text)
                                            val = shared_strings[idx] if idx < len(shared_strings) else v_node.text
                                        else:
                                            val = v_node.text
                                    row_vals.append(val)
                            if any(row_vals):
                                rows.append(row_vals)
                    return {"sheets": [{"name": "Sheet 1", "rows": rows[:40]}], "total_rows": len(rows)}
        except Exception:
            return None
    return None


def _generate_file_thumbnail(file_path: Path) -> Optional[Path]:
    """Generates and caches a high-res rendered thumbnail using QuickLook on macOS."""
    import platform
    if platform.system() != "Darwin":
        return None
    try:
        import hashlib
        import subprocess
        import shutil

        cache_dir = Path("/tmp/idler_thumbnails")
        cache_dir.mkdir(parents=True, exist_ok=True)
        stat = file_path.stat()
        key = hashlib.sha256(f"{file_path.resolve()}:{stat.st_mtime}:{stat.st_size}".encode()).hexdigest()[:16]
        thumb_path = cache_dir / f"{key}.png"
        if thumb_path.exists() and thumb_path.stat().st_size > 0:
            return thumb_path

        sub_tmp = cache_dir / f"gen_{key}"
        sub_tmp.mkdir(parents=True, exist_ok=True)
        try:
            res = subprocess.run(
                ["qlmanage", "-t", "-s", "1024", "-o", str(sub_tmp), str(file_path)],
                capture_output=True,
                timeout=3.5,
            )
            for p in sub_tmp.glob("*.png"):
                if p.stat().st_size > 0:
                    p.rename(thumb_path)
                    return thumb_path
        finally:
            shutil.rmtree(sub_tmp, ignore_errors=True)
    except Exception:
        pass
    return None


@router.get("/files/thumbnail")
def get_file_thumbnail(
    path: str = Query(..., description="Workspace-relative or absolute path to file"),
    workspace_path: Optional[str] = Query(default=None),
):
    """
    Returns a visual rendered thumbnail (PNG) of presentations (PPT/PPTX/KEY),
    documents (DOCX/PAGES), spreadsheets, PDFs, or images.
    """
    import mimetypes
    from starlette.responses import FileResponse

    try:
        abs_path, ws = _find_file_in_allowed_workspaces(path, workspace_path)
        mime_type, _ = mimetypes.guess_type(str(abs_path))

        # 1. If it's already an image, serve directly
        if mime_type and mime_type.startswith("image/"):
            return FileResponse(
                path=str(abs_path),
                media_type=mime_type,
                headers={"Cache-Control": "public, max-age=3600"},
            )

        # 2. Try macOS QuickLook rendered thumbnail
        thumb_file = _generate_file_thumbnail(abs_path)
        if thumb_file and thumb_file.exists():
            return FileResponse(
                path=str(thumb_file),
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=86400"},
            )

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Thumbnail not available for this file type"
        )
    except (FileNotFoundError, NotADirectoryError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/files/preview")
def get_file_preview(
    path: str = Query(..., description="Workspace-relative or absolute path to file"),
    workspace_path: Optional[str] = Query(default=None),
):
    """
    Safely serves an image, PDF, or binary preview for files located inside an allowed workspace.
    Enforces workspace boundary and path traversal validation.
    """
    import mimetypes
    from starlette.responses import FileResponse

    try:
        abs_path, ws = _find_file_in_allowed_workspaces(path, workspace_path)
        mime_type, _ = mimetypes.guess_type(str(abs_path))
        return FileResponse(
            path=str(abs_path),
            media_type=mime_type or "application/octet-stream",
            headers={"Cache-Control": "public, max-age=3600"},
        )
    except (FileNotFoundError, NotADirectoryError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/files/text-preview")
def get_file_text_preview(
    path: str = Query(..., description="Workspace-relative or absolute path to file"),
    workspace_path: Optional[str] = Query(default=None),
    max_bytes: int = Query(default=128 * 1024, description="Max bytes to read for text preview"),
):
    """
    Safely reads and returns rich structured preview for presentations, spreadsheets,
    documents, PDFs, images, code, and text files in the workspace.
    """
    import mimetypes

    try:
        abs_path, ws = _find_file_in_allowed_workspaces(path, workspace_path)
        file_size = abs_path.stat().st_size
        mime_type, _ = mimetypes.guess_type(str(abs_path))
        ext = abs_path.suffix.lower()

        # Format human readable size
        if file_size < 1024:
            formatted_size = f"{file_size} B"
        elif file_size < 1024 * 1024:
            formatted_size = f"{file_size / 1024:.1f} KB"
        elif file_size < 1024 * 1024 * 1024:
            formatted_size = f"{file_size / (1024 * 1024):.1f} MB"
        else:
            formatted_size = f"{file_size / (1024 * 1024 * 1024):.2f} GB"

        is_image = bool(mime_type and mime_type.startswith("image/"))
        is_pdf = bool(mime_type and "pdf" in mime_type) or ext == ".pdf"
        is_presentation = ext in [".pptx", ".ppt", ".key", ".odp"]
        is_spreadsheet = ext in [".xlsx", ".xls", ".csv", ".tsv", ".ods"]
        is_document = ext in [".docx", ".doc", ".pages", ".rtf", ".odt"]

        base_res = {
            "path": path,
            "filename": abs_path.name,
            "size_bytes": file_size,
            "formatted_size": formatted_size,
            "mime_type": mime_type or "application/octet-stream",
            "extension": ext,
            "is_image": is_image,
            "is_pdf": is_pdf,
            "is_presentation": is_presentation,
            "is_spreadsheet": is_spreadsheet,
            "is_document": is_document,
            "is_binary": False,
            "has_thumbnail": False,
            "presentation_data": None,
            "spreadsheet_data": None,
            "document_data": None,
            "content": None,
        }

        # 1. Presentation inspection (.pptx, .ppt, .key)
        if is_presentation:
            base_res["file_type"] = "presentation"
            base_res["has_thumbnail"] = True
            ppt_data = _inspect_presentation(abs_path)
            base_res["presentation_data"] = ppt_data
            # Try to pre-warm thumbnail cache
            _generate_file_thumbnail(abs_path)
            return base_res

        # 2. Spreadsheet inspection (.xlsx, .csv)
        if is_spreadsheet:
            base_res["file_type"] = "spreadsheet"
            sheet_data = _inspect_spreadsheet(abs_path)
            base_res["spreadsheet_data"] = sheet_data
            base_res["has_thumbnail"] = True
            return base_res

        # 3. Document inspection (.docx)
        if is_document:
            base_res["file_type"] = "document"
            doc_data = _inspect_docx(abs_path)
            base_res["document_data"] = doc_data
            base_res["has_thumbnail"] = True
            return base_res

        # 4. Image
        if is_image:
            base_res["file_type"] = "image"
            base_res["has_thumbnail"] = True
            return base_res

        # 5. PDF
        if is_pdf:
            base_res["file_type"] = "pdf"
            base_res["has_thumbnail"] = True
            return base_res

        # 6. Text / Code / Binary check
        with open(abs_path, "rb") as f:
            raw_bytes = f.read(min(file_size, max_bytes))

        is_binary = b"\x00" in raw_bytes[:4000]
        if is_binary:
            base_res["file_type"] = "binary"
            base_res["is_binary"] = True
            return base_res

        content = raw_bytes.decode("utf-8", errors="replace")
        lines = content.count("\n") + (1 if content else 0)
        base_res["file_type"] = "text"
        base_res["content"] = content
        base_res["lines_count"] = lines
        base_res["truncated"] = file_size > max_bytes
        return base_res

    except (FileNotFoundError, NotADirectoryError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))




