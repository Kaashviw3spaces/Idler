#!/usr/bin/env python3
"""
Seeds the test_workspace with disposable test files, documents, and duplicates for Idler testing.
"""
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parent.parent / "test_workspace"


def seed_workspace():
    print(f"Seeding workspace at {WORKSPACE}...")

    # Downloads folder: messy downloads needing organization
    downloads = WORKSPACE / "Downloads"
    downloads.mkdir(parents=True, exist_ok=True)

    (downloads / "resume_2026.pdf").write_text("Professional resume of software engineer...")
    (downloads / "quarterly_budget.xlsx").write_text("Q1, Q2, Q3, Q4 Financial Model...")
    (downloads / "project_architecture.png").write_text("PNG image binary data placeholder")
    (downloads / "notes_meeting_oct23.txt").write_text("Action items: complete Idler milestone 9...")
    (downloads / "backup_archive.zip").write_text("ZIP archive content placeholder")
    
    # Intentionally duplicate files in Downloads
    duplicate_content = "This is a duplicate file content that should be caught by SHA-256."
    (downloads / "syllabus.pdf").write_text(duplicate_content)
    (downloads / "syllabus (copy).pdf").write_text(duplicate_content)
    (downloads / "syllabus_download_2.pdf").write_text(duplicate_content)

    # College folder
    college = WORKSPACE / "College"
    college.mkdir(parents=True, exist_ok=True)
    (college / "math_homework_week1.pdf").write_text("Calculus derivatives exercises...")
    (college / "physics_lab_report.docx").write_text("Pendulum experiment measurements...")

    # Projects folder
    projects = WORKSPACE / "Projects"
    projects.mkdir(parents=True, exist_ok=True)
    (projects / "script.py").write_text("def hello():\n    print('Hello Idler!')\n")
    (projects / "config.json").write_text('{"environment": "test"}')

    print("Test workspace populated successfully with sample files!")


if __name__ == "__main__":
    seed_workspace()

