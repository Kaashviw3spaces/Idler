from pathlib import Path
from typing import Dict, List, Optional

from backend.app.schemas.models import ProjectInspectionResult
from backend.app.security.paths import validate_and_resolve_path, to_relative_path

IGNORED_DIRS = {
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "venv",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "dist",
    "build",
    ".idea",
    ".vscode",
}

EXT_LANG_MAP: Dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c_header",
    ".hpp": "cpp_header",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".sh": "shell",
}


def inspect_project(
    rel_path: str,
    workspace_root: Path,
    max_readme_chars: int = 4096
) -> ProjectInspectionResult:
    """
    Safely inspects a project or repository directory within workspace bounds.
    Treats all file contents (like README) as untrusted text.
    Never executes any project scripts, binaries, or build tools.
    """
    target = validate_and_resolve_path(rel_path, workspace_root, must_exist=True)
    if not target.is_dir():
        raise NotADirectoryError(f"Target path '{rel_path}' is not a directory")

    # Detect project types
    project_types: List[str] = []
    if (target / "package.json").exists() or (target / "tsconfig.json").exists():
        project_types.append("node")
    if (target / "pyproject.toml").exists() or (target / "requirements.txt").exists() or (target / "setup.py").exists():
        project_types.append("python")
    if (target / "Cargo.toml").exists():
        project_types.append("rust")
    if (target / "go.mod").exists():
        project_types.append("go")
    if (target / "pom.xml").exists() or (target / "build.gradle").exists():
        project_types.append("java")

    detected_type = "/".join(project_types) if project_types else "generic"

    # Locate and read README as untrusted plain text
    readme_snippet: Optional[str] = None
    readme_candidates = ["README.md", "readme.md", "README.txt", "README", "readme.txt"]
    for candidate_name in readme_candidates:
        candidate_path = target / candidate_name
        if candidate_path.exists() and candidate_path.is_file():
            try:
                # Read at most max_readme_chars to avoid memory / context bloat
                text = candidate_path.read_text(encoding="utf-8", errors="replace")[:max_readme_chars]
                readme_snippet = text.strip()
                break
            except Exception:
                pass

    # Gather file counts and languages
    total_files = 0
    languages: Dict[str, int] = {}
    key_files: List[str] = []

    for item in target.rglob("*"):
        # Skip ignored directories
        if any(part in IGNORED_DIRS for part in item.parts):
            continue

        if item.is_file():
            total_files += 1
            ext = item.suffix.lower()
            lang = EXT_LANG_MAP.get(ext, "other")
            languages[lang] = languages.get(lang, 0) + 1

            # Identify key files at root or 1 level down
            try:
                rel = item.relative_to(target)
                if len(rel.parts) <= 2 and rel.name in {
                    "package.json", "pyproject.toml", "requirements.txt",
                    "Cargo.toml", "go.mod", "Dockerfile", "docker-compose.yml",
                    "Makefile", "main.py", "app.py", "index.ts", "index.js",
                    "App.tsx", "README.md"
                }:
                    key_files.append(str(rel.as_posix()))
            except ValueError:
                pass

    return ProjectInspectionResult(
        project_path=to_relative_path(target, workspace_root),
        project_type=detected_type,
        total_files=total_files,
        readme_snippet=readme_snippet,
        key_files=key_files,
        languages=languages,
    )

