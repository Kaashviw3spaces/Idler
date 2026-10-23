import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.agent.planner import TaskPlanner
from backend.app.db.models import WorkflowDB, WorkflowRunDB
from backend.app.schemas.models import TaskExecutionSummary, TaskStatus
from backend.app.security.paths import resolve_workspace
from backend.app.services.executor import PlanExecutor
from backend.app.services.ledger import ActionLedgerService


class WorkflowCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=128)
    description: Optional[str] = None
    query: str = Field(..., min_length=2)
    workspace_path: Optional[str] = None
    schedule_cron: Optional[str] = None


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    query: str
    workspace_path: str
    is_active: bool
    schedule_cron: Optional[str]
    created_at: str


class WorkflowService:
    def __init__(self, db: Session):
        self.db = db

    def create_workflow(self, req: WorkflowCreateRequest) -> WorkflowResponse:
        ws = resolve_workspace(req.workspace_path)
        wf_id = f"wf-{str(uuid.uuid4())[:8]}"
        wf = WorkflowDB(
            id=wf_id,
            name=req.name,
            description=req.description,
            query=req.query,
            workspace_path=str(ws),
            is_active=True,
            schedule_cron=req.schedule_cron,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.db.add(wf)
        self.db.commit()
        self.db.refresh(wf)
        return WorkflowResponse(
            id=wf.id,
            name=wf.name,
            description=wf.description,
            query=wf.query,
            workspace_path=wf.workspace_path,
            is_active=wf.is_active,
            schedule_cron=wf.schedule_cron,
            created_at=wf.created_at.isoformat(),
        )

    def list_workflows(self) -> List[WorkflowResponse]:
        wfs = self.db.query(WorkflowDB).order_by(WorkflowDB.created_at.desc()).all()
        return [
            WorkflowResponse(
                id=w.id,
                name=w.name,
                description=w.description,
                query=w.query,
                workspace_path=w.workspace_path,
                is_active=w.is_active,
                schedule_cron=w.schedule_cron,
                created_at=w.created_at.isoformat() if w.created_at else "",
            )
            for w in wfs
        ]

    async def run_workflow(self, workflow_id: str) -> TaskExecutionSummary:
        """
        Revalidates paths and security constraints before running the saved workflow.
        """
        wf = self.db.query(WorkflowDB).filter(WorkflowDB.id == workflow_id).first()
        if not wf:
            raise ValueError(f"Workflow '{workflow_id}' not found")

        # Step 1: Revalidate workspace path
        workspace_root = resolve_workspace(wf.workspace_path)

        # Step 2: Create new task plan
        planner = TaskPlanner(workspace_hint=str(workspace_root))
        plan = await planner.create_plan(wf.query)

        ledger = ActionLedgerService(self.db)
        ledger.create_task(plan)
        ledger.update_task_status(plan.task_id, TaskStatus.APPROVED)

        # Step 3: Execute plan
        executor = PlanExecutor(workspace_root=workspace_root)
        summary = executor.execute_plan(task_id=plan.task_id, actions=plan.actions)

        # Step 4: Record action results
        for res in summary.results:
            ledger.record_action_result(res)

        ledger.update_task_status(plan.task_id, summary.status)

        # Step 5: Record workflow run
        run_record = WorkflowRunDB(
            id=f"run-{str(uuid.uuid4())[:8]}",
            workflow_id=wf.id,
            task_id=plan.task_id,
            status=summary.status.value,
            error=None if summary.status == TaskStatus.COMPLETED else "Some actions failed or were skipped",
            created_at=datetime.utcnow(),
        )
        self.db.add(run_record)
        self.db.commit()

        # Step 6: Play native audio chime when background task / workflow finishes
        try:
            from backend.app.services.sound import play_system_chime
            play_system_chime()
        except Exception:
            pass

        return summary

    def delete_workflow(self, workflow_id: str) -> bool:
        """Deletes a saved workflow and its associated run records."""
        wf = self.db.query(WorkflowDB).filter(WorkflowDB.id == workflow_id).first()
        if not wf:
            raise ValueError(f"Workflow '{workflow_id}' not found")
        # Delete associated runs first
        self.db.query(WorkflowRunDB).filter(WorkflowRunDB.workflow_id == workflow_id).delete()
        self.db.delete(wf)
        self.db.commit()
        return True

    def toggle_workflow(self, workflow_id: str) -> WorkflowResponse:
        """Toggles the is_active status of a workflow between active and paused."""
        wf = self.db.query(WorkflowDB).filter(WorkflowDB.id == workflow_id).first()
        if not wf:
            raise ValueError(f"Workflow '{workflow_id}' not found")
        wf.is_active = not wf.is_active
        wf.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(wf)
        return WorkflowResponse(
            id=wf.id,
            name=wf.name,
            description=wf.description,
            query=wf.query,
            workspace_path=wf.workspace_path,
            is_active=wf.is_active,
            schedule_cron=wf.schedule_cron,
            created_at=wf.created_at.isoformat() if wf.created_at else "",
        )


