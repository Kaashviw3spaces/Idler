import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from sqlalchemy.orm import Session

from backend.app.db.models import ActionDB, TaskDB
from backend.app.schemas.models import (
    ActionResult,
    ActionStatus,
    ActionType,
    PlanResponse,
    TaskStatus,
)
from backend.app.tools.files import move_file_safely


class ActionLedgerService:
    def __init__(self, db: Session):
        self.db = db

    def create_task(self, plan: PlanResponse) -> TaskDB:
        """Records a new task and its plan in the database."""
        task = TaskDB(
            id=plan.task_id,
            query=plan.query,
            workspace_path=plan.workspace_path,
            status=plan.status.value,
            plan_json=json.dumps([a.model_dump() for a in plan.actions]),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.db.add(task)

        # Pre-record planned actions as pending
        for action in plan.actions:
            act_db = ActionDB(
                id=action.id,
                task_id=plan.task_id,
                action_type=action.type.value,
                status=ActionStatus.PENDING.value,
                source=action.source,
                destination=action.destination,
                message=action.reason,
                rollback_supported=False,
                is_undone=False,
            )
            self.db.add(act_db)

        self.db.commit()
        self.db.refresh(task)
        return task

    def update_task_status(self, task_id: str, status: TaskStatus) -> Optional[TaskDB]:
        task = self.db.query(TaskDB).filter(TaskDB.id == task_id).first()
        if task:
            task.status = status.value
            task.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(task)
        return task

    def record_action_result(self, result: ActionResult) -> Optional[ActionDB]:
        """Updates the recorded action with its execution result and rollback metadata."""
        act_db = self.db.query(ActionDB).filter(ActionDB.id == result.action_id).first()
        if not act_db:
            return None

        act_db.status = result.status.value
        act_db.message = result.message
        act_db.error = result.error
        act_db.rollback_supported = result.rollback_supported
        if result.rollback_metadata:
            act_db.rollback_metadata_json = json.dumps(result.rollback_metadata)
        act_db.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(act_db)
        return act_db

    def list_actions(self, limit: int = 50, task_id: Optional[str] = None) -> List[ActionDB]:
        query = self.db.query(ActionDB)
        if task_id:
            query = query.filter(ActionDB.task_id == task_id)
        return query.order_by(ActionDB.created_at.desc()).limit(limit).all()

    def get_action(self, action_id: str) -> Optional[ActionDB]:
        return self.db.query(ActionDB).filter(ActionDB.id == action_id).first()

    def undo_action(self, action_id: str, workspace_root: Path) -> ActionResult:
        """
        Safely attempts to roll back an action:
        1. Confirms rollback is supported and not already undone.
        2. Validates that current file is present at its destination.
        3. Validates that original source location does not exist (no collision/overwriting newer work).
        4. Moves the file back to original location.
        5. Records the undo event in the database ledger without destroying original audit history.
        """
        action = self.get_action(action_id)
        if not action:
            return ActionResult(
                action_id=action_id,
                action_type=ActionType.MOVE_FILE,
                status=ActionStatus.FAILED,
                message="Action not found in ledger.",
                rollback_supported=False,
            )

        if not action.rollback_supported or not action.rollback_metadata_json:
            return ActionResult(
                action_id=action_id,
                action_type=ActionType(action.action_type),
                status=ActionStatus.FAILED,
                message="This action does not support rollback.",
                rollback_supported=False,
            )

        if action.is_undone:
            return ActionResult(
                action_id=action_id,
                action_type=ActionType(action.action_type),
                status=ActionStatus.SKIPPED,
                message="This action has already been rolled back.",
                rollback_supported=False,
            )

        metadata = json.loads(action.rollback_metadata_json)
        original_source_rel = metadata["original_source"]
        original_dest_rel = metadata["original_destination"]

        # Current location is original_dest_rel; target to restore to is original_source_rel
        undo_res = move_file_safely(
            action_id=f"undo-{str(uuid.uuid4())[:8]}",
            source_rel=original_dest_rel,
            dest_rel=original_source_rel,
            workspace_root=workspace_root,
        )

        if undo_res.status == ActionStatus.COMPLETED:
            # Mark original action as undone
            action.is_undone = True
            action.status = ActionStatus.ROLLED_BACK.value
            action.updated_at = datetime.utcnow()

            # Record the undo event as a new audit record
            undo_record = ActionDB(
                id=undo_res.action_id,
                task_id=action.task_id,
                action_type="undo_" + action.action_type,
                status=ActionStatus.COMPLETED.value,
                source=original_dest_rel,
                destination=original_source_rel,
                message=f"Rolled back action {action.id}",
                rollback_supported=False,
                is_undone=False,
            )
            self.db.add(undo_record)
            self.db.commit()

            return ActionResult(
                action_id=action.id,
                action_type=ActionType(action.action_type),
                status=ActionStatus.ROLLED_BACK,
                source=original_dest_rel,
                destination=original_source_rel,
                message=f"Successfully undone action {action.id}. Restored file to '{original_source_rel}'",
                rollback_supported=False,
            )
        else:
            return ActionResult(
                action_id=action.id,
                action_type=ActionType(action.action_type),
                status=ActionStatus.FAILED,
                source=original_dest_rel,
                destination=original_source_rel,
                message=f"Rollback failed: {undo_res.message}",
                error=undo_res.error,
                rollback_supported=True,
            )

