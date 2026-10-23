import os
from pathlib import Path
from typing import List
from pydantic import BaseModel
from backend.app.security.paths import validate_and_resolve_path, to_relative_path
from backend.app.tools.classify import classify_file_by_extension


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


def scan_directory(
    directory_path: str,
    workspace_root: Path,
    recursive: bool = True,
    max_files: int = 500
) -> DirectoryScanResult:
    """
    Safely scans a directory within the workspace up to max_files.
    Uses resilient scanning so individual permission errors never abort the scan.
    """
    resolved_dir = validate_and_resolve_path(directory_path, workspace_root, must_exist=True)
    if not resolved_dir.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {resolved_dir}")

    files: List[ScannedFileItem] = []
    total_size = 0
    truncated = False

    if not recursive:
        try:
            with os.scandir(resolved_dir) as entries:
                for entry in entries:
                    if entry.name.startswith("."):
                        continue
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
            # Prune hidden dot-directories in-place
            dirs[:] = [d for d in dirs if not d.startswith(".")]

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

    return DirectoryScanResult(
        scanned_path=to_relative_path(resolved_dir, workspace_root),
        total_files=len(files),
        total_size_bytes=total_size,
        truncated=truncated,
        files=files,
    )

