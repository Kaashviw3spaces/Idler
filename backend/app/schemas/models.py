import uuid
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ActionType(str, Enum):
    SCAN_DIRECTORY = "scan_directory"
    MOVE_FILE = "move_file"
    RENAME_FILE = "rename_file"
    FIND_DUPLICATES = "find_duplicates"
    SUMMARIZE_PROJECT = "summarize_project"


class ActionStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ROLLED_BACK = "rolled_back"


class TaskStatus(str, Enum):
    RECEIVED = "received"
    PLANNING = "planning"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    EXECUTING = "executing"
    COMPLETED = "completed"
    PARTIAL_FAILURE = "partial_failure"
    FAILED = "failed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class TaskCreateRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=1000, description="Natural language request")
    workspace_path: Optional[str] = Field(None, description="Optional target workspace relative or absolute path")
    parameters: Optional[Dict[str, Any]] = Field(default_factory=dict)


class WorkspaceRegisterRequest(BaseModel):
    path: str = Field(..., min_length=1, description="Absolute or home-relative path on local computer")
    name: Optional[str] = Field(None, description="Optional friendly name for this workspace")


class ActionPlan(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: ActionType
    source: str = Field(..., description="Workspace-relative path to source file or directory")
    destination: Optional[str] = Field(None, description="Workspace-relative path to destination file or directory")
    reason: Optional[str] = Field(None, description="Explanation for this action")
    requires_approval: bool = True
    parameters: Dict[str, Any] = Field(default_factory=dict)


class PlanResponse(BaseModel):
    task_id: str
    query: str
    workspace_path: str
    actions: List[ActionPlan]
    summary: str
    requires_approval: bool = True
    status: TaskStatus = TaskStatus.AWAITING_APPROVAL


class ActionResult(BaseModel):
    action_id: str
    action_type: ActionType
    status: ActionStatus
    source: Optional[str] = None
    destination: Optional[str] = None
    message: str
    error: Optional[str] = None
    rollback_supported: bool = False
    rollback_metadata: Optional[Dict[str, Any]] = None


class TaskExecutionSummary(BaseModel):
    task_id: str
    status: TaskStatus
    total_actions: int
    completed_actions: int
    failed_actions: int
    skipped_actions: int
    results: List[ActionResult]


class DuplicateGroup(BaseModel):
    size_bytes: int
    sha256: str
    count: int
    paths: List[str]


class DuplicateScanResult(BaseModel):
    scanned_files: int
    duplicate_groups: List[DuplicateGroup]
    total_wasted_bytes: int

