from pathlib import Path
from typing import List, Optional, Tuple
from backend.app.config import settings


class SecurityException(Exception):
    """Base exception for security boundary violations."""
    pass


class PathTraversalError(SecurityException):
    """Raised when a path attempts directory traversal."""
    pass


class WorkspaceBoundaryError(SecurityException):
    """Raised when a path resolves outside an allowed workspace."""
    pass


class InvalidPathError(SecurityException):
    """Raised when a path contains forbidden characters or is malformed."""
    pass


def get_default_workspace() -> Path:
    """Returns the primary allowed workspace path."""
    workspaces = settings.get_allowed_workspaces()
    if not workspaces:
        # Fallback to current working directory test_workspace if none configured
        fallback = Path("./test_workspace").resolve()
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback
    workspaces[0].mkdir(parents=True, exist_ok=True)
    return workspaces[0]


def resolve_workspace(workspace_hint: Optional[str] = None) -> Path:
    """
    Validates and resolves a workspace directory.
    Must match one of the allowed workspaces or be a subfolder of an allowed workspace.
    """
    allowed_roots = settings.get_allowed_workspaces()
    if not allowed_roots:
        return get_default_workspace()

    if not workspace_hint:
        return allowed_roots[0]

    candidate = Path(workspace_hint).expanduser().resolve()
    for root in allowed_roots:
        try:
            candidate.relative_to(root)
            return candidate
        except ValueError:
            continue

    raise WorkspaceBoundaryError(
        f"Workspace '{workspace_hint}' resolves to '{candidate}', which is outside allowed workspaces: {allowed_roots}"
    )


def validate_and_resolve_path(
    path_str: str,
    workspace_root: Path,
    must_exist: bool = False
) -> Path:
    """
    Safely resolves a path relative to workspace_root, checking for:
    - Path traversal attacks (..)
    - Symlink escapes
    - Resolving outside the workspace root boundary
    """
    if not path_str or not path_str.strip():
        raise InvalidPathError("Path cannot be empty.")

    clean_str = path_str.strip()

    # Reject null bytes and suspicious control characters
    if "\x00" in clean_str:
        raise InvalidPathError("Null bytes are forbidden in paths.")

    raw_path = Path(clean_str)

    # Disallow absolute paths that don't match the workspace root
    if raw_path.is_absolute():
        try:
            resolved = raw_path.resolve()
            resolved.relative_to(workspace_root)
            if must_exist and not resolved.exists():
                raise FileNotFoundError(f"Path does not exist: {resolved}")
            return resolved
        except ValueError:
            raise WorkspaceBoundaryError(
                f"Absolute path '{clean_str}' is outside allowed workspace boundary '{workspace_root}'"
            )

    # Resolve relative path inside workspace
    combined = (workspace_root / raw_path)
    try:
        resolved = combined.resolve()
    except Exception as e:
        raise InvalidPathError(f"Could not resolve path '{path_str}': {e}")

    # Boundary check: resolved path must be inside workspace_root
    try:
        resolved.relative_to(workspace_root)
    except ValueError:
        raise PathTraversalError(
            f"Path traversal detected: '{path_str}' escapes workspace boundary '{workspace_root}'"
        )

    # Symlink escape check
    if resolved.is_symlink():
        real_target = resolved.resolve(strict=False)
        try:
            real_target.relative_to(workspace_root)
        except ValueError:
            raise WorkspaceBoundaryError(
                f"Symlink '{path_str}' targets '{real_target}', which is outside workspace '{workspace_root}'"
            )

    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Path does not exist: {resolved}")

    return resolved


def to_relative_path(absolute_path: Path, workspace_root: Path) -> str:
    """Converts an absolute path to a workspace-relative POSIX string."""
    try:
        return str(absolute_path.resolve().relative_to(workspace_root.resolve()).as_posix())
    except ValueError:
        return str(absolute_path.name)
