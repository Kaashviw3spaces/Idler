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
