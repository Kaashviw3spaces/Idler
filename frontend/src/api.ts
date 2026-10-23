import {
  PlanResponse,
  TaskExecutionSummary,
  ActionRecord,
  ActionResult,
  DuplicateScanResult,
  WorkflowItem,
  SystemHealth,
  WorkspaceItem,
} from './types';

const API_BASE = '/api';

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

export async function scanDuplicates(path = '.'): Promise<DuplicateScanResult> {
  const res = await fetch(`${API_BASE}/duplicates?path=${encodeURIComponent(path)}`);
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
  workspacePath?: string
): Promise<WorkflowItem> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      query,
      description,
      workspace_path: workspacePath || null,
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
