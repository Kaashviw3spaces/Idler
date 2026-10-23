import pytest
from pathlib import Path
from backend.app.security.paths import (
    validate_and_resolve_path,
    resolve_workspace,
    PathTraversalError,
    WorkspaceBoundaryError,
    InvalidPathError,
)
from backend.app.security.policies import (
    check_collision_and_preconditions,
    DestinationCollisionError,
)
from backend.app.schemas.models import ActionType


def test_valid_relative_path(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sample_file = workspace / "test.txt"
    sample_file.write_text("hello")

    resolved = validate_and_resolve_path("test.txt", workspace, must_exist=True)
    assert resolved == sample_file


def test_path_traversal_detection(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    with pytest.raises(PathTraversalError):
        validate_and_resolve_path("../../etc/passwd", workspace)

    with pytest.raises(PathTraversalError):
        validate_and_resolve_path("sub/../../outside.txt", workspace)


def test_absolute_path_outside_workspace(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")

    with pytest.raises(WorkspaceBoundaryError):
        validate_and_resolve_path(str(outside), workspace)


def test_null_byte_rejection(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    with pytest.raises(InvalidPathError):
        validate_and_resolve_path("file.txt\x00.pdf", workspace)


def test_destination_collision_prevention(tmp_path: Path):
    src = tmp_path / "source.txt"
    src.write_text("content")
    dst = tmp_path / "dest.txt"
    dst.write_text("existing content")

    with pytest.raises(DestinationCollisionError):
        check_collision_and_preconditions(src, dst, ActionType.MOVE_FILE)


def test_resolve_workspace_relative_to_allowed_root(tmp_path: Path, monkeypatch):
    allowed_root = tmp_path / "allowed_workspace"
    nested = allowed_root / "nested"
    nested.mkdir(parents=True)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("backend.app.config.settings.allowed_workspaces_raw", str(allowed_root))

    assert resolve_workspace("nested") == nested

