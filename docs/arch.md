# Idler — Architecture

**Status:** Proposed architecture  
**Primary design principle:** Separate model planning from permission enforcement and execution.

## 1. System Overview

Idler accepts natural-language requests, uses a local Gemma model to propose a structured plan, validates that plan, obtains user approval, executes a limited set of operations, verifies results, and records an audit trail.

```text
+------------------------+
| React + Vite UI        |
| Request / Preview      |
| Approve / History      |
+-----------+------------+
            | HTTP
            v
+------------------------+
| FastAPI Backend        |
| Task lifecycle         |
| API validation         |
+-----------+------------+
            |
            v
+------------------------+       +----------------------+
| Planner / Agent        |------>| Ollama + Gemma       |
| Prompt + schema        |       | Local inference      |
+-----------+------------+       +----------------------+
            |
            v
+------------------------+
| Policy / Permissions   |
| Allowlisted tools      |
| Workspace/path checks  |
+-----------+------------+
            |
       User approval
            |
            v
+------------------------+
| Restricted Executor    |
| Scan / Move / Rename   |
| Hash / Verify          |
+-----------+------------+
            |
       +----+-----+
       |          |
       v          v
+-------------+ +------------------+
| SQLite      | | Filesystem       |
| Tasks       | | Approved paths   |
| Actions     | | Host workspace   |
| Workflows   | +------------------+
+-------------+
```

## 2. Components

### Frontend — React + Vite
- Capture user requests.
- Show plans before execution.
- Display source and destination paths.
- Collect explicit approval.
- Show progress, failures, history, and rollback status.
- Never make security decisions solely in the browser.

### API — FastAPI
- Validate request shape and size.
- Create task records and task states.
- Call the planner and model adapter.
- Return plans for review.
- Require approval before mutation.
- Coordinate executor, verifier, ledger, and workflow services.

### Model adapter — Ollama + Gemma
- Connect to a locally configured Ollama endpoint.
- Use a chosen Gemma 4B-class model tag.
- Request structured output where supported.
- Apply timeouts and handle runtime/model errors.
- Treat all model output as untrusted until validated.
- Do not give the model direct filesystem or shell access.

### Planner
Converts user intent into a typed plan. A plan should contain only supported action types and explicit arguments, for example:

```json
{
  "task_type": "organize_files",
  "workspace_id": "sample-downloads",
  "actions": [
    {
      "type": "move_file",
      "source": "notes/week1.pdf",
      "destination": "Documents/notes-week1.pdf",
      "reason": "PDF document"
    }
  ],
  "requires_approval": true
}
```

This is an illustrative schema, not a final API contract. Prefer workspace-relative paths rather than arbitrary absolute paths.

### Policy and permissions
- Resolve workspace IDs to configured directories.
- Normalize and validate all paths.
- Reject path traversal, disallowed file types/operations, symlink escapes, and targets outside the workspace.
- Check destination conflicts and current file state.
- Enforce approval and task state on the server.
- Use a fixed action registry; never evaluate model-generated code.

### Executor
- Implements small deterministic tools: scan, classify, hash, move, rename, and verify.
- Operates only within approved workspaces.
- Uses safe filesystem operations and handles collisions explicitly.
- Records a result for each action.
- Does not permanently delete files in the MVP.

### Action Ledger / rollback
Record:
- Action ID and task ID.
- Timestamp and operation type.
- Source and destination relative paths.
- Precondition and postcondition details where useful.
- Status and error details.
- Rollback metadata and rollback status.

Before undoing, confirm the expected file is still present and the original location is safe to restore to. If state has changed or a conflict exists, stop and ask the user.

### Workflow service
- Stores declarative workflow definitions in SQLite.
- Supports manual reruns first.
- Revalidates all paths, permissions, and actions on each run.
- Adds a scheduler only after core workflows are stable.

### SQLite
Suggested logical tables:
- `tasks`
- `actions`
- `workflows`
- `workflow_runs`
- optionally `settings` for non-secret local configuration

Keep schema migrations explicit as the application evolves.

## 3. Task Lifecycle

```text
RECEIVED
   |
   v
PLANNING
   |
   v
PLAN_VALIDATION -----> REJECTED / NEEDS_CLARIFICATION
   |
   v
AWAITING_APPROVAL
   |
   v
APPROVED
   |
   v
EXECUTING
   |
   v
VERIFYING
   |
   +----> COMPLETED
   |
   +----> PARTIAL_FAILURE / FAILED
```

An undo request should have its own state and ledger entry; it must not silently erase the original action history.

## 4. Proposed API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/plan` | Create and validate a plan without changing files |
| GET | `/api/tasks/{task_id}` | Get task state and result |
| POST | `/api/tasks/{task_id}/approve` | Approve the current plan |
| POST | `/api/tasks/{task_id}/execute` | Execute an approved plan |
| GET | `/api/actions` | List action history |
| POST | `/api/actions/{action_id}/undo` | Attempt safe rollback of a supported action |
| POST | `/api/workflows` | Save a declarative workflow |
| GET | `/api/workflows` | List saved workflows |
| POST | `/api/workflows/{workflow_id}/run` | Revalidate and run a workflow |

These endpoints are proposed and may be adjusted during implementation. Add local API authentication or a per-session secret where appropriate, and bind development services to loopback unless intentionally exposed.

## 5. Deployment and Docker

Recommended initial development setup:
- Run Ollama natively on Windows and download the selected model.
- Run the FastAPI API in Docker if host-workspace mounts can be configured safely.
- Run the React dev server natively during active UI development.
- Use Docker Compose for reproducible service configuration.

Alternative:
- Containerize Ollama only after testing GPU availability, performance, and model storage on the target machine.

Security considerations:
- Do not mount the entire user home directory into a container.
- Mount only a dedicated test workspace initially.
- Prefer read-only mounts for scan-only tasks.
- Never expose the Docker socket to the application container.
- Keep secrets out of the image and repository.
- Document that containerization is not, by itself, a complete sandbox when host paths are mounted.

## 6. Privacy and Network Boundaries

- Core model inference should use the local Ollama endpoint.
- Do not send file contents to external services in the default workflow.
- Clearly document model downloads, package installation, update checks, or optional external calls.
- Minimize logs and avoid logging full document contents.
- Test offline behavior after the model and dependencies are installed; do not infer it merely from using a local model.

## 7. Failure Handling

Handle:
- Ollama unavailable / model missing.
- Model timeout or malformed output.
- Unsupported operation.
- Workspace permission failure.
- Path traversal or symlink escape attempt.
- Destination collision.
- Source changed between planning and execution.
- Partial execution and process interruption.
- Rollback conflict.
- SQLite write failure.
- Corrupt or unsupported document.

Report partial completion accurately and preserve the action history.

## 8. Architectural Decisions (Initial)

1. Local inference via Ollama; Gemma 4B-class model chosen after benchmarking.
2. The model proposes plans but never executes arbitrary code.
3. FastAPI is the policy enforcement boundary.
4. State-changing actions require explicit approval in the MVP.
5. SQLite is sufficient for local task and workflow metadata.
6. Docker is used for reproducible services, not treated as a substitute for application security.
7. Build a working vertical slice before broadening the tool set.
