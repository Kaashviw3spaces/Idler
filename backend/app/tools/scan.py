import os
from pathlib import Path
from typing import Dict, List
from pydantic import BaseModel, Field
from backend.app.security.paths import validate_and_resolve_path, to_relative_path
from backend.app.tools.classify import classify_file_by_extension

IGNORED_SCAN_DIRS = {
    "node_modules", "venv", ".venv", "env", "__pycache__", ".git", ".next", "dist", "build", ".cache"
}


class ScannedFileItem(BaseModel):
    name: str
    relative_path: str
    extension: str
    size_bytes: int
    modified_time: float
    category: str


class DirectoryScanResult(BaseModel):
    scanned_path: str
    total_files: int
    total_size_bytes: int
    truncated: bool
    files: List[ScannedFileItem]
    subdirectories: List[str] = Field(default_factory=list)
    folder_counts: Dict[str, int] = Field(default_factory=dict)


def scan_directory(
    directory_path: str,
    workspace_root: Path,
    recursive: bool = True,
    max_files: int = 1000
) -> DirectoryScanResult:
    """
    Safely scans a directory within the workspace up to max_files.
    Uses resilient scanning so individual permission errors never abort the scan.
    Skips application bundles (.app) and junk development/cache directories.
    """
    resolved_dir = validate_and_resolve_path(directory_path, workspace_root, must_exist=True)
    if not resolved_dir.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {resolved_dir}")

    files: List[ScannedFileItem] = []
    total_size = 0
    truncated = False

    if not recursive:
        try:
            with os.scandir(resolved_dir) as it:
                for entry in it:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            if len(files) >= max_files:
                                truncated = True
                                break
                            stat = entry.stat()
                            item_path = Path(entry.path)
                            rel_path = to_relative_path(item_path, workspace_root)
                            category = classify_file_by_extension(entry.name)
                            files.append(
                                ScannedFileItem(
                                    name=entry.name,
                                    relative_path=rel_path,
                                    extension=item_path.suffix.lower(),
                                    size_bytes=stat.st_size,
                                    modified_time=stat.st_mtime,
                                    category=category,
                                )
                            )
                            total_size += stat.st_size
                    except (OSError, PermissionError):
                        continue
        except (OSError, PermissionError):
            pass
    else:
        # Use os.walk with error handler so unreadable subdirs don't abort scanning
        for root, dirs, filenames in os.walk(resolved_dir, topdown=True, onerror=lambda err: None):
            # Prune hidden dot-directories, macOS app bundles, and package junk in-place
            dirs[:] = [
                d for d in dirs
                if not d.startswith(".")
                and not d.endswith(".app")
                and d.lower() not in IGNORED_SCAN_DIRS
            ]

            for filename in filenames:
                if filename.startswith("."):
                    continue
                if len(files) >= max_files:
                    truncated = True
                    break

                file_path = Path(root) / filename
                try:
                    stat = file_path.stat()
                    rel_path = to_relative_path(file_path, workspace_root)
                    category = classify_file_by_extension(filename)
                    files.append(
                        ScannedFileItem(
                            name=filename,
                            relative_path=rel_path,
                            extension=file_path.suffix.lower(),
                            size_bytes=stat.st_size,
                            modified_time=stat.st_mtime,
                            category=category,
                        )
                    )
                    total_size += stat.st_size
                except (OSError, PermissionError):
                    continue

            if truncated:
                break

    # Compute subdirectories and folder counts inside this directory
    folder_counts: Dict[str, int] = {}
    for f in files:
        rel_parts = Path(f.relative_path).parts
        folder_name = rel_parts[0] if len(rel_parts) > 1 else "(root)"
        folder_counts[folder_name] = folder_counts.get(folder_name, 0) + 1

    subdirs = [f for f in sorted(folder_counts.keys()) if f != "(root)"]

    # Also discover any subdirectories directly in resolved_dir that might have 0 scanned files
    try:
        with os.scandir(resolved_dir) as entries:
            for e in entries:
                if (
                    e.is_dir(follow_symlinks=False)
                    and not e.name.startswith(".")
                    and not e.name.endswith(".app")
                    and e.name.lower() not in IGNORED_SCAN_DIRS
                ):
                    if e.name not in subdirs:
                        subdirs.append(e.name)
                        if e.name not in folder_counts:
                            folder_counts[e.name] = 0
    except (OSError, PermissionError):
        pass
    subdirs.sort()

    return DirectoryScanResult(
        scanned_path=to_relative_path(resolved_dir, workspace_root),
        total_files=len(files),
        total_size_bytes=total_size,
        truncated=truncated,
        files=files,
        subdirectories=subdirs,
        folder_counts=folder_counts,
    )
