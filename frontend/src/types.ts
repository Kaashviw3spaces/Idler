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

export interface CloudSyncInfo {
  is_cloud_file: boolean;
  is_cloud_placeholder: boolean;
  cloud_provider?: string | null;
  placeholder_type?: string | null;
  warning?: string | null;
}

export interface LargeForgottenFile {
  name: string;
  relative_path: string;
  absolute_path: string;
  size_bytes: number;
  size_formatted: string;
  category: string;
  extension: string;
  last_accessed: number;
  last_accessed_formatted: string;
  last_modified: number;
  last_modified_formatted: string;
  days_inactive: number;
  cloud_info: CloudSyncInfo;
}

export interface CategoryBreakdown {
  category: string;
  total_size_bytes: number;
  formatted_size: string;
  file_count: number;
  percentage: number;
  color: string;
}

export interface StorageTreeNode {
  name: string;
  relative_path: string;
  size_bytes: number;
  size_formatted: string;
  file_count: number;
  is_dir: boolean;
  category?: string | null;
  cloud_placeholders_count: number;
  cloud_placeholders_bytes: number;
  children: StorageTreeNode[];
}

export interface CloudSummary {
  total_cloud_files: number;
  cloud_placeholder_count: number;
  local_copy_count: number;
  space_saved_bytes: number;
  space_saved_formatted: string;
  providers_detected: string[];
  re_download_warning_count: number;
}

export interface StorageAnalyticsResponse {
  workspace_path: string;
  scanned_path: string;
  total_size_bytes: number;
  total_size_formatted: string;
  total_files: number;
  total_directories: number;
  tree: StorageTreeNode;
  category_breakdowns: CategoryBreakdown[];
  large_forgotten_files: LargeForgottenFile[];
  cloud_summary: CloudSummary;
  scan_duration_ms: number;
}

export interface AnalyticsMutationResponse {
  status: string;
  relative_path?: string;
  destination?: string;
  message: string;
}

export interface AutoUpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available';
  version?: string | null;
  progress?: number;
  error?: string | null;
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
      selectFolder?: () => Promise<string | null>;
      resizeHeight?: (height: number) => void;
      onWindowShown?: (callback: () => void) => () => void;
      checkForUpdates?: () => Promise<{ success: boolean; updateInfo?: any; error?: string }>;
      quitAndInstallUpdate?: () => Promise<boolean>;
      getAppVersion?: () => Promise<string>;
      getUpdateStatus?: () => Promise<AutoUpdateStatus>;
      onAutoUpdateStatus?: (callback: (status: AutoUpdateStatus) => void) => () => void;
      setPinned?: (pinned: boolean) => Promise<boolean>;
      getPinned?: () => Promise<boolean>;
      onPinStatusChanged?: (callback: (pinned: boolean) => void) => () => void;
    };
  }
}
