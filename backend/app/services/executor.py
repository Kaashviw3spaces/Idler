from pathlib import Path
from typing import List
from backend.app.schemas.models import (
    ActionPlan,
    ActionResult,
    ActionStatus,
    ActionType,
    TaskExecutionSummary,
    TaskStatus,
)
from backend.app.security.policies import validate_action_policy
from backend.app.tools.files import move_file_safely, rename_file_safely


class PlanExecutor:
    """
    Coordinates execution of approved actions within the workspace boundaries.
    Never evaluates arbitrary code or executes shell commands.
    """

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root

    def execute_single_action(self, action: ActionPlan) -> ActionResult:
        """Validates policy and executes one discrete action."""
        # Policy verification
        is_valid, reason = validate_action_policy(action, self.workspace_root)
        if not is_valid:
            return ActionResult(
                action_id=action.id,
                action_type=action.type,
                status=ActionStatus.FAILED,
                source=action.source,
                destination=action.destination,
                message="Action rejected by policy",
                error=reason,
                rollback_supported=False,
            )

        if action.type == ActionType.MOVE_FILE:
            if not action.destination:
                return ActionResult(
                    action_id=action.id,
                    action_type=action.type,
                    status=ActionStatus.FAILED,
                    source=action.source,
                    destination=None,
                    message="Missing destination for move_file",
                    error="Destination path is required",
                    rollback_supported=False,
                )
            return move_file_safely(
                action_id=action.id,
                source_rel=action.source,
                dest_rel=action.destination,
                workspace_root=self.workspace_root,
            )

        elif action.type == ActionType.RENAME_FILE:
            if not action.destination:
                return ActionResult(
                    action_id=action.id,
                    action_type=action.type,
                    status=ActionStatus.FAILED,
                    source=action.source,
                    destination=None,
                    message="Missing target name for rename_file",
                    error="Destination name is required",
                    rollback_supported=False,
                )
            return rename_file_safely(
                action_id=action.id,
                source_rel=action.source,
                new_name=action.destination,
                workspace_root=self.workspace_root,
            )

        return ActionResult(
            action_id=action.id,
            action_type=action.type,
            status=ActionStatus.SKIPPED,
            source=action.source,
            destination=action.destination,
            message=f"Action type '{action.type}' is a read-only or unsupported mutation in this pass.",
            rollback_supported=False,
        )

    def execute_plan(
        self,
        task_id: str,
        actions: List[ActionPlan]
    ) -> TaskExecutionSummary:
        """Executes a list of approved actions sequentially and aggregates the results."""
        results: List[ActionResult] = []
        completed = 0
        failed = 0
        skipped = 0

        for action in actions:
            res = self.execute_single_action(action)
            results.append(res)
            if res.status == ActionStatus.COMPLETED:
                completed += 1
            elif res.status == ActionStatus.FAILED:
                failed += 1
            else:
                skipped += 1

        if failed == 0 and completed > 0:
            final_status = TaskStatus.COMPLETED
        elif completed > 0 and failed > 0:
            final_status = TaskStatus.PARTIAL_FAILURE
        elif failed > 0 and completed == 0:
            final_status = TaskStatus.FAILED
        else:
            final_status = TaskStatus.COMPLETED

        return TaskExecutionSummary(
            task_id=task_id,
            status=final_status,
            total_actions=len(actions),
            completed_actions=completed,
            failed_actions=failed,
            skipped_actions=skipped,
            results=results,
        )

