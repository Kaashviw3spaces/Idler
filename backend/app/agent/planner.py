import json
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from backend.app.agent.model_client import (
    ModelClient,
    OllamaModelClient,
    MockFallbackModelClient,
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

    async def create_plan(
        self,
        query: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> PlanResponse:
        """
        Interprets natural language request, inspects workspace,
        generates structured actions, and validates all paths and security policies.
        Preserves existing subfolders: files already in subfolders are not moved into parent,
        and sorting within a subfolder routes files into that subfolder's own subdirectories.
        """
        task_id = f"task-{str(uuid.uuid4())[:8]}"

        # Standard category folder names used by Idler
        category_dir_names = {
            "Documents", "Spreadsheets", "Images", "Code", "Archives", "Media", "Presentations", "Other"
        }

        # Discover top-level directories in workspace_root
        top_subdirs = set()
        try:
            for entry in self.workspace_root.iterdir():
                if entry.is_dir() and not entry.name.startswith(".") and not entry.name.endswith(".app"):
                    top_subdirs.add(entry.name)
        except Exception:
            pass

        # Detect if a specific subfolder is targeted (via parameters or query)
        target_subfolder: Optional[str] = None
        if parameters and parameters.get("target_subfolder"):
            cand = str(parameters["target_subfolder"]).strip().strip("/")
            if cand in top_subdirs or (self.workspace_root / cand).is_dir():
                target_subfolder = cand
        elif parameters and parameters.get("subfolder"):
            cand = str(parameters["subfolder"]).strip().strip("/")
            if cand in top_subdirs or (self.workspace_root / cand).is_dir():
                target_subfolder = cand
        else:
            # Check natural language query for mentioned non-category subfolder (e.g. "sort idler", "organize idler folder")
            q_lower = query.lower()
            for sname in top_subdirs:
                if sname in category_dir_names:
                    continue
                if re.search(r'\b' + re.escape(sname.lower()) + r'\b', q_lower):
                    target_subfolder = sname
                    break

        # Step 1: Scan current workspace files (bounded, read-only)
        scan_res = scan_directory(".", self.workspace_root, recursive=True, max_files=100)
        if not scan_res.files:
            return PlanResponse(
                task_id=task_id,
                query=query,
                workspace_path=str(self.workspace_root),
                actions=[],
                summary="No files found in workspace to organize.",
                requires_approval=False,
                status=TaskStatus.COMPLETED,
            )

        # Candidate files selection rule:
        # Rule 1: If a subfolder is targeted (e.g. "Idler"), ONLY select loose files directly inside that subfolder.
        #         Deeper nested files (e.g. Idler/frontend/src/...) are preserved and NOT moved.
        # Rule 2: If no subfolder is targeted (e.g. Desktop root), ONLY select loose files directly in workspace root.
        #         Files that already exist in any subfolder (e.g. Idler/..., MyFolder/...) are preserved and NOT moved.
        candidate_files = []
        for f in scan_res.files:
            parts = Path(f.relative_path).parts
            if target_subfolder:
                # Must be directly in target_subfolder (parts: (target_subfolder, filename))
                if len(parts) == 2 and parts[0] == target_subfolder:
                    candidate_files.append(f)
            else:
                # Must be directly in workspace root (parts: (filename,))
                if len(parts) == 1:
                    candidate_files.append(f)

        file_items = [
            {"name": f.name, "path": f.relative_path, "category": f.category, "size": f.size_bytes}
            for f in candidate_files
        ]

        if not candidate_files:
            folder_desc = f"'{target_subfolder}'" if target_subfolder else f"'{self.workspace_root.name}'"
            return PlanResponse(
                task_id=task_id,
                query=query,
                workspace_path=str(self.workspace_root),
                actions=[],
                summary=f"No unorganized loose files found in {folder_desc} to sort (files inside subfolders are preserved).",
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
            candidate_paths = {f.relative_path for f in candidate_files}

            for item in raw_actions:
                action_type_str = item.get("type", "move_file")
                src = item.get("source")
                dst = item.get("destination")
                reason = item.get("reason", "Organized by AI")

                # Ensure proposed source is one of the valid candidate files
                if src and dst and src in candidate_paths and action_type_str in [at.value for at in ActionType]:
                    # Ensure destination is within the target subfolder if one is selected
                    if target_subfolder and not dst.startswith(f"{target_subfolder}/"):
                        dst = f"{target_subfolder}/{dst.lstrip('/')}"
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
            folder_title = f"'{target_subfolder}'" if target_subfolder else f"'{self.workspace_root.name}'"
            summary = f"Automated rule-based organization for loose files in {folder_title}"
            q_lower = query.lower()

            # Query intent extraction for specific file types
            filter_exts: Optional[Set[str]] = None
            if "pdf" in q_lower:
                filter_exts = {".pdf"}
            elif any(w in q_lower for w in ["image", "photo", "picture", "screenshot"]):
                filter_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
            elif any(w in q_lower for w in ["spreadsheet", "excel", "csv", "sheet"]):
                filter_exts = {".xlsx", ".xls", ".csv", ".tsv"}
            elif any(w in q_lower for w in ["document", "doc", "word"]):
                filter_exts = {".pdf", ".docx", ".doc", ".txt", ".md", ".rtf", ".odt", ".pages"}
            elif any(w in q_lower for w in ["code", "script", "program"]):
                filter_exts = {".py", ".js", ".ts", ".html", ".css", ".json", ".yaml", ".yml", ".sh"}

            for f in candidate_files:
                # If a specific category was requested, filter other file types
                if filter_exts and f.extension not in filter_exts:
                    continue

                category = classify_file_by_extension(f.name)
                if target_subfolder:
                    # Sort files within the subfolder into its own category subfolders
                    dest = f"{target_subfolder}/{category}/{f.name}"
                    reason = f"Categorize as {category} inside {target_subfolder}"
                else:
                    dest = f"{category}/{f.name}"
                    reason = f"Categorize as {category}"

                if f.relative_path != dest:
                    actions.append(
                        ActionPlan(
                            id=f"act-{str(uuid.uuid4())[:8]}",
                            type=ActionType.MOVE_FILE,
                            source=f.relative_path,
                            destination=dest,
                            reason=reason,
                            requires_approval=True,
                        )
                    )

        # Step 3: Strict security & path validation on all actions
        validated_actions: List[ActionPlan] = []
        skipped_due_to_collision = 0

        for act in actions:
            try:
                # Security boundary checks
                src_resolved = validate_and_resolve_path(act.source, self.workspace_root, must_exist=True)
                if act.destination:
                    dst_resolved = validate_and_resolve_path(act.destination, self.workspace_root, must_exist=False)
                    # Check destination collision: if destination already exists and is not the source itself, skip it!
                    if dst_resolved.exists() and dst_resolved != src_resolved:
                        skipped_due_to_collision += 1
                        continue

                # Policy allowlist check
                is_valid, _ = validate_action_policy(act, self.workspace_root)
                if is_valid:
                    validated_actions.append(act)
            except Exception:
                # Skip invalid or unsafe proposed actions
                continue

        if skipped_due_to_collision > 0:
            summary += f" ({skipped_due_to_collision} file(s) skipped because destination already exists)"

        return PlanResponse(
            task_id=task_id,
            query=query,
            workspace_path=str(self.workspace_root),
            actions=validated_actions,
            summary=summary,
            requires_approval=len(validated_actions) > 0,
            status=TaskStatus.AWAITING_APPROVAL if validated_actions else TaskStatus.COMPLETED,
        )
