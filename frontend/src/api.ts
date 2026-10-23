import {
  PlanResponse,
  TaskExecutionSummary,
  ActionRecord,
  ActionResult,
  DuplicateScanResult,
  WorkflowItem,
  SystemHealth,
  WorkspaceItem,
  WorkspaceFilesResponse,
  ProjectInspectionResult,
  TrashAllResponse,
} from './types';

const API_BASE = 'http://127.0.0.1:8000/api';

export async function fetchHealth(): Promise<SystemHealth> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function fetchWorkspaces(): Promise<WorkspaceItem[]> {
  const res = await fetch(`${API_BASE}/workspaces`);
  if (!res.ok) throw new Error('Failed to load workspaces');
  return res.json();
}

export async function registerWorkspace(path: string, name?: string): Promise<{ status: string; path: string; name: string }> {
  const res = await fetch(`${API_BASE}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name: name || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to register workspace');
  }
  return res.json();
}

export async function fetchWorkspaceFiles(path?: string): Promise<WorkspaceFilesResponse> {
  const url = path ? `${API_BASE}/workspace/files?path=${encodeURIComponent(path)}` : `${API_BASE}/workspace/files`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch workspace files');
  }
  return res.json();
}

export async function createPlan(query: string, workspacePath?: string): Promise<PlanResponse> {
  const res = await fetch(`${API_BASE}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, workspace_path: workspacePath || null }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to create plan');
  }
  return res.json();
}

export async function approveTask(taskId: string): Promise<{ task_id: string; status: string; message: string }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to approve task');
  }
  return res.json();
}

export async function executeTask(taskId: string): Promise<TaskExecutionSummary> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/execute`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to execute task');
  }
  return res.json();
}

export async function listActions(limit = 50, taskId?: string): Promise<ActionRecord[]> {
  const url = taskId ? `${API_BASE}/actions?limit=${limit}&task_id=${taskId}` : `${API_BASE}/actions?limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch action history');
  return res.json();
}

export async function undoAction(actionId: string): Promise<ActionResult> {
  const res = await fetch(`${API_BASE}/actions/${actionId}/undo`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to undo action');
  }
  return res.json();
}

export async function scanDuplicates(path = '.', workspacePath?: string): Promise<DuplicateScanResult> {
  const params = new URLSearchParams({ path });
  if (workspacePath) {
    params.set('workspace_path', workspacePath);
  }
  const res = await fetch(`${API_BASE}/duplicates?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to scan duplicates');
  }
  return res.json();
}

export async function listWorkflows(): Promise<WorkflowItem[]> {
  const res = await fetch(`${API_BASE}/workflows`);
  if (!res.ok) throw new Error('Failed to fetch workflows');
  return res.json();
}

export async function createWorkflow(
  name: string,
  query: string,
  description?: string,
  workspacePath?: string,
  scheduleCron?: string
): Promise<WorkflowItem> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      query,
      description,
      workspace_path: workspacePath || null,
      schedule_cron: scheduleCron || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create workflow');
  }
  return res.json();
}

export async function runWorkflow(workflowId: string): Promise<TaskExecutionSummary> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to run workflow');
  }
  return res.json();
}

export async function deleteWorkflow(workflowId: string): Promise<{ status: string; workflow_id: string }> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete workflow');
  }
  return res.json();
}

export async function toggleWorkflow(workflowId: string): Promise<WorkflowItem> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/toggle`, {
    method: 'PATCH',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to toggle workflow');
  }
  return res.json();
}

export async function trashDuplicate(
  filePath: string,
  workspacePath?: string
): Promise<{ status: string; path: string; message: string }> {
  const res = await fetch(`${API_BASE}/duplicates/trash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath, workspace_path: workspacePath || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to trash file');
  }
  return res.json();
}

export async function trashAllDuplicates(
  workspacePath?: string
): Promise<TrashAllResponse> {
  const res = await fetch(`${API_BASE}/duplicates/trash-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_path: workspacePath || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to trash duplicates');
  }
  return res.json();
}

export async function inspectProject(
  path = '.',
  workspacePath?: string
): Promise<ProjectInspectionResult> {
  const params = new URLSearchParams({ path });
  if (workspacePath) {
    params.set('workspace_path', workspacePath);
  }
  const res = await fetch(`${API_BASE}/project/inspect?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to inspect project');
  }
  return res.json();
}
