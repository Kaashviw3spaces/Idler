from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class CloudSyncInfo(BaseModel):
    is_cloud_file: bool = False
    is_cloud_placeholder: bool = False
    cloud_provider: Optional[str] = None  # "iCloud Drive", "Google Drive", "OneDrive", "Dropbox", etc.
    placeholder_type: Optional[str] = None  # "dataless_apfs", "dataless_blocks", "icloud_stub", "google_docs_stub", "reparse_point", "offline_flag", "local_copy"
    warning: Optional[str] = None


class LargeForgottenFile(BaseModel):
    name: str
    relative_path: str
    absolute_path: str
    size_bytes: int
    size_formatted: str
    category: str
    extension: str
    last_accessed: float
    last_accessed_formatted: str
    last_modified: float
    last_modified_formatted: str
    days_inactive: int
    cloud_info: CloudSyncInfo


class CategoryBreakdown(BaseModel):
    category: str
    total_size_bytes: int
    formatted_size: str
    file_count: int
    percentage: float
    color: str


class StorageTreeNode(BaseModel):
    name: str
    relative_path: str
    size_bytes: int
    size_formatted: str
    file_count: int
    is_dir: bool = True
    category: Optional[str] = None
    cloud_placeholders_count: int = 0
    cloud_placeholders_bytes: int = 0
    children: List["StorageTreeNode"] = Field(default_factory=list)


class CloudSummary(BaseModel):
    total_cloud_files: int = 0
    cloud_placeholder_count: int = 0
    local_copy_count: int = 0
    space_saved_bytes: int = 0
    space_saved_formatted: str = "0 B"
    providers_detected: List[str] = Field(default_factory=list)
    re_download_warning_count: int = 0


class StorageAnalyticsResponse(BaseModel):
    workspace_path: str
    scanned_path: str
    total_size_bytes: int
    total_size_formatted: str
    total_files: int
    total_directories: int
    tree: StorageTreeNode
    category_breakdowns: List[CategoryBreakdown]
    large_forgotten_files: List[LargeForgottenFile]
    cloud_summary: CloudSummary
    scan_duration_ms: float


class LargeFileTrashRequest(BaseModel):
    relative_path: str
    workspace_path: Optional[str] = None


class LargeFileArchiveRequest(BaseModel):
    relative_path: str
    workspace_path: Optional[str] = None
    archive_dir: Optional[str] = "Archive"

