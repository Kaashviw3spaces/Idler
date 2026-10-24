export type ActionType = 'scan_directory' | 'move_file' | 'rename_file' | 'find_duplicates' | 'summarize_project';

export type ActionStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'rolled_back';

export type TaskStatus = 'received' | 'planning' | 'awaiting_approval' | 'approved' | 'executing' | 'completed' | 'partial_failure' | 'failed' | 'rejected' | 'cancelled';

export interface ActionPlan {
  id: string;
  type: ActionType;
  source: string;
  destination?: string;
  reason?: string;
  requires_approval: boolean;
}

export interface PlanResponse {
  task_id: string;
  query: string;
  workspace_path: string;
  actions: ActionPlan[];
  summary: string;
  requires_approval: boolean;
  status: TaskStatus;
}

export interface ActionResult {
  action_id: string;
  action_type: ActionType;
  status: ActionStatus;
  source?: string;
  destination?: string;
  message: string;
  error?: string;
  rollback_supported: boolean;
  rollback_metadata?: Record<string, any>;
}

export interface TaskExecutionSummary {
  task_id: string;
  status: TaskStatus;
  total_actions: number;
  completed_actions: number;
  failed_actions: number;
  skipped_actions: number;
  results: ActionResult[];
}

export interface ActionRecord {
  id: string;
  task_id: string;
  action_type: string;
  status: ActionStatus;
  source?: string;
  destination?: string;
  message?: string;
  error?: string;
  rollback_supported: boolean;
  is_undone: boolean;
  created_at?: string;
}

export interface DuplicateGroup {
  size_bytes: number;
  sha256: string;
  count: number;
  paths: string[];
}

export interface DuplicateScanResult {
  scanned_files: number;
  duplicate_groups: DuplicateGroup[];
  total_wasted_bytes: number;
}

export interface WorkflowItem {
  id: string;
  name: string;
  description?: string;
  query: string;
  workspace_path: string;
  is_active: boolean;
  schedule_cron?: string;
  created_at: string;
}

export interface WorkspaceFilePreview {
  name: string;
  relative_path: string;
  category: string;
  size_bytes: number;
}

export interface WorkspaceSubdirItem {
  name: string;
  path: string;
  files_count: number;
}

export interface WorkspaceItem {
  name: string;
  path: string;
  files_count: number;
  total_size_bytes: number;
  preview: WorkspaceFilePreview[];
  is_removable?: boolean;
  subdirectories?: WorkspaceSubdirItem[];
  folder_counts?: Record<string, number>;
}

export interface WorkspaceFilesResponse {
  workspace_path: string;
  total_files: number;
  total_size_bytes: number;
  subdirectories?: string[];
  folder_counts?: Record<string, number>;
  files: WorkspaceFilePreview[];
}

export interface SystemHealth {
  status: string;
  app_name: string;
  ollama_base_url: string;
  ollama_model: string;
  allowed_workspaces: string[];
}

export interface ProjectInspectionResult {
  project_path: string;
  project_type: string;
  total_files: number;
  readme_snippet?: string;
  key_files: string[];
  languages: Record<string, number>;
}

export interface TrashAllResponse {
  status: string;
  trashed_count: number;
  trashed_bytes: number;
  trashed_files: string[];
  message: string;
}

declare global {
  interface Window {
    idlerDesktop?: {
      isElectron: boolean;
      platform: string;
      playNativeChime: (style?: string) => Promise<{ success: boolean }>;
      showNotification: (title?: string, body?: string) => Promise<{ success: boolean }>;
      toggleWindow: () => Promise<void>;
      minimizeToTray: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      quitApp: () => Promise<void>;
      openStudio: () => Promise<void>;
      resizeHeight?: (height: number) => void;
    };
  }
}
