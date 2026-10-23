from pathlib import Path
from typing import Dict, List

EXTENSION_CATEGORIES: Dict[str, List[str]] = {
    "Documents": [".pdf", ".docx", ".doc", ".txt", ".md", ".rtf", ".odt", ".pages"],
    "Spreadsheets": [".xlsx", ".xls", ".csv", ".tsv", ".numbers"],
    "Presentations": [".pptx", ".ppt", ".key"],
    "Images": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tiff", ".ico"],
    "Code": [".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".json", ".yaml", ".yml", ".sh", ".sql", ".rs", ".go", ".c", ".cpp"],
    "Archives": [".zip", ".tar", ".gz", ".7z", ".rar", ".bz2"],
    "Media": [".mp3", ".wav", ".flac", ".mp4", ".mov", ".mkv", ".avi", ".webm"]
}


def classify_file_by_extension(filename: str) -> str:
    """Returns category folder name based on file extension."""
    suffix = Path(filename).suffix.lower()
    for category, extensions in EXTENSION_CATEGORIES.items():
        if suffix in extensions:
            return category
    return "Other"
