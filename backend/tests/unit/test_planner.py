import pytest
from pathlib import Path
from backend.app.agent.planner import TaskPlanner
from backend.app.agent.model_client import MockFallbackModelClient
from backend.app.schemas.models import TaskStatus, ActionType


@pytest.mark.asyncio
async def test_planner_creates_validated_plan(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "notes.txt").write_text("my notes")
    (workspace / "data.csv").write_text("1,2,3")

    planner = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=workspace
    )

    plan = await planner.create_plan("Organize all my files into folders")
    assert plan.status == TaskStatus.AWAITING_APPROVAL
    assert plan.requires_approval is True
    assert len(plan.actions) == 2

    # Check proposed moves
    actions_by_src = {a.source: a for a in plan.actions}
    assert "notes.txt" in actions_by_src
    assert actions_by_src["notes.txt"].destination == "Documents/notes.txt"
    assert "data.csv" in actions_by_src
    assert actions_by_src["data.csv"].destination == "Spreadsheets/data.csv"


@pytest.mark.asyncio
async def test_planner_empty_workspace(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    planner = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=workspace
    )

    plan = await planner.create_plan("Organize files")
    assert plan.status == TaskStatus.COMPLETED
    assert plan.requires_approval is False
    assert len(plan.actions) == 0
    assert "No files found" in plan.summary


@pytest.mark.asyncio
async def test_planner_filters_by_user_intent_pdf(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "paper.pdf").write_text("Research Paper")
    (workspace / "image.png").write_text("Photo")
    (workspace / "data.csv").write_text("a,b,c")

    planner = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=workspace
    )

    # Ask specifically for PDFs
    plan = await planner.create_plan("Please organize my PDF files")
    assert plan.status == TaskStatus.AWAITING_APPROVAL
    assert len(plan.actions) == 1
    assert plan.actions[0].source == "paper.pdf"
    assert plan.actions[0].destination == "Documents/paper.pdf"


@pytest.mark.asyncio
async def test_planner_skips_destination_collision(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "report.pdf").write_text("New Report")
    docs_dir = workspace / "Documents"
    docs_dir.mkdir()
    # Pre-existing destination
    (docs_dir / "report.pdf").write_text("Old Report Already Here")

    planner = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=workspace
    )

    plan = await planner.create_plan("Organize all files")
    # report.pdf should be skipped to prevent collision
    assert len(plan.actions) == 0
    assert "skipped because destination already exists" in plan.summary


@pytest.mark.asyncio
async def test_planner_rejects_path_traversal_in_model_response(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "file.txt").write_text("hello")

    malicious_model_response = {
        "summary": "Malicious attack plan",
        "actions": [
            {
                "type": "move_file",
                "source": "file.txt",
                "destination": "../../etc/passwd",
                "reason": "Escape workspace"
            }
        ]
    }

    mock_client = MockFallbackModelClient(response_data=malicious_model_response)
    planner = TaskPlanner(
        model_client=mock_client,
        workspace_root=workspace
    )

    plan = await planner.create_plan("Organize files")
    # Malicious action outside workspace must be blocked by validation
    assert len(plan.actions) == 0


@pytest.mark.asyncio
async def test_planner_rejects_sensitive_files(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".env").write_text("SECRET=123")
    (workspace / "safe.txt").write_text("safe content")

    malicious_model_response = {
        "summary": "Move sensitive file",
        "actions": [
            {
                "type": "move_file",
                "source": ".env",
                "destination": "Public/.env",
                "reason": "Expose secrets"
            },
            {
                "type": "move_file",
                "source": "safe.txt",
                "destination": "Documents/safe.txt",
                "reason": "Safe move"
            }
        ]
    }

    mock_client = MockFallbackModelClient(response_data=malicious_model_response)
    planner = TaskPlanner(
        model_client=mock_client,
        workspace_root=workspace
    )

    plan = await planner.create_plan("Organize files")
    # .env move must be blocked by policy; safe.txt must be allowed
    assert len(plan.actions) == 1
    assert plan.actions[0].source == "safe.txt"


@pytest.mark.asyncio
async def test_planner_parses_markdown_code_fences(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "invoice.pdf").write_text("invoice #123")

    raw_markdown_output = """Here is your proposed organization plan:
```json
{
  "summary": "Organize invoice into Finance folder",
  "actions": [
    {
      "type": "move_file",
      "source": "invoice.pdf",
      "destination": "Documents/invoice.pdf",
      "reason": "Categorize invoice PDF"
    }
  ]
}
```
Let me know if you would like me to proceed!"""

    mock_client = MockFallbackModelClient(raw_response_text=raw_markdown_output)
    planner = TaskPlanner(
        model_client=mock_client,
        workspace_root=workspace
    )

    plan = await planner.create_plan("Organize invoice")
    assert len(plan.actions) == 1
    assert plan.actions[0].source == "invoice.pdf"
    assert plan.actions[0].destination == "Documents/invoice.pdf"
    assert "Finance" in plan.summary or "invoice" in plan.summary


