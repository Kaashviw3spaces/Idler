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

    # Seed Sample Project 1: Node/TypeScript Web App
    portfolio = projects / "portfolio-site"
    portfolio.mkdir(parents=True, exist_ok=True)
    (portfolio / "package.json").write_text('{\n  "name": "portfolio-site",\n  "version": "1.0.0",\n  "scripts": { "dev": "vite" }\n}\n')
    (portfolio / "index.js").write_text('console.log("Welcome to my portfolio site!");\n')
    (portfolio / "styles.css").write_text('body { font-family: sans-serif; margin: 0; }\n')
    (portfolio / "README.md").write_text('# Portfolio Site\n\nA modern personal portfolio website built with React and Vite.\n\n## Getting Started\n`npm install` and `npm run dev`.\n')

    # Seed Sample Project 2: Python Data Pipeline
    data_pipe = projects / "data-pipeline"
    data_pipe.mkdir(parents=True, exist_ok=True)
    (data_pipe / "pyproject.toml").write_text('[project]\nname = "data-pipeline"\nversion = "0.1.0"\ndependencies = ["pandas", "pydantic"]\n')
    (data_pipe / "main.py").write_text('import sys\n\ndef main():\n    print("Processing local data records...")\n\nif __name__ == "__main__":\n    main()\n')
    (data_pipe / "utils.py").write_text('def clean_record(raw):\n    return raw.strip().lower()\n')
    (data_pipe / "README.md").write_text('# Data Pipeline Tool\n\nAutomated batch ingestion and cleaning script for local tabular datasets.\n\n## Usage\n`python main.py`\n')

    print("Test workspace populated successfully with sample files and projects!")


if __name__ == "__main__":
    seed_workspace()

