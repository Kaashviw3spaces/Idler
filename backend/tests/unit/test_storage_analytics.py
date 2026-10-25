import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.db.database import get_db
from backend.app.main import app
from backend.app.schemas.analytics import CloudSyncInfo
from backend.app.tools.storage_analytics import (
    UF_DATALESS,
    archive_large_file,
    detect_cloud_sync,
    scan_storage_analytics,
    trash_large_file,
)


def test_detect_cloud_sync_local_file(tmp_path):
    local_file = tmp_path / "normal_code.py"
    local_file.write_text("print('hello')")
    st = local_file.stat()

    info = detect_cloud_sync(local_file, st)
    assert info.is_cloud_file is False
    assert info.is_cloud_placeholder is False
    assert info.cloud_provider is None


def test_detect_cloud_sync_icloud_stub(tmp_path):
    icloud_stub = tmp_path / ".Quarterly_Report.pdf.icloud"
    icloud_stub.write_text("placeholder")
    st = icloud_stub.stat()

    info = detect_cloud_sync(icloud_stub, st)
    assert info.is_cloud_file is True
    assert info.is_cloud_placeholder is True
    assert info.cloud_provider == "iCloud Drive"
    assert info.placeholder_type == "icloud_stub"
    assert "Cloud-only placeholder" in (info.warning or "")


def test_detect_cloud_sync_google_docs_stub(tmp_path):
    gdoc_file = tmp_path / "Project_Roadmap.gdoc"
    gdoc_file.write_text('{"doc_id": "xyz"}')
    st = gdoc_file.stat()

    info = detect_cloud_sync(gdoc_file, st)
    assert info.is_cloud_file is True
    assert info.is_cloud_placeholder is True
    assert info.cloud_provider == "Google Drive"
    assert info.placeholder_type == "google_docs_stub"


def test_detect_cloud_sync_dataless_blocks(tmp_path):
    # Simulate a file located inside OneDrive directory with 0 allocated blocks
    od_dir = tmp_path / "OneDrive" / "Documents"
    od_dir.mkdir(parents=True)
    od_file = od_dir / "GiantDataset.zip"
    od_file.write_bytes(b"dummy")

    # Mock stat result with st_blocks == 0 and st_size == 1000000
    mock_st = MagicMock()
    mock_st.st_size = 1000000
    mock_st.st_blocks = 0
    del mock_st.st_flags

    info = detect_cloud_sync(od_file, mock_st)
    assert info.is_cloud_file is True
    assert info.is_cloud_placeholder is True
    assert info.cloud_provider == "OneDrive"
    assert info.placeholder_type == "dataless_blocks"


def test_detect_cloud_sync_mac_apfs_dataless_flag(tmp_path):
    db_dir = tmp_path / "Dropbox"
    db_dir.mkdir(parents=True)
    db_file = db_dir / "Video_Archive.mp4"
    db_file.write_bytes(b"video")

    mock_st = MagicMock()
    mock_st.st_size = 500000000
    mock_st.st_blocks = 1000
    mock_st.st_flags = UF_DATALESS

    info = detect_cloud_sync(db_file, mock_st)
    assert info.is_cloud_file is True
    assert info.is_cloud_placeholder is True
    assert info.cloud_provider == "Dropbox"
    assert info.placeholder_type == "dataless_apfs"


def test_scan_storage_analytics(tmp_path):
    # Setup test workspace hierarchy
    ws = tmp_path / "workspace"
    ws.mkdir()

    # Images folder
    img_dir = ws / "Images"
    img_dir.mkdir()
    (img_dir / "photo1.png").write_bytes(b"x" * 2000)
    (img_dir / "photo2.jpg").write_bytes(b"x" * 3000)

    # Documents folder with an old, large file
    docs_dir = ws / "Documents"
    docs_dir.mkdir()
    (docs_dir / "notes.txt").write_bytes(b"x" * 1000)

    old_large = docs_dir / "ArchiveDump_2023.tar.gz"
    old_large.write_bytes(b"x" * 50000)  # 50 KB for test
    # Set mtime/atime to 250 days ago
    old_time = time.time() - (250 * 86400)
    os.utime(old_large, (old_time, old_time))

    # Cloud folder stub
    gdrive_dir = ws / "Google Drive"
    gdrive_dir.mkdir()
    (gdrive_dir / "Budget.gsheet").write_text("stub")

    # Run scan with min_large_size_bytes=10000 (10KB) and forgotten_days=180
    res = scan_storage_analytics(
        workspace_path=ws,
        scan_subpath=".",
        min_large_size_bytes=10000,
        forgotten_days=180,
    )

    assert res.total_files == 5
    assert res.total_size_bytes > 55000
    assert len(res.category_breakdowns) >= 2

    # Check Treemap tree hierarchy
    assert res.tree.name == "workspace"
    assert res.tree.file_count == 5
    assert len(res.tree.children) > 0

    # Check Large & Forgotten Files Hunter
    assert len(res.large_forgotten_files) == 1
    forgotten = res.large_forgotten_files[0]
    assert forgotten.name == "ArchiveDump_2023.tar.gz"
    assert forgotten.days_inactive >= 249
    assert forgotten.category == "Archives"

    # Check Cloud Sync awareness
    assert res.cloud_summary.total_cloud_files == 1
    assert res.cloud_summary.cloud_placeholder_count == 1
    assert "Google Drive" in res.cloud_summary.providers_detected


def test_archive_large_file(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    file_to_archive = ws / "old_backup.zip"
    file_to_archive.write_bytes(b"backupdata")

    res = archive_large_file(
        workspace_path=ws,
        relative_path="old_backup.zip",
        archive_dir_name="Archive",
    )

    assert res["status"] == "success"
    assert not file_to_archive.exists()
    archived_file = ws / "Archive" / "old_backup.zip"
    assert archived_file.exists()
    assert archived_file.read_bytes() == b"backupdata"


def test_trash_large_file(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    file_to_trash = ws / "unneeded_large_file.iso"
    file_to_trash.write_bytes(b"isodata")

    with patch("send2trash.send2trash") as mock_trash:
        res = trash_large_file(
            workspace_path=ws,
            relative_path="unneeded_large_file.iso",
        )
        assert res["status"] == "success"
        mock_trash.assert_called_once_with(str(file_to_trash))

