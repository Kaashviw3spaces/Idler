from pathlib import Path
from typing import Optional, Tuple
from backend.app.schemas.models import ActionPlan, ActionType
from backend.app.security.paths import SecurityException


class PolicyViolationError(SecurityException):
    """Raised when an operation violates security policy."""
    pass


class DestinationCollisionError(PolicyViolationError):
    """Raised when a move/rename would overwrite an existing file."""
    pass


ALLOWED_EXTENSIONS_FOR_ORGANIZATION = {
    ".pdf", ".docx", ".doc", ".txt", ".md", ".csv", ".xlsx", ".pptx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    ".zip", ".tar", ".gz", ".json", ".yaml", ".yml", ".py", ".ts", ".js"
}

DISALLOWED_FILE_NAMES = {
    ".env", ".git", ".gitignore", "id_rsa", "id_ed25519", "authorized_keys"
}


def validate_action_policy(
    action: ActionPlan,
    workspace_root: Path
) -> Tuple[bool, Optional[str]]:
    """
    Validates that the proposed action adheres to system safety policies.
    Returns (is_valid, error_reason).
    """
    # 1. Action type allowlist check
    if action.type not in ActionType:
        return False, f"Action type '{action.type}' is not supported or allowlisted."

    # 2. Block permanent deletion
    if "delete" in action.type.value.lower():
        return False, "Permanent file deletion is strictly disallowed in the MVP."

    # 3. Disallowed system file names anywhere in path components
    src_parts = set(Path(action.source).parts)
    if any(p in DISALLOWED_FILE_NAMES for p in src_parts):
        return False, f"Modifying sensitive configuration file in '{action.source}' is blocked by policy."

    if action.destination:
        dest_parts = set(Path(action.destination).parts)
        if any(p in DISALLOWED_FILE_NAMES for p in dest_parts):
            return False, f"Targeting sensitive path in '{action.destination}' is blocked by policy."

    return True, None


def check_collision_and_preconditions(
    source_path: Path,
    dest_path: Optional[Path],
    action_type: ActionType
) -> None:
    """
    Validates preconditions right before executing a file mutation:
    1. Source must exist.
    2. Destination must not already exist (no silent overwriting).
    """
    if not source_path.exists():
        raise FileNotFoundError(f"Source file does not exist: {source_path}")

    if action_type in (ActionType.MOVE_FILE, ActionType.RENAME_FILE):
        if dest_path is None:
            raise PolicyViolationError(f"Destination path is required for {action_type.value}")
        if dest_path.exists():
            raise DestinationCollisionError(
                f"Destination already exists: '{dest_path}'. Overwriting files is forbidden by policy."
            )
