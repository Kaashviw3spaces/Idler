import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.agent.planner import TaskPlanner
from backend.app.config import settings
from backend.app.db.database import get_db
from backend.app.db.models import ActionDB, TaskDB, WorkflowDB
from backend.app.schemas.models import (
    ActionPlan,
    ActionResult,
    ActionStatus,
    DuplicateScanResult,
    PlanResponse,
    TaskCreateRequest,
    TaskExecutionSummary,
    TaskStatus,
)
from backend.app.security.paths import (
    resolve_workspace,
    to_relative_path,
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
def list_workspaces():
    """Lists allowed workspaces and scans their current root content."""
    workspaces = settings.get_allowed_workspaces()
    result = []
    for ws in workspaces:
        scan = scan_directory(".", ws, recursive=False, max_files=50)
        result.append({
            "path": str(ws),
            "files_count": scan.total_files,
            "total_size_bytes": scan.total_size_bytes,
            "preview": [f.model_dump() for f in scan.files[:10]],
        })
    return result


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