@pytest.mark.asyncio
async def test_planner_does_not_suggest_files_in_existing_subfolder(tmp_path: Path):
    """
    When organizing root workspace (e.g. Desktop), files already in subfolders (e.g. Idler)
    must NOT be suggested to be moved out into parent category folders.
    """
    workspace = tmp_path / "Desktop"
    workspace.mkdir()
    # Loose file on Desktop
    (workspace / "loose_photo.png").write_text("image data")
    # Project subfolder Idler on Desktop with its own files
    idler_dir = workspace / "Idler"
    idler_dir.mkdir()
    (idler_dir / "app.py").write_text("print('hello')")
    (idler_dir / "package.json").write_text("{}")
    nested_dir = idler_dir / "backend"
    nested_dir.mkdir()
    (nested_dir / "main.py").write_text("# main")

    planner = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=workspace
    )

    plan = await planner.create_plan("Organize all unorganized files by category")
    assert plan.status == TaskStatus.AWAITING_APPROVAL
    # Only loose_photo.png should be moved; Idler files must NOT be suggested!
    assert len(plan.actions) == 1
    assert plan.actions[0].source == "loose_photo.png"
    assert plan.actions[0].destination == "Images/loose_photo.png"


@pytest.mark.asyncio
async def test_planner_sorts_within_subfolder_into_its_own_subfolders(tmp_path: Path):
    """
    When organizing a subfolder (e.g. Idler), it sorts loose files in that subfolder
    into its own subfolders (e.g. Idler/Code, Idler/Images), preserving deeper nested files.
    """
    workspace = tmp_path / "Desktop"
    workspace.mkdir()
    (workspace / "desktop_note.txt").write_text("desktop file")

    idler_dir = workspace / "Idler"
    idler_dir.mkdir()
    (idler_dir / "script.py").write_text("python script")
    (idler_dir / "logo.png").write_text("png logo")
    nested_dir = idler_dir / "src"
    nested_dir.mkdir()
    (nested_dir / "index.ts").write_text("nested code")

    planner = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=workspace
    )

    # 1. Target via natural language "organize Idler folder"
    plan = await planner.create_plan("Organize files in Idler folder by category")
    assert plan.status == TaskStatus.AWAITING_APPROVAL
    actions_by_src = {a.source: a for a in plan.actions}

    # script.py -> Idler/Code/script.py
    assert "Idler/script.py" in actions_by_src
    assert actions_by_src["Idler/script.py"].destination == "Idler/Code/script.py"

    # logo.png -> Idler/Images/logo.png
    assert "Idler/logo.png" in actions_by_src
    assert actions_by_src["Idler/logo.png"].destination == "Idler/Images/logo.png"

    # nested index.ts and desktop_note.txt are preserved/untouched!
    assert "Idler/src/index.ts" not in actions_by_src
    assert "desktop_note.txt" not in actions_by_src

    # 2. Target via parameters {"target_subfolder": "Idler"}
    plan2 = await planner.create_plan("Quick Sort", parameters={"target_subfolder": "Idler"})
    assert plan2.status == TaskStatus.AWAITING_APPROVAL
    actions_by_src2 = {a.source: a for a in plan2.actions}
    assert "Idler/script.py" in actions_by_src2
    assert actions_by_src2["Idler/script.py"].destination == "Idler/Code/script.py"
    assert "Idler/logo.png" in actions_by_src2
    assert actions_by_src2["Idler/logo.png"].destination == "Idler/Images/logo.png"
    assert "Idler/src/index.ts" not in actions_by_src2


@pytest.mark.asyncio
async def test_planner_never_creates_redundant_nested_category_folders(tmp_path: Path):
    """
    Files already inside a category folder (e.g. Images/photo.png) must NEVER
    be sorted into a redundant nested subfolder of the same name (e.g. Images/Images/photo.png).
    """
    workspace = tmp_path / "Desktop"
    workspace.mkdir()
    images_dir = workspace / "Images"
    images_dir.mkdir()
    (images_dir / "photo.jpg").write_text("image bytes")
    (images_dir / "screenshot.png").write_text("png bytes")

    # 1. When organizing Desktop, files in Images are preserved and not touched
    planner_desktop = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=workspace
    )
    plan_desktop = await planner_desktop.create_plan("Organize all unorganized files by category")
    assert len(plan_desktop.actions) == 0

    # 2. When Images is targeted explicitly, images must NOT be moved to Images/Images
    plan_images_targeted = await planner_desktop.create_plan(
        "Organize files",
        parameters={"target_subfolder": "Images"}
    )
    assert len(plan_images_targeted.actions) == 0
    assert "No unorganized loose files found" in plan_images_targeted.summary

    # 3. When the workspace root itself is the Images directory
    planner_images_root = TaskPlanner(
        model_client=MockFallbackModelClient(),
        workspace_root=images_dir
    )
    plan_images_root = await planner_images_root.create_plan("Organize files")
    assert len(plan_images_root.actions) == 0
    assert "No unorganized loose files found" in plan_images_root.summary
