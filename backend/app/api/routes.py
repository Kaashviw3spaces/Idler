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
    DuplicateScanResult,
    PlanResponse,
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
)
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
            scan = scan_directory(".", ws, recursive=False, max_files=50)

            custom_record = db_workspaces.get(ws_str)
            display_name = custom_record.name if custom_record else (ws.name or ws_str)

            result.append({
                "name": display_name,
                "path": ws_str,
                "files_count": scan.total_files,
                "total_size_bytes": scan.total_size_bytes,
                "preview": [f.model_dump() for f in scan.files[:10]],
                "is_removable": ws_str in db_workspaces,
            })

            # Only auto-discover immediate subdirectories for internal test_workspace fixture
            if "test_workspace" in ws_str:
                try:
                    for sub in ws.iterdir():
                        sub_str = str(sub)
                        if sub.is_dir() and not sub.name.startswith(".") and sub_str not in seen_paths:
                            seen_paths.add(sub_str)
                            sub_scan = scan_directory(".", sub, recursive=False, max_files=50)
                            result.append({
                                "name": f"{ws.name}/{sub.name}",
                                "path": sub_str,
                                "files_count": sub_scan.total_files,
                                "total_size_bytes": sub_scan.total_size_bytes,
                                "preview": [f.model_dump() for f in sub_scan.files[:10]],
                                "is_removable": False,
                            })
                except (OSError, PermissionError):
                    pass

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
        scan = scan_directory(".", ws, recursive=True, max_files=100)
        return {
            "workspace_path": str(ws),
            "total_files": scan.total_files,
            "total_size_bytes": scan.total_size_bytes,
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
        plan = await planner.create_plan(request.query)

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

