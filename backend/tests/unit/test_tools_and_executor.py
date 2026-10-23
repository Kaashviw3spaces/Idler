import pytest
from pathlib import Path
from backend.app.schemas.models import ActionPlan, ActionType, ActionStatus, TaskStatus
from backend.app.tools.scan import scan_directory
from backend.app.tools.classify import classify_file_by_extension
from backend.app.tools.files import move_file_safely, rename_file_safely
from backend.app.tools.duplicates import find_duplicates
from backend.app.services.executor import PlanExecutor


def test_classify_file_by_extension():
    assert classify_file_by_extension("report.pdf") == "Documents"
    assert classify_file_by_extension("data.csv") == "Spreadsheets"
    assert classify_file_by_extension("pic.png") == "Images"
    assert classify_file_by_extension("script.py") == "Code"
    assert classify_file_by_extension("archive.zip") == "Archives"
    assert classify_file_by_extension("unknown.xyz") == "Other"


def test_scan_directory(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "doc1.pdf").write_text("dummy")
    (workspace / "notes.txt").write_text("hello")

    res = scan_directory(".", workspace)
    assert res.total_files == 2
    assert any(f.name == "doc1.pdf" and f.category == "Documents" for f in res.files)


def test_safe_move_file(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source_file = workspace / "test.txt"
    source_file.write_text("content to move")

    res = move_file_safely(
        action_id="act-1",
        source_rel="test.txt",
        dest_rel="Documents/test.txt",
        workspace_root=workspace,
    )

    assert res.status == ActionStatus.COMPLETED
    assert not (workspace / "test.txt").exists()
    assert (workspace / "Documents" / "test.txt").exists()
    assert (workspace / "Documents" / "test.txt").read_text() == "content to move"


def test_safe_rename_file(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source_file = workspace / "old_name.txt"
    source_file.write_text("content inside")

    res = rename_file_safely(
        action_id="act-rename-1",
        source_rel="old_name.txt",
        new_name="new_name.txt",
        workspace_root=workspace,
    )

    assert res.status == ActionStatus.COMPLETED
    assert not (workspace / "old_name.txt").exists()
    assert (workspace / "new_name.txt").exists()
    assert (workspace / "new_name.txt").read_text() == "content inside"


def test_duplicate_detection(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "file1.txt").write_text("identical text")
    (workspace / "file2.txt").write_text("identical text")
    (workspace / "file3.txt").write_text("different text")

    dup_result = find_duplicates(".", workspace)
    assert dup_result.scanned_files == 3
    assert len(dup_result.duplicate_groups) == 1
    assert dup_result.duplicate_groups[0].count == 2
    assert "file1.txt" in dup_result.duplicate_groups[0].paths
    assert "file2.txt" in dup_result.duplicate_groups[0].paths


def test_plan_executor(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "invoice.pdf").write_text("invoice-100")

    plan = [
        ActionPlan(
            id="act-101",
            type=ActionType.MOVE_FILE,
            source="invoice.pdf",
            destination="Documents/invoice.pdf",
            reason="Organize PDF",
        )
    ]

    executor = PlanExecutor(workspace_root=workspace)
    summary = executor.execute_plan(task_id="task-100", actions=plan)

    assert summary.status == TaskStatus.COMPLETED
    assert summary.completed_actions == 1
    assert summary.failed_actions == 0
    assert (workspace / "Documents" / "invoice.pdf").exists()

