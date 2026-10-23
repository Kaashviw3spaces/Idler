from pathlib import Path

import pytest


@pytest.fixture
def workspace_root(tmp_path: Path) -> Path:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return workspace
