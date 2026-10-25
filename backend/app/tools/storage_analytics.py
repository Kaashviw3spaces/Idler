import os
import platform
import stat
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from backend.app.db.models import ActionDB
from backend.app.schemas.analytics import (
    CategoryBreakdown,
    CloudSummary,
    CloudSyncInfo,
    LargeForgottenFile,
    StorageAnalyticsResponse,
    StorageTreeNode,
)
from backend.app.schemas.models import ActionStatus, ActionType
from backend.app.security.paths import to_relative_path, validate_and_resolve_path
from backend.app.tools.classify import classify_file_by_extension
from backend.app.tools.files import move_file_safely
from backend.app.tools.scan import IGNORED_SCAN_DIRS

UF_DATALESS = 0x40000000  # macOS APFS dataless file flag
FILE_ATTRIBUTE_OFFLINE = 0x1000  # Windows offline file
FILE_ATTRIBUTE_REPARSE_POINT = 0x0400  # Windows reparse point (OneDrive / Dropbox)
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000  # Windows placeholder

CLOUD_DIR_PATTERNS = [
    ("iCloud Drive", ["Library/Mobile Documents", "com~apple~CloudDocs", "/iCloud", "iCloud Drive"]),
    ("Google Drive", ["Google Drive", "My Drive", "GoogleDrive"]),
    ("OneDrive", ["OneDrive", ".onedrive"]),
    ("Dropbox", ["Dropbox", ".dropbox"]),
    ("Box", ["Box Sync", "/Box/"]),
]

CLOUD_STUB_EXTENSIONS = {
    ".icloud": ("iCloud Drive", "icloud_stub"),
    ".gdoc": ("Google Drive", "google_docs_stub"),
    ".gsheet": ("Google Drive", "google_docs_stub"),
    ".gslides": ("Google Drive", "google_docs_stub"),
    ".gdraw": ("Google Drive", "google_docs_stub"),
    ".gform": ("Google Drive", "google_docs_stub"),
}

CATEGORY_COLORS: Dict[str, str] = {
    "Images": "#f472b6",
    "Code": "#38bdf8",
    "Documents": "#60a5fa",
    "Spreadsheets": "#4ade80",
    "Archives": "#fb923c",
    "Media": "#c084fc",
    "Presentations": "#facc15",
    "Other": "#94a3b8",
}


def fmt_bytes(b: int) -> str:
    if b < 1024:
        return f"{b} B"
    elif b < 1024 * 1024:
        return f"{b / 1024:.1f} KB"
    elif b < 1024 * 1024 * 1024:
        return f"{b / (1024 * 1024):.1f} MB"
    else:
        return f"{b / (1024 * 1024 * 1024):.2f} GB"


def detect_cloud_sync(file_path: Path, st: Optional[os.stat_result] = None) -> CloudSyncInfo:
    """
    Detects whether a file belongs to a known cloud provider (Google Drive, iCloud, OneDrive, Dropbox, Box)
    and whether it is a cloud-only placeholder (dataless stub) or a fully downloaded local copy.
    """
    path_str = str(file_path)
    provider: Optional[str] = None
    is_placeholder = False
    placeholder_type: Optional[str] = None

    # 1. Check stub extensions (e.g. .icloud, .gdoc, .gsheet)
    suffix = file_path.suffix.lower()
    if suffix in CLOUD_STUB_EXTENSIONS:
        provider, placeholder_type = CLOUD_STUB_EXTENSIONS[suffix]
        is_placeholder = True

    # Check hidden iCloud stub pattern (.filename.ext.icloud)
    if not provider and file_path.name.endswith(".icloud"):
        provider = "iCloud Drive"
        is_placeholder = True
        placeholder_type = "icloud_stub"

    # 2. Check path containment for known cloud synchronization roots
    if not provider:
        for prov_name, patterns in CLOUD_DIR_PATTERNS:
            if any(pat in path_str for pat in patterns):
                provider = prov_name
                break

    is_cloud_file = provider is not None

    # 3. Detect filesystem-level dataless placeholder flags
    if is_cloud_file and not is_placeholder and st is not None:
        # macOS APFS dataless flag
        if hasattr(st, "st_flags") and (st.st_flags & UF_DATALESS) != 0:
            is_placeholder = True
            placeholder_type = "dataless_apfs"
        # Zero blocks allocated on disk for non-empty file
        elif hasattr(st, "st_blocks") and st.st_blocks == 0 and st.st_size > 0:
            is_placeholder = True
            placeholder_type = "dataless_blocks"
        # Windows file attributes
        elif hasattr(st, "st_file_attributes"):
            attrs = st.st_file_attributes
            if (attrs & FILE_ATTRIBUTE_OFFLINE) or (attrs & FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS):
                is_placeholder = True
                placeholder_type = "offline_flag"
            elif (attrs & FILE_ATTRIBUTE_REPARSE_POINT) and provider in ("OneDrive", "Dropbox"):
                is_placeholder = True
                placeholder_type = "reparse_point"

    if is_cloud_file and not is_placeholder:
        placeholder_type = "local_copy"

    warning: Optional[str] = None
    if is_placeholder:
        warning = (
            f"Cloud-only placeholder ({provider or 'Cloud'}): File data is not stored locally. "
            "Opening or copying will trigger an automatic cloud re-download."
        )

    return CloudSyncInfo(
        is_cloud_file=is_cloud_file,
        is_cloud_placeholder=is_placeholder,
        cloud_provider=provider,
        placeholder_type=placeholder_type,
        warning=warning,
    )


