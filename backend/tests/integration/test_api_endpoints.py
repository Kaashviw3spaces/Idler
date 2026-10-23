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

    # 4. Toggle workflow status (pause / resume)
    toggle_resp = client.patch(f"/api/workflows/{wf_id}/toggle")
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["is_active"] is False

    # 5. Delete workflow
    del_resp = client.delete(f"/api/workflows/{wf_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"

    # Verify list is now empty
    list_after = client.get("/api/workflows")
    assert len(list_after.json()) == 0


def test_trash_duplicate_soft_delete(client_and_workspace, monkeypatch):
    client, workspace = client_and_workspace
    test_file = workspace / "duplicate_copy.txt"
    test_file.write_text("duplicate file content")

    trashed_paths = []
    # Mock send2trash so tests don't pollute the user's real OS Trash
    import send2trash
    monkeypatch.setattr(send2trash, "send2trash", lambda p: trashed_paths.append(str(p)))

    resp = client.post(
        "/api/duplicates/trash",
        json={"file_path": "duplicate_copy.txt", "workspace_path": str(workspace)}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "trashed"
    assert str(test_file.resolve()) in trashed_paths


def test_trash_duplicate_boundary_enforcement(client_and_workspace):
    client, workspace = client_and_workspace

    # Attempting to trash outside allowed workspace must return 400
    resp = client.post(
        "/api/duplicates/trash",
        json={"file_path": "../../outside.txt", "workspace_path": str(workspace)}
    )
    assert resp.status_code == 400


def test_project_inspect_endpoint(client_and_workspace):
    client, workspace = client_and_workspace
    rust_dir = workspace / "rust_tool"
    rust_dir.mkdir()
    (rust_dir / "Cargo.toml").write_text('[package]\nname = "tool"\n')
    (rust_dir / "main.rs").write_text('fn main() {}')

    resp = client.get(f"/api/project/inspect?path=rust_tool&workspace_path={workspace}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_type"] == "rust"
    assert data["total_files"] == 2
    assert "rust" in data["languages"]


def test_trash_all_duplicates_preserves_original(client_and_workspace, monkeypatch):
    client, workspace = client_and_workspace

    # Create 3 identical files
    content = "Batch duplicate test content 12345"
    (workspace / "keep_this.txt").write_text(content)
    (workspace / "copy_a.txt").write_text(content)
    (workspace / "copy_b.txt").write_text(content)

    trashed = []
    import send2trash
    monkeypatch.setattr(send2trash, "send2trash", lambda p: trashed.append(Path(p).name))

    resp = client.post(
        "/api/duplicates/trash-all",
        json={"workspace_path": str(workspace)}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["trashed_count"] == 2
    # Exactly 2 redundant copies trashed, 1 original kept
    assert len(trashed) == 2
    assert "keep_this.txt" not in trashed


def test_export_actions_endpoint_csv_and_json(client_and_workspace):
    client, _ = client_and_workspace

    # Export as CSV
    resp_csv = client.get("/api/actions/export?format=csv")
    assert resp_csv.status_code == 200
    assert "text/csv" in resp_csv.headers["content-type"]
    assert "Action Type" in resp_csv.text

    # Export as JSON
    resp_json = client.get("/api/actions/export?format=json")
    assert resp_json.status_code == 200
    assert "application/json" in resp_json.headers["content-type"]
    assert isinstance(resp_json.json(), list)





