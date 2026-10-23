import json
import uuid
from pathlib import Path
from typing import List, Optional
from backend.app.agent.model_client import (
    ModelClient,
    OllamaModelClient,
    MockFallbackModelClient,
    ModelClientException,
)
from backend.app.agent.prompts import SYSTEM_PLANNER_PROMPT
from backend.app.config import settings
from backend.app.schemas.models import (
    ActionPlan,
    ActionType,
    PlanResponse,
    TaskStatus,
)
from backend.app.security.paths import (
    resolve_workspace,
    validate_and_resolve_path,
    to_relative_path,
)
from backend.app.security.policies import validate_action_policy
from backend.app.tools.scan import scan_directory
from backend.app.tools.classify import classify_file_by_extension


class TaskPlanner:
    def __init__(
        self,
        model_client: Optional[ModelClient] = None,
        workspace_hint: Optional[str] = None,
        workspace_root: Optional[Path] = None,
    ):
        if workspace_root:
            self.workspace_root = workspace_root.resolve()
        else:
            self.workspace_root = resolve_workspace(workspace_hint)
        if model_client:
            self.model_client = model_client
        elif settings.use_mock_model:
            self.model_client = MockFallbackModelClient()
        else:
            self.model_client = OllamaModelClient()

    async def create_plan(self, query: str) -> PlanResponse:
        """
        Interprets natural language request, inspects workspace,
        generates structured actions, and validates all paths and security policies.
        """
        task_id = f"task-{str(uuid.uuid4())[:8]}"

        # Step 1: Scan current workspace files (bounded, read-only)
        scan_res = scan_directory(".", self.workspace_root, recursive=True, max_files=100)
        file_items = [
            {"name": f.name, "path": f.relative_path, "category": f.category, "size": f.size_bytes}
            for f in scan_res.files
        ]

        if not file_items:
            return PlanResponse(
                task_id=task_id,
                query=query,
                workspace_path=str(self.workspace_root),
                actions=[],
                summary="No files found in workspace to organize.",
                requires_approval=False,
                status=TaskStatus.COMPLETED,
            )

        # Step 2: Attempt model inference (with deterministic fallback)
        actions: List[ActionPlan] = []
        summary = ""

        try:
            prompt = f"User Request: {query}\nFiles: {json.dumps(file_items, indent=2)}"
            model_out = await self.model_client.generate_json(
                prompt=prompt,
                system_prompt=SYSTEM_PLANNER_PROMPT.format(
                    file_list_json=json.dumps(file_items, indent=2),
                    user_query=query,
                )
            )

            raw_actions = model_out.get("actions", [])
            summary = model_out.get("summary", "Organize files by type")

            for item in raw_actions:
                action_type_str = item.get("type", "move_file")
                src = item.get("source")
                dst = item.get("destination")
                reason = item.get("reason", "Organized by AI")

                if src and dst and action_type_str in [at.value for at in ActionType]:
                    actions.append(
                        ActionPlan(
                            id=f"act-{str(uuid.uuid4())[:8]}",
                            type=ActionType(action_type_str),
                            source=src,
                            destination=dst,
                            reason=reason,
                            requires_approval=True,
                        )
                    )
        except Exception:
            raw_actions = []

        # If model returned no actions or failed, apply deterministic organizer fallback
        if not actions:
            summary = "Automated rule-based organization based on file extensions"
            for f in scan_res.files:
                # Don't move if it's already inside a category directory
                parts = Path(f.relative_path).parts
                if len(parts) > 1 and parts[0] in [
                    "Documents", "Spreadsheets", "Images", "Code", "Archives", "Media", "Presentations"
                ]:
                    continue

                category = classify_file_by_extension(f.name)
                dest = f"{category}/{f.name}"
                if f.relative_path != dest:
                    actions.append(
                        ActionPlan(
                            id=f"act-{str(uuid.uuid4())[:8]}",
                            type=ActionType.MOVE_FILE,
                            source=f.relative_path,
                            destination=dest,
                            reason=f"Categorize as {category}",
                            requires_approval=True,
                        )
                    )

        # Step 3: Strict security & path validation on all actions
        validated_actions: List[ActionPlan] = []
        for act in actions:
            try:
                # Security boundary checks
                validate_and_resolve_path(act.source, self.workspace_root, must_exist=True)
                if act.destination:
                    validate_and_resolve_path(act.destination, self.workspace_root, must_exist=False)

                # Policy allowlist check
                is_valid, _ = validate_action_policy(act, self.workspace_root)
                if is_valid:
                    validated_actions.append(act)
            except Exception:
                # Skip invalid or unsafe proposed actions
                continue

        return PlanResponse(
            task_id=task_id,
            query=query,
            workspace_path=str(self.workspace_root),
            actions=validated_actions,
            summary=summary,
            requires_approval=len(validated_actions) > 0,
            status=TaskStatus.AWAITING_APPROVAL if validated_actions else TaskStatus.COMPLETED,
        )
