import pytest
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.database import Base
from backend.app.schemas.models import (
    ActionPlan,
    ActionStatus,
    ActionType,
    PlanResponse,
    TaskStatus,
)
from backend.app.services.ledger import ActionLedgerService
from backend.app.tools.files import move_file_safely


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_task_creation_and_ledger(test_db):
    ledger = ActionLedgerService(test_db)
    plan = PlanResponse(
        task_id="task-1",
        query="Organize files",
        workspace_path=".",
        actions=[
            ActionPlan(
                id="act-1",
                type=ActionType.MOVE_FILE,
                source="test.pdf",
                destination="Documents/test.pdf",
                reason="Organize",
            )
        ],
        summary="Move 1 file",
        requires_approval=True,
        status=TaskStatus.AWAITING_APPROVAL,
    )

    task_db = ledger.create_task(plan)
    assert task_db.id == "task-1"
    assert task_db.status == "awaiting_approval"

    actions = ledger.list_actions(task_id="task-1")
    assert len(actions) == 1
    assert actions[0].status == "pending"


def test_action_execution_and_safe_rollback(test_db, tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sample_file = workspace / "quarterly.pdf"
    sample_file.write_text("Quarterly financial report")

    ledger = ActionLedgerService(test_db)

    # 1. Create plan
    plan = PlanResponse(
        task_id="task-financials",
        query="Organize quarterly report",
        workspace_path=".",
        actions=[
            ActionPlan(
                id="act-fin-1",
                type=ActionType.MOVE_FILE,
                source="quarterly.pdf",
                destination="Documents/quarterly.pdf",
                reason="Sort PDF",
            )
        ],
        summary="Organize",
        status=TaskStatus.AWAITING_APPROVAL,
    )
    ledger.create_task(plan)

    # 2. Execute move
    res = move_file_safely(
        action_id="act-fin-1",
        source_rel="quarterly.pdf",
        dest_rel="Documents/quarterly.pdf",
        workspace_root=workspace,
    )
    assert res.status == ActionStatus.COMPLETED
    ledger.record_action_result(res)

    # Verify moved
    assert not (workspace / "quarterly.pdf").exists()
    assert (workspace / "Documents" / "quarterly.pdf").exists()

    # 3. Undo action
    undo_res = ledger.undo_action(action_id="act-fin-1", workspace_root=workspace)
    assert undo_res.status == ActionStatus.ROLLED_BACK

    # Verify restored
    assert (workspace / "quarterly.pdf").exists()
    assert not (workspace / "Documents" / "quarterly.pdf").exists()

    # Verify ledger history preserved
    actions = ledger.list_actions(task_id="task-financials")
    # Original action + rollback event
    assert len(actions) == 2
    original_act = ledger.get_action("act-fin-1")
    assert original_act.is_undone is True
    assert original_act.status == "rolled_back"

