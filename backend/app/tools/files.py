import shutil
from pathlib import Path
from typing import Dict, Any, Optional
from backend.app.schemas.models import ActionResult, ActionStatus, ActionType
from backend.app.security.paths import (
    validate_and_resolve_path,
    to_relative_path,
    SecurityException,
)
from backend.app.security.policies import (
    check_collision_and_preconditions,
    PolicyViolationError,
)
from backend.app.tools.verify import verify_file_moved


def move_file_safely(
    action_id: str,
    source_rel: str,
    dest_rel: str,
    workspace_root: Path
) -> ActionResult:
    """
    Safely moves a file from source to destination within the workspace.
    Guarantees no overwrite, verifies postcondition, and records rollback metadata.
    """
    try:
        src = validate_and_resolve_path(source_rel, workspace_root, must_exist=True)
        dst = validate_and_resolve_path(dest_rel, workspace_root, must_exist=False)

        # Check policy and collision
        check_collision_and_preconditions(src, dst, ActionType.MOVE_FILE)

        src_size = src.stat().st_size

        # Ensure parent directory for destination exists
        dst.parent.mkdir(parents=True, exist_ok=True)

        # Perform atomic/safe filesystem move
        shutil.move(str(src), str(dst))

        # Verification step
        verified, err = verify_file_moved(src, dst, expected_size=src_size)
        if not verified:
            return ActionResult(
                action_id=action_id,
                action_type=ActionType.MOVE_FILE,
                status=ActionStatus.FAILED,
                source=source_rel,
                destination=dest_rel,
                message="Filesystem move could not be verified",
                error=err,
                rollback_supported=False,
            )

        return ActionResult(
            action_id=action_id,
            action_type=ActionType.MOVE_FILE,
            status=ActionStatus.COMPLETED,
            source=to_relative_path(src, workspace_root),
            destination=to_relative_path(dst, workspace_root),
            message=f"Successfully moved '{source_rel}' to '{dest_rel}'",
            rollback_supported=True,
            rollback_metadata={
                "original_source": to_relative_path(src, workspace_root),
                "original_destination": to_relative_path(dst, workspace_root),
                "file_size": src_size,
            },
        )

    except (SecurityException, FileNotFoundError, PolicyViolationError) as e:
        return ActionResult(
            action_id=action_id,
            action_type=ActionType.MOVE_FILE,
            status=ActionStatus.FAILED,
            source=source_rel,
            destination=dest_rel,
            message=f"Move blocked by safety check: {str(e)}",
            error=str(e),
            rollback_supported=False,
        )
    except Exception as e:
        return ActionResult(
            action_id=action_id,
            action_type=ActionType.MOVE_FILE,
            status=ActionStatus.FAILED,
            source=source_rel,
            destination=dest_rel,
            message=f"Unexpected error executing move: {str(e)}",
            error=str(e),
            rollback_supported=False,
        )


def rename_file_safely(
    action_id: str,
    source_rel: str,
    new_name: str,
    workspace_root: Path
) -> ActionResult:
    """
    Safely renames a file within its current directory.
    """
    try:
        src = validate_and_resolve_path(source_rel, workspace_root, must_exist=True)
        # Ensure new_name is just a single filename, not a path
        clean_new_name = Path(new_name).name
        dst = src.parent / clean_new_name
        dest_rel = to_relative_path(dst, workspace_root)

        check_collision_and_preconditions(src, dst, ActionType.RENAME_FILE)
        src_size = src.stat().st_size

        src.rename(dst)

        verified, err = verify_file_moved(src, dst, expected_size=src_size)
        if not verified:
            return ActionResult(
                action_id=action_id,
                action_type=ActionType.RENAME_FILE,
                status=ActionStatus.FAILED,
                source=source_rel,
                destination=dest_rel,
                message="Rename verification failed",
                error=err,
                rollback_supported=False,
            )

        return ActionResult(
            action_id=action_id,
            action_type=ActionType.RENAME_FILE,
            status=ActionStatus.COMPLETED,
            source=to_relative_path(src, workspace_root),
            destination=dest_rel,
            message=f"Successfully renamed to '{clean_new_name}'",
            rollback_supported=True,
            rollback_metadata={
                "original_source": to_relative_path(src, workspace_root),
                "original_destination": dest_rel,
                "file_size": src_size,
            },
        )
    except Exception as e:
        return ActionResult(
            action_id=action_id,
            action_type=ActionType.RENAME_FILE,
            status=ActionStatus.FAILED,
            source=source_rel,
            destination=new_name,
            message=f"Rename failed: {str(e)}",
            error=str(e),
            rollback_supported=False,
        )
