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
    """
    resolved_dir = validate_and_resolve_path(directory_path, workspace_root, must_exist=True)
    if not resolved_dir.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {resolved_dir}")

    files: List[ScannedFileItem] = []
    total_size = 0
    truncated = False

    iterator = resolved_dir.rglob("*") if recursive else resolved_dir.glob("*")
    for item in iterator:
        # Ignore dotfiles / hidden system files
        if any(part.startswith(".") for part in item.relative_to(workspace_root).parts):
            continue

        if item.is_file():
            if len(files) >= max_files:
                truncated = True
                break
            try:
                stat = item.stat()
                rel_path = to_relative_path(item, workspace_root)
                category = classify_file_by_extension(item.name)
                files.append(
                    ScannedFileItem(
                        name=item.name,
                        relative_path=rel_path,
                        extension=item.suffix.lower(),
                        size_bytes=stat.st_size,
                        modified_time=stat.st_mtime,
                        category=category,
                    )
                )
                total_size += stat.st_size
            except (OSError, PermissionError):
                continue

    return DirectoryScanResult(
        scanned_path=to_relative_path(resolved_dir, workspace_root),
        total_files=len(files),
        total_size_bytes=total_size,
        truncated=truncated,
        files=files,
    )

