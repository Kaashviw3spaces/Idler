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