def scan_storage_analytics(
    workspace_path: Path,
    scan_subpath: str = ".",
    min_large_size_bytes: int = 500 * 1024 * 1024,
    forgotten_days: int = 180,
    max_tree_depth: int = 4,
) -> StorageAnalyticsResponse:
    """
    Scans the workspace or subpath to produce:
    1. Hierarchical folder size tree for interactive Treemap visualization.
    2. File type distribution / category breakdowns.
    3. Large & Forgotten files hunter (>min_large_size_bytes and inactive > forgotten_days).
    4. Cloud Storage Sync Awareness status and local disk space savings summary.
    """
    t0 = time.perf_counter()
    workspace_path = workspace_path.resolve()
    resolved_target = validate_and_resolve_path(scan_subpath, workspace_path, must_exist=True)

    if not resolved_target.is_dir():
        raise NotADirectoryError(f"Target path is not a directory: {resolved_target}")

    now = time.time()
    cutoff_seconds = forgotten_days * 86400

    total_size = 0
    total_files = 0
    total_dirs = 0

    category_counts: Dict[str, int] = {cat: 0 for cat in CATEGORY_COLORS}
    category_sizes: Dict[str, int] = {cat: 0 for cat in CATEGORY_COLORS}

    large_forgotten_files: List[LargeForgottenFile] = []

    cloud_total = 0
    cloud_placeholder_count = 0
    cloud_local_count = 0
    cloud_saved_bytes = 0
    detected_providers: Set[str] = set()

    # Track directory metadata: dir_path -> {"size": int, "files": int, "cloud_p": int, "cloud_b": int, "subdirs": set, "top_files": []}
    dir_info: Dict[Path, Dict[str, Any]] = {}

    def ensure_dir_entry(d_path: Path) -> Dict[str, Any]:
        if d_path not in dir_info:
            dir_info[d_path] = {
                "size": 0,
                "files": 0,
                "cloud_p": 0,
                "cloud_b": 0,
                "subdirs": set(),
                "top_files": [],
            }
        return dir_info[d_path]

    ensure_dir_entry(resolved_target)

    # Resilient directory walk
    for root_str, dirs, filenames in os.walk(resolved_target, topdown=True, onerror=lambda _: None):
        root_path = Path(root_str)

        # Filter out noisy and hidden directories
        dirs[:] = [
            d for d in dirs
            if not d.startswith(".")
            and not d.endswith(".app")
            and d.lower() not in IGNORED_SCAN_DIRS
        ]

        total_dirs += len(dirs)
        curr_dir_entry = ensure_dir_entry(root_path)

        for d in dirs:
            sub_path = root_path / d
            ensure_dir_entry(sub_path)
            curr_dir_entry["subdirs"].add(sub_path)

        for fname in filenames:
            if fname.startswith("."):
                continue

            file_path = root_path / fname
            try:
                st = file_path.stat()
            except (OSError, PermissionError):
                continue

            f_size = st.st_size
            total_size += f_size
            total_files += 1

            cat = classify_file_by_extension(fname)
            category_counts[cat] = category_counts.get(cat, 0) + 1
            category_sizes[cat] = category_sizes.get(cat, 0) + f_size

            cloud_info = detect_cloud_sync(file_path, st)
            if cloud_info.is_cloud_file:
                cloud_total += 1
                if cloud_info.cloud_provider:
                    detected_providers.add(cloud_info.cloud_provider)
                if cloud_info.is_cloud_placeholder:
                    cloud_placeholder_count += 1
                    cloud_saved_bytes += f_size
                else:
                    cloud_local_count += 1

            # Large & Forgotten check
            atime = getattr(st, "st_atime", st.st_mtime)
            mtime = st.st_mtime
            last_active = max(atime, mtime)
            inactive_secs = max(0.0, now - last_active)
            days_inactive = int(inactive_secs / 86400)

            if f_size >= min_large_size_bytes and days_inactive >= forgotten_days:
                rel_path = to_relative_path(file_path, workspace_path)
                large_forgotten_files.append(
                    LargeForgottenFile(
                        name=fname,
                        relative_path=rel_path,
                        absolute_path=str(file_path),
                        size_bytes=f_size,
                        size_formatted=fmt_bytes(f_size),
                        category=cat,
                        extension=file_path.suffix.lower(),
                        last_accessed=atime,
                        last_accessed_formatted=datetime.fromtimestamp(atime).strftime("%Y-%m-%d"),
                        last_modified=mtime,
                        last_modified_formatted=datetime.fromtimestamp(mtime).strftime("%Y-%m-%d"),
                        days_inactive=days_inactive,
                        cloud_info=cloud_info,
                    )
                )

            # Store significant file in dir_info for treemap file-level leaf representation
            curr_dir_entry["top_files"].append({
                "name": fname,
                "path": to_relative_path(file_path, workspace_path),
                "size": f_size,
                "category": cat,
                "is_placeholder": cloud_info.is_cloud_placeholder,
            })

            # Roll up size and counts up the directory ancestor chain to resolved_target
            anc = root_path
            while True:
                anc_entry = ensure_dir_entry(anc)
                anc_entry["size"] += f_size
                anc_entry["files"] += 1
                if cloud_info.is_cloud_placeholder:
                    anc_entry["cloud_p"] += 1
                    anc_entry["cloud_b"] += f_size

                if anc == resolved_target:
                    break
                parent = anc.parent
                if parent == anc or not parent.is_relative_to(resolved_target):
                    break
                anc = parent

    # Build hierarchical StorageTreeNode
    def build_tree_node(d_path: Path, current_depth: int) -> StorageTreeNode:
        info = dir_info.get(d_path, {"size": 0, "files": 0, "cloud_p": 0, "cloud_b": 0, "subdirs": set(), "top_files": []})
        rel_str = to_relative_path(d_path, workspace_path)
        node_name = d_path.name if d_path != resolved_target else (d_path.name or str(rel_str) or "Workspace")

        children_nodes: List[StorageTreeNode] = []

        if current_depth < max_tree_depth:
            # Sort subdirectories by size descending
            sorted_subdirs = sorted(
                info["subdirs"],
                key=lambda p: dir_info.get(p, {}).get("size", 0),
                reverse=True,
            )
            for sub_p in sorted_subdirs:
                sub_info = dir_info.get(sub_p, {})
                if sub_info.get("size", 0) > 0 or sub_info.get("files", 0) > 0:
                    children_nodes.append(build_tree_node(sub_p, current_depth + 1))

            # Include top individual large files inside this directory as leaf nodes
            sorted_files = sorted(info["top_files"], key=lambda f: f["size"], reverse=True)
            for f in sorted_files[:15]:  # Top 15 prominent files per folder
                if f["size"] > 0:
                    children_nodes.append(
                        StorageTreeNode(
                            name=f["name"],
                            relative_path=f["path"],
                            size_bytes=f["size"],
                            size_formatted=fmt_bytes(f["size"]),
                            file_count=1,
                            is_dir=False,
                            category=f["category"],
                            cloud_placeholders_count=1 if f["is_placeholder"] else 0,
                            cloud_placeholders_bytes=f["size"] if f["is_placeholder"] else 0,
                            children=[],
                        )
                    )

        # Sort all children by size
        children_nodes.sort(key=lambda n: n.size_bytes, reverse=True)

        return StorageTreeNode(
            name=node_name,
            relative_path=rel_str,
            size_bytes=info["size"],
            size_formatted=fmt_bytes(info["size"]),
            file_count=info["files"],
            is_dir=True,
            cloud_placeholders_count=info["cloud_p"],
            cloud_placeholders_bytes=info["cloud_b"],
            children=children_nodes,
        )

    tree_root = build_tree_node(resolved_target, current_depth=0)

    # Build CategoryBreakdowns
    category_breakdowns: List[CategoryBreakdown] = []
    for cat_name, col in CATEGORY_COLORS.items():
        cat_sz = category_sizes.get(cat_name, 0)
        cat_cnt = category_counts.get(cat_name, 0)
        pct = round((cat_sz / total_size * 100), 1) if total_size > 0 else 0.0
        if cat_cnt > 0 or cat_sz > 0:
            category_breakdowns.append(
                CategoryBreakdown(
                    category=cat_name,
                    total_size_bytes=cat_sz,
                    formatted_size=fmt_bytes(cat_sz),
                    file_count=cat_cnt,
                    percentage=pct,
                    color=col,
                )
            )

    category_breakdowns.sort(key=lambda c: c.total_size_bytes, reverse=True)
    large_forgotten_files.sort(key=lambda f: f.size_bytes, reverse=True)

    cloud_summary = CloudSummary(
        total_cloud_files=cloud_total,
        cloud_placeholder_count=cloud_placeholder_count,
        local_copy_count=cloud_local_count,
        space_saved_bytes=cloud_saved_bytes,
        space_saved_formatted=fmt_bytes(cloud_saved_bytes),
        providers_detected=sorted(list(detected_providers)),
        re_download_warning_count=cloud_placeholder_count,
    )

    scan_duration_ms = round((time.perf_counter() - t0) * 1000, 2)

    return StorageAnalyticsResponse(
        workspace_path=str(workspace_path),
        scanned_path=to_relative_path(resolved_target, workspace_path),
        total_size_bytes=total_size,
        total_size_formatted=fmt_bytes(total_size),
        total_files=total_files,
        total_directories=total_dirs,
        tree=tree_root,
        category_breakdowns=category_breakdowns,
        large_forgotten_files=large_forgotten_files,
        cloud_summary=cloud_summary,
        scan_duration_ms=scan_duration_ms,
    )


