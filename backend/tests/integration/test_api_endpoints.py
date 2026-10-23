import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.main import app
from backend.app.db.database import Base, get_db
from backend.app.config import settings


@pytest.fixture
def client_and_workspace(tmp_path: Path, monkeypatch):
    workspace = tmp_path / "test_workspace"
    workspace.mkdir()

    # Configure test database in memory with StaticPool for thread-safety across FastAPI test client
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    # Point allowed workspaces to temp workspace
    monkeypatch.setattr(settings, "allowed_workspaces_raw", str(workspace))
    monkeypatch.setattr(settings, "use_mock_model", True)

    client = TestClient(app)
    yield client, workspace
    app.dependency_overrides.clear()


def test_health_check(client_and_workspace):
    client, _ = client_and_workspace
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["app_name"] == "Idler"


def test_end_to_end_plan_approval_execute_undo_flow(client_and_workspace):
    client, workspace = client_and_workspace

    # Create dummy files
    (workspace / "contract.pdf").write_text("Confidential NDA Agreement")
    (workspace / "budget.xlsx").write_text("Budget 2026")

    # 1. Plan request
    plan_resp = client.post("/api/plan", json={"query": "Organize contract and budget files"})
    assert plan_resp.status_code == 200
    plan_data = plan_resp.json()
    task_id = plan_data["task_id"]
    assert plan_data["status"] == "awaiting_approval"
    assert plan_data["requires_approval"] is True
    assert len(plan_data["actions"]) >= 2

    # 2. Try executing BEFORE approval -> MUST FAIL
    exec_attempt = client.post(f"/api/tasks/{task_id}/execute")
    assert exec_attempt.status_code == 400
    assert "approved" in exec_attempt.json()["detail"].lower()

    # 3. Approve task
    approve_resp = client.post(f"/api/tasks/{task_id}/approve")
    assert approve_resp.status_code == 200
    assert approve_resp.json()["status"] == "approved"

    # 4. Execute task
    exec_resp = client.post(f"/api/tasks/{task_id}/execute")
    assert exec_resp.status_code == 200
    summary = exec_resp.json()
    assert summary["status"] == "completed"
    assert summary["completed_actions"] >= 2
    assert summary["failed_actions"] == 0

    # Verify filesystem changes
    assert not (workspace / "contract.pdf").exists()
    assert (workspace / "Documents" / "contract.pdf").exists()

    # 5. Check Action Ledger
    actions_resp = client.get(f"/api/actions?task_id={task_id}")
    assert actions_resp.status_code == 200
    actions = actions_resp.json()
    assert len(actions) >= 2

    # Find the move action for contract.pdf
    contract_action = next(a for a in actions if a["source"] == "contract.pdf")
    action_id = contract_action["id"]
    assert contract_action["rollback_supported"] is True

    # 6. Undo the action
    undo_resp = client.post(f"/api/actions/{action_id}/undo")
    assert undo_resp.status_code == 200
    assert undo_resp.json()["status"] == "rolled_back"

    # Verify contract restored to root and removed from Documents
    assert (workspace / "contract.pdf").exists()
    assert not (workspace / "Documents" / "contract.pdf").exists()


def test_duplicate_scan_endpoint(client_and_workspace):
    client, workspace = client_and_workspace

    # Create duplicates
    (workspace / "original.txt").write_text("Hello identical world!")
    (workspace / "copy1.txt").write_text("Hello identical world!")
    (workspace / "copy2.txt").write_text("Hello identical world!")
    (workspace / "unique.txt").write_text("I am unique!")

    response = client.get("/api/duplicates")
    assert response.status_code == 200
    data = response.json()

    assert data["scanned_files"] == 4
    assert len(data["duplicate_groups"]) == 1
    dup_group = data["duplicate_groups"][0]
    assert dup_group["count"] == 3
    assert set(dup_group["paths"]) == {"original.txt", "copy1.txt", "copy2.txt"}
    # Verify no files were deleted
    assert (workspace / "original.txt").exists()
    assert (workspace / "copy1.txt").exists()


def test_saved_workflow_flow(client_and_workspace):
    client, workspace = client_and_workspace

    # Create test files
    (workspace / "doc.pdf").write_text("PDF content")

    # 1. Save workflow
    create_wf = client.post(
        "/api/workflows",
        json={
            "name": "Organize Downloads",
            "description": "Daily tidy up",
            "query": "Move PDFs into Documents folder",
            "workspace_path": str(workspace),
        }
    )
    assert create_wf.status_code == 200
    wf_data = create_wf.json()
    wf_id = wf_data["id"]
    assert wf_data["name"] == "Organize Downloads"

    # 2. List workflows
    list_wf = client.get("/api/workflows")
    assert list_wf.status_code == 200
    assert len(list_wf.json()) == 1

    # 3. Run saved workflow
    run_wf = client.post(f"/api/workflows/{wf_id}/run")
    assert run_wf.status_code == 200
    run_res = run_wf.json()
    assert run_res["status"] == "completed"
    assert (workspace / "Documents" / "doc.pdf").exists()

