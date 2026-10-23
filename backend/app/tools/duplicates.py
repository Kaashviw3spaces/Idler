import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple
from backend.app.schemas.models import DuplicateGroup, DuplicateScanResult
from backend.app.security.paths import validate_and_resolve_path, to_relative_path

CHUNK_SIZE = 65536  # 64 KB chunks for memory-safe streaming


def calculate_sha256(file_path: Path) -> str:
    """Computes SHA-256 hash of a file by streaming in chunks."""
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(CHUNK_SIZE):
            sha.update(chunk)
    return sha.hexdigest()


def find_duplicates(
    directory_path: str,
    workspace_root: Path,
    recursive: bool = True
) -> DuplicateScanResult:
    """
    Finds exact duplicate files within the target directory:
    1. Quick pass: group files by file size.
    2. Deep pass: compute SHA-256 for size matches.
    3. Returns DuplicateScanResult (strictly read-only, no deletion).
    """
    target_dir = validate_and_resolve_path(directory_path, workspace_root, must_exist=True)
    if not target_dir.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {target_dir}")

    # Step 1: Group by file size
    size_map: Dict[int, List[Path]] = defaultdict(list)
    total_files_scanned = 0

    iterator = target_dir.rglob("*") if recursive else target_dir.glob("*")
    for item in iterator:
        if any(part.startswith(".") for part in item.relative_to(workspace_root).parts):
            continue

        if item.is_file():
            total_files_scanned += 1
            try:
                size = item.stat().st_size
                if size > 0:  # Skip zero-byte files from duplicate grouping
                    size_map[size].append(item)
            except (OSError, PermissionError):
                continue

    # Step 2: For sizes with > 1 file, hash and group
    duplicate_groups: List[DuplicateGroup] = []
    total_wasted_bytes = 0

    for size, candidate_files in size_map.items():
        if len(candidate_files) < 2:
            continue

        hash_map: Dict[str, List[Path]] = defaultdict(list)
        for f in candidate_files:
            try:
                file_hash = calculate_sha256(f)
                hash_map[file_hash].append(f)
            except (OSError, PermissionError):
                continue

        for file_hash, matching_files in hash_map.items():
            if len(matching_files) > 1:
                rel_paths = [to_relative_path(mf, workspace_root) for mf in matching_files]
                duplicate_groups.append(
                    DuplicateGroup(
                        size_bytes=size,
                        sha256=file_hash,
                        count=len(matching_files),
                        paths=rel_paths,
                    )
                )
                total_wasted_bytes += size * (len(matching_files) - 1)

    return DuplicateScanResult(
        scanned_files=total_files_scanned,
        duplicate_groups=duplicate_groups,
        total_wasted_bytes=total_wasted_bytes,
    )