def trash_large_file(
    workspace_path: Path,
    relative_path: str,
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    """
    Safely moves a large forgotten file to the system Trash via send2trash (never unrecoverable deletion).
    Validates workspace boundaries and records the action into ActionDB ledger.
    """
    from send2trash import send2trash
    import uuid

    workspace_path = workspace_path.resolve()
    abs_path = validate_and_resolve_path(relative_path, workspace_path, must_exist=True)
    if not abs_path.is_file():
        raise FileNotFoundError(f"File not found or is a directory: {relative_path}")

    file_size = abs_path.stat().st_size
    filename = abs_path.name

    # Safe send to OS Trash
    send2trash(str(abs_path))

    # Record in ActionDB
    if db is not None:
        try:
            act_db = ActionDB(
                id=str(uuid.uuid4()),
                task_id=None,
                action_type=ActionType.TRASH_FILE.value,
                status=ActionStatus.COMPLETED.value,
                source=relative_path,
                destination="Trash",
                message=f"Safely moved large file '{filename}' ({fmt_bytes(file_size)}) to Trash",
                rollback_supported=False,
                is_undone=False,
            )
            db.add(act_db)
            db.commit()
        except Exception:
            pass

    return {
        "status": "success",
        "relative_path": relative_path,
        "filename": filename,
        "size_bytes": file_size,
        "size_formatted": fmt_bytes(file_size),
        "message": f"Successfully moved '{filename}' ({fmt_bytes(file_size)}) to Trash. Recoverable anytime.",
    }


def archive_large_file(
    workspace_path: Path,
    relative_path: str,
    archive_dir_name: str = "Archive",
    db: Optional[Session] = None,
) -> Dict[str, Any]:
    """
    Safely moves a large forgotten file into a dedicated Archive/ folder in the workspace.
    Guarantees no collisions, verifies move, and records rollback metadata in ActionDB for 1-click Undo.
    """
    import uuid

    workspace_path = workspace_path.resolve()
    src_abs = validate_and_resolve_path(relative_path, workspace_path, must_exist=True)
    if not src_abs.is_file():
        raise FileNotFoundError(f"File not found or is a directory: {relative_path}")

    # Determine archive target destination
    archive_root = workspace_path / archive_dir_name
    archive_root.mkdir(parents=True, exist_ok=True)

    dest_file = archive_root / src_abs.name
    # Handle name collision safely
    if dest_file.exists():
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest_file = archive_root / f"{src_abs.stem}_{timestamp}{src_abs.suffix}"

    dest_rel = to_relative_path(dest_file, workspace_path)
    action_id = str(uuid.uuid4())

    result = move_file_safely(
        action_id=action_id,
        source_rel=relative_path,
        dest_rel=dest_rel,
        workspace_root=workspace_path,
    )

    if result.status != ActionStatus.COMPLETED:
        raise RuntimeError(f"Archival failed: {result.message} ({result.error or ''})")

    # Record in ActionDB with full rollback support
    if db is not None:
        try:
            import json
            act_db = ActionDB(
                id=action_id,
                task_id=None,
                action_type=ActionType.ARCHIVE_FILE.value,
                status=ActionStatus.COMPLETED.value,
                source=relative_path,
                destination=dest_rel,
                message=f"Archived large file '{src_abs.name}' to '{dest_rel}'",
                rollback_supported=True,
                rollback_metadata_json=json.dumps(result.rollback_metadata) if result.rollback_metadata else None,
                is_undone=False,
            )
            db.add(act_db)
            db.commit()
        except Exception:
            pass

    return {
        "status": "success",
        "action_id": action_id,
        "source": relative_path,
        "destination": dest_rel,
        "message": f"Successfully archived '{src_abs.name}' to '{dest_rel}'. Rollback supported.",
    }
