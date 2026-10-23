from pathlib import Path
from typing import Optional, Tuple


def verify_file_moved(
    source_path: Path,
    dest_path: Path,
    expected_size: Optional[int] = None
) -> Tuple[bool, Optional[str]]:
    """
    Verifies that a move operation completed correctly:
    1. Destination file exists and is a file.
    2. Source file no longer exists.
    3. If expected_size is provided, destination file size matches.
    """
    if source_path.exists():
        return False, f"Verification failed: Source file still exists at '{source_path}'"

    if not dest_path.exists():
        return False, f"Verification failed: Destination file missing at '{dest_path}'"

    if not dest_path.is_file():
        return False, f"Verification failed: Destination is not a regular file at '{dest_path}'"

    if expected_size is not None:
        actual_size = dest_path.stat().st_size
        if actual_size != expected_size:
            return False, f"Verification failed: Size mismatch (expected {expected_size}, got {actual_size})"

    return True, None

