# Idler — Repository Layout and Ownership Guide

**Purpose:** Define the proposed source tree, explain what belongs in each area, and keep responsibilities separated as the project grows.

## 1. Proposed Repository Tree

```text
idler/
├── frontend/                    # React + Vite user interface
│   ├── public/
│   ├── src/
│   │   ├── api/                 # Typed API client
│   │   ├── components/          # Reusable UI components
│   │   ├── features/
│   │   │   ├── planner/         # Request form and plan preview
│   │   │   ├── tasks/           # Task status and results
│   │   │   ├── history/         # Action Ledger
│   │   │   └── workflows/       # Saved workflows
│   │   ├── types/               # Frontend API types
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app and route registration
│   │   ├── config.py            # Validated configuration
│   │   ├── schemas/             # Pydantic request/response/plan models
│   │   ├── api/                 # HTTP route handlers
│   │   ├── agent/
│   │   │   ├── planner.py       # Request-to-plan orchestration
│   │   │   ├── prompts.py       # Model prompts
│   │   │   └── model_client.py  # Ollama adapter
│   │   ├── security/
│   │   │   ├── paths.py         # Workspace and path validation
│   │   │   └── policies.py      # Action allowlists and approval policy
│   │   ├── tools/
│   │   │   ├── scan.py          # Bounded directory scan
│   │   │   ├── classify.py      # Deterministic/model-assisted classification
│   │   │   ├── duplicates.py    # Hash-based exact duplicate detection
│   │   │   ├── files.py         # Move, rename and metadata operations
│   │   │   └── verify.py        # Postcondition checks
│   │   ├── services/
│   │   │   ├── executor.py      # Validated plan execution
│   │   │   ├── ledger.py        # Action history and undo
│   │   │   └── workflows.py     # Saved workflow logic
│   │   ├── db/
│   │   │   ├── database.py      # SQLite connection/session setup
│   │   │   └── models.py        # Persistence models
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── security/
│   ├── requirements.txt
│   └── Dockerfile
│
├── test_workspace/              # Disposable fixtures only; never personal files
│   ├── Downloads/
│   ├── College/
│   └── Projects/
│
├── docs/
│   ├── prd.md                   # Product requirements and acceptance criteria
│   ├── arch.md                  # Architecture and trust boundaries
│   ├── execution.md             # Phased build plan
│   ├── roots.md                 # Repository layout guide
│   ├── security.md              # Threat model and safe-use guidance
│   └── decisions/               # Architecture decision records
│
├── scripts/                     # Development/test helper scripts
├── .env.example                 # Placeholder configuration only
├── .gitignore
├── docker-compose.yml
├── pyproject.toml               # Optional Python project/tool configuration
├── README.md
└── LICENSE
```

This is a proposed layout. It is acceptable to begin with fewer modules and split files only when responsibilities justify it. Avoid creating empty files solely to match the diagram.

## 2. Responsibility Boundaries

### `frontend/`
Owns presentation and user interaction only. It must not decide whether a path is permitted or whether a plan is safe.

### `backend/app/agent/`
Owns model interaction and plan generation. Model output is untrusted and must pass schema and policy validation before it can reach the executor.

### `backend/app/security/`
Owns the authoritative workspace boundary, path checks, supported-action allowlist, and approval rules. Keep security checks centralized and call them from every mutation path.

### `backend/app/tools/`
Contains small deterministic operations. Each tool should have explicit input/output schemas, permission requirements, and tests.

### `backend/app/services/executor.py`
Coordinates a validated plan, tracks per-action status, calls permitted tools, and invokes verification. It should not contain arbitrary code evaluation or unrestricted shell execution.

### `backend/app/services/ledger.py`
Records actions and supports safe rollback for explicitly supported operations. Never erase the original event when an action is undone.

### `backend/app/services/workflows.py`
Stores declarative workflow definitions and revalidates them on every run. Saved workflows must not store arbitrary executable Python or shell commands.

### `backend/app/db/`
Owns persistence details. Keep database access out of route handlers and model prompts.

### `test_workspace/`
Contains disposable fixtures only. Never commit private documents, real downloads, tokens, or personal files. Add representative fake files and duplicate fixtures for testing.

### `docs/`
Contains requirements, architecture, execution steps, repository conventions, security notes, and decision records.

## 3. Import and Dependency Direction

Prefer this dependency direction:

```text
API routes
   |
   v
Application services
   |
   +----> Agent / model adapter
   |
   +----> Security policies
   |
   +----> Executor and tools
   |
   +----> Persistence
```

More specifically:
- Routes call services; routes should remain thin.
- The planner can depend on schemas and the model adapter.
- The executor depends on schemas, policies, tools, and ledger services.
- Tools must not call the language model.
- Security checks must not depend on the model's opinion.
- The UI talks to the backend API, never directly to the host filesystem.
- Avoid circular imports; pass dependencies through constructors or function arguments where useful.

## 4. Naming and Code Conventions

- Use `snake_case` for Python modules, functions, and variables.
- Use `PascalCase` for Python classes and TypeScript components.
- Give actions explicit names such as `scan_directory`, `move_file`, `hash_file`, and `undo_move`.
- Prefer typed request and response models.
- Keep functions small and deterministic where possible.
- Do not use names such as `run_anything`, `execute_command`, or `eval_model_output` for model-controlled actions.
- Add a test for every new tool and every permission-sensitive change.
- Document whether an operation mutates state and whether rollback is supported.

## 5. Environment and Secret Handling

- `.env.example` may contain variable names and harmless placeholders.
- Never commit real API keys, access tokens, passwords, or personal paths.
- Add `.env`, local databases, model files, logs, caches, build outputs, and private test data to `.gitignore` as appropriate.
- Avoid hardcoding a Windows username or absolute personal directory.
- Configure workspaces explicitly through local settings or environment variables.
- Bind local development APIs to loopback by default; do not expose the API to the network without deliberate authentication and configuration.

## 6. Suggested Initial Files

Start with only the files needed for the first vertical slice:

1. `backend/app/main.py`
2. `backend/app/config.py`
3. `backend/app/schemas/plan.py`
4. `backend/app/agent/model_client.py`
5. `backend/app/agent/planner.py`
6. `backend/app/security/paths.py`
7. `backend/app/security/policies.py`
8. `backend/app/tools/scan.py`
9. `backend/app/tools/files.py`
10. `backend/app/tools/verify.py`
11. `backend/app/services/executor.py`
12. `backend/app/services/ledger.py`
13. Unit and security tests
14. `Dockerfile`, Compose configuration, and `.env.example` when the runtime layout is chosen

Add duplicate detection and workflows after the first approved, verified, reversible operation works.

## 7. Pull Request Checklist

Before merging a change:
- [ ] The scope and behavior are described.
- [ ] Inputs and outputs are typed and validated.
- [ ] Permission checks happen on the backend.
- [ ] No arbitrary model-generated code or shell command is executed.
- [ ] Failure and collision paths are handled.
- [ ] Tests cover the new behavior.
- [ ] Logs avoid unnecessary sensitive data.
- [ ] Documentation is updated.
- [ ] No secrets or private files are included.
