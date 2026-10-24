from pathlib import Path
from typing import Optional
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


FORBIDDEN_SYSTEM_PATHS = {
    Path("/etc"),
    Path("/bin"),
    Path("/sbin"),
    Path("/usr"),
    Path("/System"),
    Path("/Library"),
    Path("/var"),
    Path("/dev"),
    Path("/private"),
}


def _is_forbidden_system_path(candidate: Path) -> bool:
    """
    Returns True if the candidate path is a protected system directory or root.
    Explicitly permits user directories like ~/Downloads, ~/Desktop, ~/Documents, etc.
    """
    c = candidate.resolve()

    # Disallow root filesystem itself
    if c == Path("/"):
        return True

    # Disallow macOS system Library inside user home directory (e.g. ~/Library)
    try:
        user_library = (Path.home() / "Library").resolve()
        if c == user_library or c.is_relative_to(user_library):
            return True
    except (RuntimeError, ValueError):
        pass

    # Explicitly permit temp directories (used by test fixtures and disposable workspaces)
    for allowed_tmp in [Path("/tmp"), Path("/private/tmp"), Path("/private/var/folders")]:
        try:
            res_tmp = allowed_tmp.resolve()
            if c == res_tmp or c.is_relative_to(res_tmp):
                return False
        except (RuntimeError, ValueError, OSError):
            pass

    # Check system prefixes (/etc, /bin, /usr, /System, /var, etc.)
    for forbidden in FORBIDDEN_SYSTEM_PATHS:
        try:
            resolved_forbidden = forbidden.resolve()
            if c == resolved_forbidden or c.is_relative_to(resolved_forbidden):
                return True
        except (RuntimeError, ValueError, OSError):
            continue

    return False


def validate_new_workspace_path(path_str: str) -> Path:
    """
    Validates a path on the local computer before adding it to allowed workspaces.
    1. Must exist and be a directory.
    2. Must not be a forbidden system directory.
    3. Resolves symlinks and returns absolute canonical Path.
    """
    clean_str = path_str.strip()
    if not clean_str:
        raise InvalidPathError("Workspace path cannot be empty.")

    candidate = Path(clean_str).expanduser().resolve()
    if not candidate.exists():
        raise FileNotFoundError(f"Directory does not exist on your computer: '{candidate}'")
    if not candidate.is_dir():
        raise NotADirectoryError(f"Path is not a directory: '{candidate}'")

    if _is_forbidden_system_path(candidate):
        raise WorkspaceBoundaryError(f"Directory '{candidate}' is a protected system directory.")

    return candidate


def get_all_allowed_roots(db: Optional[object] = None) -> list[Path]:
    """Returns all statically configured and dynamically registered allowed workspace roots."""
    roots = [p for p in settings.get_allowed_workspaces() if "test_workspace" not in str(p).lower()]
    try:
        from backend.app.db.models import WorkspaceDB
        if db is not None:
            db_workspaces = db.query(WorkspaceDB).all()  # type: ignore[attr-defined]
            for w in db_workspaces:
                p = Path(w.path).resolve()
                if "test_workspace" not in str(p).lower() and p not in roots and p.exists() and p.is_dir():
                    roots.append(p)
        else:
            from backend.app.db.database import SessionLocal
            session = SessionLocal()
            try:
                db_workspaces = session.query(WorkspaceDB).all()
                for w in db_workspaces:
                    p = Path(w.path).resolve()
                    if "test_workspace" not in str(p).lower() and p not in roots and p.exists() and p.is_dir():
                        roots.append(p)
            finally:
                session.close()
    except Exception:
        pass
    return roots


def get_default_workspace() -> Path:
    """Returns the primary allowed workspace path."""
    workspaces = get_all_allowed_roots()
    if not workspaces:
        fallback = (Path.home() / "Downloads").resolve()
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback
    workspaces[0].mkdir(parents=True, exist_ok=True)
    return workspaces[0]


def resolve_workspace(workspace_hint: Optional[str] = None) -> Path:
    """
    Validates and resolves a workspace directory.
    Must match one of the allowed workspaces or be a subfolder of an allowed workspace.
    """
    allowed_roots = get_all_allowed_roots()
    if not allowed_roots:
        return get_default_workspace()

    if not workspace_hint:
        return allowed_roots[0]

    raw_hint = Path(workspace_hint).expanduser()
    candidate_variants = []

    if raw_hint.is_absolute():
        candidate_variants.append(raw_hint.resolve())
    else:
        # Relative paths are evaluated against each allowed workspace root so a
        # caller can pass values like "project/subdir" even when the current
        # working directory is not inside the allowed workspace tree.
        candidate_variants.extend((root / raw_hint).resolve() for root in allowed_roots)
        candidate_variants.append(raw_hint.resolve())

    for root in allowed_roots:
        for candidate in candidate_variants:
            try:
                candidate.relative_to(root)
                return candidate
            except ValueError:
                continue

    final_candidate = candidate_variants[0] if candidate_variants else Path(workspace_hint).expanduser().resolve()
    raise WorkspaceBoundaryError(
        f"Workspace '{workspace_hint}' resolves to '{final_candidate}', which is outside allowed workspaces: {allowed_roots}"
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


def resolve_path_in_workspace(path_str: str, workspace_root: Path) -> Path:
    """
    Resolves an absolute or relative path, verifying it is within `workspace_root`.
    Used for soft-delete (trash) operations where the UI sends back the full path
    as reported by the duplicate scanner.
    """
    raw = Path(path_str).expanduser()
    if raw.is_absolute():
        resolved = raw.resolve()
    else:
        resolved = (workspace_root / raw).resolve()

    # Security: must stay within the allowed workspace boundary
    try:
        resolved.relative_to(workspace_root.resolve())
    except ValueError:
        raise WorkspaceBoundaryError(
            f"Path '{path_str}' resolves to '{resolved}', which is outside "
            f"allowed workspace '{workspace_root}'"
        )
    return resolved

