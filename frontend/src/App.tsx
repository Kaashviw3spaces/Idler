import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  FolderSync,
  Play,
  ArrowRight,
  Shield,
  Database,
  History,
  Search,
  XCircle,
  RefreshCw,
  FolderOpen,
  FileCheck,
  PlusCircle,
  File,
  Trash2,
  Clock,
  X,
  Code2,
  Layers,
  Download,
  Pencil,
  Check,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  playTaskCompleteChime,
  playMacChime,
  playWindowsChime,
  SoundPlatform,
} from './sound';
import { CozyPopover } from './CozyPopover';
import {
  PlanResponse,
  TaskExecutionSummary,
  ActionRecord,
  DuplicateScanResult,
  WorkflowItem,
  SystemHealth,
  WorkspaceItem,
  WorkspaceFilePreview,
  ProjectInspectionResult,
} from './types';
import * as api from './api';

// ─── Toast System ────────────────────────────────────────────────────────────

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let _toastSeq = 0;

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      zIndex: 9999,
      maxWidth: '380px',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          background: t.kind === 'success' ? '#064e3b' : t.kind === 'error' ? '#450a0a' : '#1e293b',
          border: `1px solid ${t.kind === 'success' ? '#059669' : t.kind === 'error' ? '#dc2626' : '#334155'}`,
          color: t.kind === 'success' ? '#a7f3d0' : t.kind === 'error' ? '#fca5a5' : '#cbd5e1',
          padding: '12px 16px',
          borderRadius: '10px',
          fontSize: '14px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          animation: 'slideIn 0.2s ease-out',
        }}>
          {t.kind === 'success' && <CheckCircle2 size={16} style={{ marginTop: '1px', flexShrink: 0, color: '#34d399' }} />}
          {t.kind === 'error' && <AlertTriangle size={16} style={{ marginTop: '1px', flexShrink: 0, color: '#f87171' }} />}
          {t.kind === 'info' && <Clock size={16} style={{ marginTop: '1px', flexShrink: 0, color: '#38bdf8' }} />}
          <span style={{ flex: 1 }}>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, opacity: 0.6 }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const QUICK_PROMPTS = [
  { label: '📄 Organize PDFs', prompt: 'Organize all PDF documents into the Documents folder' },
  { label: '📊 Sort Spreadsheets', prompt: 'Move all Excel spreadsheets and CSV files into Spreadsheets' },
  { label: '🖼️ Group Images', prompt: 'Organize all pictures and screenshots into Images' },
  { label: '🔍 Find Duplicates', prompt: 'Scan workspace and find identical duplicate files' },
  { label: '💻 Summarize Project', prompt: 'Inspect and summarize project repository structure' },
];

function notifyUser(title: string, body: string) {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      // Fallback
    }
  }
}

export default function App() {
  const [tab, setTab] = useState<'planner' | 'ledger' | 'duplicates' | 'workflows' | 'projects' | 'workspaces'>('planner');
  const [viewMode, setViewMode] = useState<'cozy' | 'studio'>(() => {
    if (typeof window !== 'undefined' && (window.idlerDesktop?.isElectron || window.innerWidth <= 480)) {
      return 'cozy';
    }
    return 'studio';
  });
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [isBackendOffline, setIsBackendOffline] = useState(false);
  
  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((kind: ToastKind, message: string) => {
    const id = ++_toastSeq;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Workspace state
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('idler_selected_workspace') || '';
      } catch {}
    }
    return '';
  });
  const [liveFiles, setLiveFiles] = useState<WorkspaceFilePreview[]>([]);
  const [fileFilter, setFileFilter] = useState('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedSubdirFilter, setSelectedSubdirFilter] = useState<string>('all');
  const [groupBySubfolder, setGroupBySubfolder] = useState<boolean>(true);
  const [workspaceSubdirs, setWorkspaceSubdirs] = useState<string[]>([]);
  const [workspaceFolderCounts, setWorkspaceFolderCounts] = useState<Record<string, number>>({});
  const [customPath, setCustomPath] = useState('');
  const [customName, setCustomName] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const [showLiveFilesPreview, setShowLiveFilesPreview] = useState(true);
  const [liveFileLimit, setLiveFileLimit] = useState(16);

  useEffect(() => {
    setLiveFileLimit(16);
  }, [selectedWorkspace, selectedSubdirFilter]);

  // Planner State
  const [query, setQuery] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PlanResponse | null>(null);
  const [executionSummary, setExecutionSummary] = useState<TaskExecutionSummary | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Plan Subdirectory Editing State
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editingSubdir, setEditingSubdir] = useState('');
  const [batchEditingSubdir, setBatchEditingSubdir] = useState<string | null>(null);
  const [batchNewSubdir, setBatchNewSubdir] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  // Audio Chime State
  const [soundMuted, setSoundMuted] = useState<boolean>(() => {
    return localStorage.getItem('idler_chime_muted') === 'true';
  });
  const [soundMode, setSoundMode] = useState<SoundPlatform>(() => {
    return (localStorage.getItem('idler_sound_mode') as SoundPlatform) || 'auto';
  });
  const [showSoundMenu, setShowSoundMenu] = useState<boolean>(false);

  // Action Ledger State
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'completed' | 'undone'>('all');

  // Duplicates State
  const [dupResult, setDupResult] = useState<DuplicateScanResult | null>(null);
  const [isScanningDups, setIsScanningDups] = useState(false);
  const [trashingPath, setTrashingPath] = useState<string | null>(null);
  const [isTrashingAll, setIsTrashingAll] = useState(false);

  // Workflows State
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [wfName, setWfName] = useState('');
  const [wfQuery, setWfQuery] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [wfCron, setWfCron] = useState('');
  const [isRunningWf, setIsRunningWf] = useState<string | null>(null);

  // Project Inspector State
  const [projPath, setProjPath] = useState('.');
  const [projResult, setProjResult] = useState<ProjectInspectionResult | null>(null);
  const [isInspectingProj, setIsInspectingProj] = useState(false);

  useEffect(() => {
    refreshAll();
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      try {
        localStorage.setItem('idler_selected_workspace', selectedWorkspace);
      } catch {}
      loadLiveFiles(selectedWorkspace);
    }
  }, [selectedWorkspace]);

  async function refreshAll() {
    await loadHealth();
    await loadWorkspaces();
    await loadActions();
    await loadWorkflows();
  }

  async function loadHealth() {
    try {
      const data = await api.fetchHealth();
      setHealth(data);
      setIsBackendOffline(false);
    } catch {
      setIsBackendOffline(true);
      setHealth(null);
    }
  }

  async function loadWorkspaces() {
    try {
      const data = await api.fetchWorkspaces();
      setWorkspaces(data);
      if (data.length > 0) {
        const saved = typeof window !== 'undefined' ? localStorage.getItem('idler_selected_workspace') : null;
        const matching = saved && data.some((w) => w.path === saved) ? saved : null;
        setSelectedWorkspace((current) => current || matching || data[0].path);
      }
    } catch {
      // Backend may be offline
    }
  }

  async function loadLiveFiles(path?: string) {
    setIsLoadingFiles(true);
    try {
      const data = await api.fetchWorkspaceFiles(path);
      setLiveFiles(data.files);
      setWorkspaceSubdirs(data.subdirectories || []);
      setWorkspaceFolderCounts(data.folder_counts || {});
    } catch {
      setLiveFiles([]);
      setWorkspaceSubdirs([]);
      setWorkspaceFolderCounts({});
    } finally {
      setIsLoadingFiles(false);
    }
  }

  async function loadActions() {
    try {
      const data = await api.listActions(100);
      setActions(data);
    } catch {
      // Ignore initial failure
    }
  }

  async function loadWorkflows() {
    try {
      const data = await api.listWorkflows();
      setWorkflows(data);
    } catch {
      // Ignore initial failure
    }
  }

  // --- Handlers ---
  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setIsPlanning(true);
    setErrorMsg(null);
    setCurrentPlan(null);
    setExecutionSummary(null);

    try {
      const plan = await api.createPlan(query, selectedWorkspace || undefined);
      setCurrentPlan(plan);
      addToast('info', `Plan ready: ${plan.actions.length} action(s) proposed`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleApproveAndExecute() {
    if (!currentPlan) return;
    setIsExecuting(true);
    setErrorMsg(null);

    try {
      // Step 1: Approve
      await api.approveTask(currentPlan.task_id);
      // Step 2: Execute
      const summary = await api.executeTask(currentPlan.task_id);
      setExecutionSummary(summary);
      addToast('success', `Execution complete — ${summary.completed_actions}/${summary.total_actions} actions succeeded`);
      notifyUser('Idler: Task Executed', `Completed ${summary.completed_actions} of ${summary.total_actions} actions`);
      playTaskCompleteChime(soundMode);
      await loadActions();
      await loadWorkspaces();
      if (selectedWorkspace) {
        await loadLiveFiles(selectedWorkspace);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    } finally {
      setIsExecuting(false);
    }
  }

  function handleDiscardPlan() {
    setCurrentPlan(null);
    setExecutionSummary(null);
    setErrorMsg(null);
    setEditingActionId(null);
    setEditingSubdir('');
    setBatchEditingSubdir(null);
    setBatchNewSubdir('');
  }

  function getSubdirectory(destination?: string): string {
    if (!destination) return '';
    const lastSlash = destination.lastIndexOf('/');
    return lastSlash > -1 ? destination.substring(0, lastSlash) : '';
  }

  function getFilename(pathStr: string): string {
    const lastSlash = pathStr.lastIndexOf('/');
    return lastSlash > -1 ? pathStr.substring(lastSlash + 1) : pathStr;
  }

  function computeDestination(sourcePath: string, targetSubdir: string): string {
    const filename = getFilename(sourcePath);
    const cleanSubdir = targetSubdir.trim().replace(/^\/+|\/+$/g, '');
    if (!cleanSubdir || cleanSubdir === '.') {
      return filename;
    }
    return `${cleanSubdir}/${filename}`;
  }

  const detectedSubdirs = useMemo(() => {
    if (!currentPlan) return [];
    const counts: Record<string, number> = {};
    for (const act of currentPlan.actions) {
      if (act.destination) {
        const sub = getSubdirectory(act.destination) || '(root)';
        counts[sub] = (counts[sub] || 0) + 1;
      }
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [currentPlan]);

  function handleStartEditAction(actionId: string, currentDestination?: string) {
    setEditingActionId(actionId);
    setEditingSubdir(getSubdirectory(currentDestination) || '');
  }

  function handleCancelEditAction() {
    setEditingActionId(null);
    setEditingSubdir('');
  }

  async function handleSaveActionSubdir(actionId: string, sourcePath: string) {
    if (!currentPlan) return;
    const newDest = computeDestination(sourcePath, editingSubdir);
    setIsSavingPlan(true);
    try {
      await api.updateActionDestination(
        currentPlan.task_id,
        actionId,
        newDest,
        `Subdirectory customized: "${editingSubdir || '(root)'}"`
      );
      const updatedActions = currentPlan.actions.map((act) =>
        act.id === actionId
          ? {
              ...act,
              destination: newDest,
              reason: `Subdirectory customized: "${editingSubdir || '(root)'}"`,
            }
          : act
      );
      setCurrentPlan({ ...currentPlan, actions: updatedActions });
      addToast('success', `Subdirectory set to "${editingSubdir || '(root)'}" (${newDest})`);
      setEditingActionId(null);
      setEditingSubdir('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsSavingPlan(false);
    }
  }

  async function handleRemoveAction(actionId: string, sourcePath: string) {
    if (!currentPlan) return;
    try {
      await api.deleteTaskAction(currentPlan.task_id, actionId);
      const updatedActions = currentPlan.actions.filter((act) => act.id !== actionId);
      setCurrentPlan({ ...currentPlan, actions: updatedActions });
      addToast('info', `Excluded "${sourcePath}" from plan`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  }

  function handleStartBatchEdit(subdirName: string) {
    setBatchEditingSubdir(subdirName);
    setBatchNewSubdir(subdirName === '(root)' ? '' : subdirName);
  }

  function handleCancelBatchEdit() {
    setBatchEditingSubdir(null);
    setBatchNewSubdir('');
  }

  async function handleApplyBatchSubdir() {
    if (!currentPlan || !batchEditingSubdir) return;
    const targetOldSubdir = batchEditingSubdir === '(root)' ? '' : batchEditingSubdir;
    const targetNewSubdir = batchNewSubdir.trim().replace(/^\/+|\/+$/g, '');

    const updatedActions = currentPlan.actions.map((act) => {
      const currentSub = getSubdirectory(act.destination);
      if (currentSub === targetOldSubdir) {
        const newDest = computeDestination(act.source, targetNewSubdir);
        return {
          ...act,
          destination: newDest,
          reason: `Customized subdirectory: "${targetNewSubdir || '(root)'}"`,
        };
      }
      return act;
    });

    setIsSavingPlan(true);
    try {
      const res = await api.updatePlan(currentPlan.task_id, updatedActions);
      setCurrentPlan(res);
      addToast(
        'success',
        `Remapped all "${batchEditingSubdir}" files to "${targetNewSubdir || '(root)'}"`
      );
      setBatchEditingSubdir(null);
      setBatchNewSubdir('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsSavingPlan(false);
    }
  }

  async function handleUndo(actionId: string) {
    setUndoingId(actionId);
    setErrorMsg(null);
    try {
      await api.undoAction(actionId);
      addToast('success', 'Action rolled back successfully');
      await loadActions();
      await loadWorkspaces();
      if (selectedWorkspace) {
        await loadLiveFiles(selectedWorkspace);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    } finally {
      setUndoingId(null);
    }
  }

  async function handleScanDuplicates() {
    setIsScanningDups(true);
    setErrorMsg(null);
    try {
      const res = await api.scanDuplicates('.', selectedWorkspace || undefined);
      setDupResult(res);
      if (res.duplicate_groups.length > 0) {
        addToast('info', `Found ${res.duplicate_groups.length} duplicate group(s) wasting ${fmtBytes(res.total_wasted_bytes)}`);
      } else {
        addToast('success', 'No duplicates found — workspace is clean!');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    } finally {
      setIsScanningDups(false);
    }
  }

  async function handleTrashDuplicate(filePath: string) {
    setTrashingPath(filePath);
    try {
      const res = await api.trashDuplicate(filePath, selectedWorkspace || undefined);
      addToast('success', res.message);
      // Re-scan to reflect the deletion
      const updated = await api.scanDuplicates('.', selectedWorkspace || undefined);
      setDupResult(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setTrashingPath(null);
    }
  }

  async function handleTrashAllDuplicates() {
    setIsTrashingAll(true);
    try {
      const res = await api.trashAllDuplicates(selectedWorkspace || undefined);
      addToast('success', res.message);
      notifyUser('Idler: Duplicates Cleaned', res.message);
      const updated = await api.scanDuplicates('.', selectedWorkspace || undefined);
      setDupResult(updated);
      if (selectedWorkspace) {
        await loadLiveFiles(selectedWorkspace);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsTrashingAll(false);
    }
  }

  async function handleInspectProject() {
    setIsInspectingProj(true);
    setProjResult(null);
    try {
      const res = await api.inspectProject(projPath.trim() || '.', selectedWorkspace || undefined);
      setProjResult(res);
      addToast('success', `Inspected ${res.project_type.toUpperCase()} project (${res.total_files} files)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsInspectingProj(false);
    }
  }

  async function handleAddCustomWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!customPath.trim()) return;
    setErrorMsg(null);
    setRegisterSuccess(null);
    try {
      const res = await api.registerWorkspace(customPath.trim(), customName.trim() || undefined);
      setRegisterSuccess(`Added workspace "${res.name}" (${res.path})`);
      addToast('success', `Workspace "${res.name}" registered successfully`);
      setCustomPath('');
      setCustomName('');
      await loadWorkspaces();
      setSelectedWorkspace(res.path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    }
  }

  async function handleRemoveWorkspace(wsPath: string, wsName: string) {
    if (!window.confirm(`Are you sure you want to remove "${wsName}" from Idler's workspace list?\n\n(Note: Files on your computer will NOT be deleted)`)) {
      return;
    }
    setErrorMsg(null);
    try {
      await api.deleteWorkspace(wsPath);
      addToast('success', `Removed workspace "${wsName}" from Idler`);
      const updated = await api.fetchWorkspaces();
      setWorkspaces(updated);
      if (selectedWorkspace === wsPath) {
        setSelectedWorkspace(updated.length > 0 ? updated[0].path : '');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    }
  }

  async function handleCreateWorkflow(e: React.FormEvent) {
    e.preventDefault();
    if (!wfName.trim() || !wfQuery.trim()) return;
    try {
      await api.createWorkflow(wfName, wfQuery, wfDesc, selectedWorkspace || undefined, wfCron.trim() || undefined);
      addToast('success', `Workflow "${wfName}" saved`);
      setWfName('');
      setWfQuery('');
      setWfDesc('');
      setWfCron('');
      await loadWorkflows();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    }
  }

  async function handleRunWorkflow(id: string, name: string) {
    setIsRunningWf(id);
    setErrorMsg(null);
    addToast('info', `Running workflow "${name}"…`);
    try {
      const res = await api.runWorkflow(id);
      setExecutionSummary(res);
      setTab('planner');
      addToast('success', `Workflow "${name}" completed — ${res.completed_actions}/${res.total_actions} actions`);
      notifyUser('Idler: Workflow Done', `Workflow "${name}" executed successfully`);
      playTaskCompleteChime(soundMode);
      await loadActions();
      await loadWorkspaces();
      if (selectedWorkspace) {
        await loadLiveFiles(selectedWorkspace);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      addToast('error', msg);
    } finally {
      setIsRunningWf(null);
    }
  }

  async function handleDeleteWorkflow(id: string, name: string) {
    try {
      await api.deleteWorkflow(id);
      addToast('info', `Workflow "${name}" deleted`);
      await loadWorkflows();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  }

  async function handleToggleWorkflow(id: string) {
    try {
      const updated = await api.toggleWorkflow(id);
      addToast('info', `Workflow "${updated.name}" is now ${updated.is_active ? 'active' : 'paused'}`);
      await loadWorkflows();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  }

  function toggleSoundMute() {
    const next = !soundMuted;
    setSoundMuted(next);
    localStorage.setItem('idler_chime_muted', String(next));
    addToast('info', next ? 'Audio chimes muted' : 'Audio chimes enabled');
  }

  function handleChangeSoundMode(mode: SoundPlatform) {
    setSoundMode(mode);
    localStorage.setItem('idler_sound_mode', mode);
    if (mode === 'mac') playMacChime();
    else if (mode === 'win') playWindowsChime();
    else playTaskCompleteChime('auto');
  }

  const filteredLiveFiles = useMemo(() => {
    let files = liveFiles;
    if (selectedSubdirFilter !== 'all') {
      if (selectedSubdirFilter === '(root)') {
        files = files.filter((f) => !f.relative_path.includes('/'));
      } else {
        files = files.filter((f) => {
          const parts = f.relative_path.split('/');
          return parts.length > 1 && parts[0] === selectedSubdirFilter;
        });
      }
    }
    if (!fileFilter.trim()) return files;
    const q = fileFilter.toLowerCase();
    return files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.relative_path.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
    );
  }, [liveFiles, selectedSubdirFilter, fileFilter]);

  const groupedLiveFiles = useMemo(() => {
    const groups: Record<string, WorkspaceFilePreview[]> = {};
    for (const f of filteredLiveFiles) {
      const parts = f.relative_path.split('/');
      const folder = parts.length > 1 ? parts[0] : '(root)';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(f);
    }
    return groups;
  }, [filteredLiveFiles]);

  const liveCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of filteredLiveFiles) {
      const cat = f.category || 'other';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [filteredLiveFiles]);

  const filteredActions = actions.filter((act) => {
    if (ledgerFilter === 'completed') return act.status === 'completed' && !act.is_undone;
    if (ledgerFilter === 'undone') return act.is_undone;
    return true;
  });

  if (viewMode === 'cozy') {
    return (
      <div style={{ padding: 0, margin: 0, background: 'transparent' }}>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <CozyPopover
          workspaces={workspaces}
          selectedWorkspace={selectedWorkspace}
          onSelectWorkspace={setSelectedWorkspace}
          actions={actions}
          onRefreshActions={loadActions}
          onRefreshWorkspaces={loadWorkspaces}
          workflows={workflows}
          onRefreshWorkflows={loadWorkflows}
          soundMode={soundMode}
          onChangeSoundMode={handleChangeSoundMode}
          soundMuted={soundMuted}
          onToggleSoundMute={toggleSoundMute}
          onOpenStudio={() => {
            if (window.idlerDesktop?.openStudio) {
              window.idlerDesktop.openStudio();
            } else {
              setViewMode('studio');
            }
          }}
          onQuit={() => {
            if (window.idlerDesktop?.quitApp) {
              window.idlerDesktop.quitApp();
            }
          }}
          liveFiles={liveFiles}
          isLoadingFiles={isLoadingFiles}
          addToast={addToast}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: '20px',
        borderBottom: '1px solid #1e293b',
        marginBottom: '24px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            fontSize: '32px',
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            width: '52px',
            height: '52px',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
          }}>
            🦥
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '26px', fontWeight: '700', letterSpacing: '-0.5px' }}>Idler</h1>
              <span style={{
                background: '#1e293b',
                color: '#94a3b8',
                fontSize: '12px',
                padding: '2px 8px',
                borderRadius: '6px',
                fontWeight: '600'
              }}>Local AI Assistant</span>
              <button
                onClick={() => setViewMode('cozy')}
                style={{
                  marginLeft: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#38bdf8',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <span>🦥</span> Cozy Popover Mode
              </button>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '14px' }}>
              Stop doing repetitive work. Let your local AI scan, organize, and reverse actions safely.
            </p>
          </div>
        </div>

        {/* System Badges & Refresh */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={refreshAll}
            title="Refresh system status"
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#94a3b8',
              padding: '6px 10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px'
            }}
          >
            <RefreshCw size={14} />
            <span>Sync</span>
          </button>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '8px',
            fontSize: '13px',
            color: '#38bdf8'
          }}>
            <Shield size={14} />
            <span>Sandbox: <strong>Protected</strong></span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '8px',
            fontSize: '13px',
            color: isBackendOffline ? '#f87171' : '#a7f3d0'
          }}>
            <Database size={14} />
            <span>
              {isBackendOffline ? 'Backend Offline' : (health?.ollama_model ? `AI: ${health.ollama_model}` : 'AI Ready')}
            </span>
          </div>

          {/* Native Audio Chime Menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSoundMenu(!showSoundMenu)}
              title="Native completion chime settings (macOS & Windows)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                fontSize: '13px',
                color: soundMuted ? '#94a3b8' : '#38bdf8',
                cursor: 'pointer'
              }}
            >
              {soundMuted ? <VolumeX size={14} color="#94a3b8" /> : <Volume2 size={14} color="#38bdf8" />}
              <span>Chime: <strong>{soundMuted ? 'Muted' : soundMode === 'auto' ? 'Auto (OS)' : soundMode.toUpperCase()}</strong></span>
            </button>

            {showSoundMenu && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: '260px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '10px',
                padding: '14px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc' }}>
                    Completion Chimes
                  </span>
                  <button
                    onClick={toggleSoundMute}
                    style={{
                      background: soundMuted ? '#374151' : '#047857',
                      color: '#ffffff',
                      border: 'none',
                      padding: '3px 8px',
                      borderRadius: '5px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    {soundMuted ? 'Unmute' : 'Mute'}
                  </button>
                </div>

                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Plays an audio chime when background scheduled tasks and workflows finish.
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['auto', 'mac', 'win'] as SoundPlatform[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => handleChangeSoundMode(mode)}
                      style={{
                        flex: 1,
                        padding: '5px 0',
                        fontSize: '11px',
                        fontWeight: '600',
                        background: soundMode === mode ? '#2563eb' : '#1e293b',
                        color: soundMode === mode ? '#ffffff' : '#cbd5e1',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      {mode === 'auto' ? 'Auto' : mode === 'mac' ? '🍎 Mac' : '🪟 Win'}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '6px', borderTop: '1px solid #1e293b' }}>
                  <button
                    onClick={() => playMacChime()}
                    style={{
                      padding: '6px',
                      background: '#1e293b',
                      color: '#93c5fd',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>🍎</span> Test macOS Glass Chime
                  </button>
                  <button
                    onClick={() => playWindowsChime()}
                    style={{
                      padding: '6px',
                      background: '#1e293b',
                      color: '#93c5fd',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>🪟</span> Test Windows Notify Chime
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Backend Offline Warning Banner */}
      {isBackendOffline && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid #ef4444',
          color: '#fca5a5',
          padding: '14px 18px',
          borderRadius: '10px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={20} />
            <div>
              <strong>FastAPI Backend is Offline:</strong> Run the backend server with:{' '}
              <code style={{ background: '#1e1e2e', padding: '2px 6px', borderRadius: '4px' }}>
                backend/venv/bin/uvicorn backend.app.main:app --port 8000
              </code>
            </div>
          </div>
          <button
            onClick={loadHealth}
            style={{
              padding: '6px 12px',
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600'
            }}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Global Error Banner */}
      {errorMsg && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid #ef4444',
          color: '#fca5a5',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <AlertTriangle size={18} />
          <span style={{ fontSize: '14px' }}>{errorMsg}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav style={{
        display: 'flex',
        gap: '8px',
        borderBottom: '1px solid #1e293b',
        paddingBottom: '12px',
        marginBottom: '24px'
      }}>
        <button
          onClick={() => setTab('planner')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: '600',
            background: tab === 'planner' ? '#2563eb' : 'transparent',
            color: tab === 'planner' ? '#ffffff' : '#94a3b8'
          }}
        >
          <Sparkles size={16} />
          Scan & Plan
        </button>

        <button
          onClick={() => { setTab('ledger'); loadActions(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: '600',
            background: tab === 'ledger' ? '#2563eb' : 'transparent',
            color: tab === 'ledger' ? '#ffffff' : '#94a3b8'
          }}
        >
          <History size={16} />
          Action Ledger & Undo ({actions.length})
        </button>

        <button
          onClick={() => setTab('duplicates')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: '600',
            background: tab === 'duplicates' ? '#2563eb' : 'transparent',
            color: tab === 'duplicates' ? '#ffffff' : '#94a3b8'
          }}
        >
          <Search size={16} />
          Duplicate Finder
        </button>

        <button
          onClick={() => setTab('projects')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: '600',
            background: tab === 'projects' ? '#2563eb' : 'transparent',
            color: tab === 'projects' ? '#ffffff' : '#94a3b8'
          }}
        >
          <Code2 size={16} />
          Project Inspector
        </button>

        <button
          onClick={() => { setTab('workflows'); loadWorkflows(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: '600',
            background: tab === 'workflows' ? '#2563eb' : 'transparent',
            color: tab === 'workflows' ? '#ffffff' : '#94a3b8'
          }}
        >
          <FolderSync size={16} />
          Saved Workflows ({workflows.length})
        </button>

        <button
          onClick={() => { setTab('workspaces'); loadWorkspaces(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: '600',
            background: tab === 'workspaces' ? '#2563eb' : 'transparent',
            color: tab === 'workspaces' ? '#ffffff' : '#94a3b8'
          }}
        >
          <FolderOpen size={16} />
          Workspaces ({workspaces.length})
        </button>
      </nav>

      {/* TAB 1: AGENT PLANNER */}
      {tab === 'planner' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
          {/* Workspace Target & Live Files Bar */}
          <div style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '14px',
            padding: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FolderOpen size={18} color="#38bdf8" />
                <span style={{ fontSize: '15px', fontWeight: '600' }}>Active Folder to Scan on Computer:</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select
                  value={selectedWorkspace}
                  onChange={(e) => setSelectedWorkspace(e.target.value)}
                  style={{
                    background: '#1e293b',
                    color: '#ffffff',
                    border: '1px solid #334155',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    minWidth: '280px'
                  }}
                >
                  {workspaces.map((ws, idx) => (
                    <React.Fragment key={idx}>
                      <option value={ws.path} style={{ fontWeight: '600' }}>
                        📂 {ws.name} ({ws.files_count} files)
                      </option>
                      {ws.subdirectories?.map((sub, sIdx) => (
                        <option key={`${idx}-${sIdx}`} value={sub.path} style={{ color: '#38bdf8' }}>
                          &nbsp;&nbsp;&nbsp;&nbsp;↳ 📁 {sub.name} ({sub.files_count} files)
                        </option>
                      ))}
                    </React.Fragment>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => loadLiveFiles(selectedWorkspace)}
                  disabled={isLoadingFiles}
                  style={{
                    padding: '8px 14px',
                    background: '#1e293b',
                    color: '#cbd5e1',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <RefreshCw size={13} className={isLoadingFiles ? 'spin' : ''} />
                  Rescan Disk
                </button>
              </div>
            </div>

            {/* Subfolders Navigation Pills */}
            {(workspaceSubdirs.length > 0 || Object.keys(workspaceFolderCounts).length > 1) && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
                marginBottom: '12px',
                padding: '8px 12px',
                background: '#1e293b',
                borderRadius: '8px',
                border: '1px solid #334155'
              }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8', marginRight: '4px' }}>
                  Subfolders:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSubdirFilter('all')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: '600',
                    border: 'none',
                    cursor: 'pointer',
                    background: selectedSubdirFilter === 'all' ? '#2563eb' : '#0f172a',
                    color: selectedSubdirFilter === 'all' ? '#ffffff' : '#94a3b8'
                  }}
                >
                  All ({liveFiles.length})
                </button>
                {workspaceSubdirs.map((subdir) => {
                  const count = workspaceFolderCounts[subdir] ?? 0;
                  const isSelected = selectedSubdirFilter === subdir;
                  return (
                    <button
                      key={subdir}
                      type="button"
                      onClick={() => setSelectedSubdirFilter(isSelected ? 'all' : subdir)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '600',
                        border: isSelected ? '1px solid #38bdf8' : '1px solid #334155',
                        cursor: 'pointer',
                        background: isSelected ? '#1e3a8a' : '#0f172a',
                        color: isSelected ? '#93c5fd' : '#cbd5e1',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>📁 {subdir}</span>
                      <span style={{ color: isSelected ? '#ffffff' : '#64748b', fontSize: '10px' }}>({count})</span>
                    </button>
                  );
                })}
                {workspaceFolderCounts['(root)'] !== undefined && workspaceFolderCounts['(root)'] > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedSubdirFilter(selectedSubdirFilter === '(root)' ? 'all' : '(root)')}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: '600',
                      border: selectedSubdirFilter === '(root)' ? '1px solid #38bdf8' : '1px solid #334155',
                      cursor: 'pointer',
                      background: selectedSubdirFilter === '(root)' ? '#1e3a8a' : '#0f172a',
                      color: selectedSubdirFilter === '(root)' ? '#93c5fd' : '#94a3b8'
                    }}
                  >
                    (root) ({workspaceFolderCounts['(root)']})
                  </button>
                )}
              </div>
            )}

            {/* Live files preview list */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowLiveFilesPreview(!showLiveFilesPreview)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: '#cbd5e1',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    padding: '2px 0'
                  }}
                >
                  {showLiveFilesPreview ? <ChevronDown size={15} color="#38bdf8" /> : <ChevronRight size={15} color="#38bdf8" />}
                  <span>Files in Workspace</span>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '400' }}>
                    ({filteredLiveFiles.length} file{filteredLiveFiles.length === 1 ? '' : 's'}{selectedSubdirFilter !== 'all' ? ` in ${selectedSubdirFilter}` : ''})
                  </span>
                </button>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setGroupBySubfolder(!groupBySubfolder)}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#cbd5e1',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    {groupBySubfolder ? 'View Flat' : 'Group by Folder'}
                  </button>
                  <input
                    type="text"
                    placeholder="Filter files (e.g. .pptx, sheet)..."
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    style={{
                      background: '#1e293b',
                      color: '#e2e8f0',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '12px',
                      width: '200px'
                    }}
                  />
                </div>
              </div>

              {showLiveFilesPreview && (
                <>
                  {/* Category Summary Chips */}
                  {Object.keys(liveCategoryCounts).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                      {Object.entries(liveCategoryCounts).map(([cat, count]) => (
                        <span
                          key={cat}
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#cbd5e1',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span style={{ textTransform: 'capitalize', fontWeight: '500' }}>{cat}:</span>
                          <span style={{ color: '#38bdf8', fontWeight: '600' }}>{count}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {filteredLiveFiles.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '13px' }}>
                      {liveFiles.length === 0 ? 'No files found in this workspace.' : 'No files match the filter.'}
                    </div>
                  ) : groupBySubfolder ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                      {Object.entries(groupedLiveFiles).map(([folderName, filesInFolder]) => (
                        <div key={folderName} style={{
                          background: '#1e293b',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          border: '1px solid #334155'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: '#38bdf8' }}>
                              📁 {folderName}
                            </span>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>({filesInFolder.length} file{filesInFolder.length > 1 ? 's' : ''})</span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {filesInFolder.slice(0, 8).map((f, i) => (
                              <span key={i} style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: '#0f172a',
                                color: '#e2e8f0',
                                border: '1px solid #334155',
                                padding: '3px 7px',
                                borderRadius: '5px',
                                fontSize: '11px',
                                fontFamily: 'monospace'
                              }}>
                                <File size={11} color="#38bdf8" />
                                <span>{f.name}</span>
                                <span style={{ color: '#64748b', fontSize: '10px' }}>({f.category})</span>
                              </span>
                            ))}
                            {filesInFolder.length > 8 && (
                              <span style={{
                                fontSize: '11px',
                                color: '#94a3b8',
                                padding: '3px 7px',
                                fontStyle: 'italic',
                                background: 'rgba(255, 255, 255, 0.04)',
                                borderRadius: '5px'
                              }}>
                                +{filesInFolder.length - 8} more
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                        {filteredLiveFiles.slice(0, liveFileLimit).map((f, i) => (
                          <span key={i} style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#1e293b',
                            color: '#e2e8f0',
                            border: '1px solid #334155',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontFamily: 'monospace'
                          }}>
                            <File size={12} color="#38bdf8" />
                            <span>{f.relative_path || f.name}</span>
                            <span style={{ color: '#64748b', fontSize: '11px' }}>({f.category})</span>
                          </span>
                        ))}
                      </div>

                      {/* Pagination Controls */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>
                        <span>
                          Showing {Math.min(liveFileLimit, filteredLiveFiles.length)} of {filteredLiveFiles.length} files
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {filteredLiveFiles.length > liveFileLimit && (
                            <button
                              type="button"
                              onClick={() => setLiveFileLimit((prev) => Math.min(prev + 24, filteredLiveFiles.length))}
                              style={{
                                background: '#1e293b',
                                border: '1px solid #334155',
                                color: '#38bdf8',
                                borderRadius: '5px',
                                padding: '3px 8px',
                                fontSize: '11px',
                                cursor: 'pointer'
                              }}
                            >
                              + Show {Math.min(24, filteredLiveFiles.length - liveFileLimit)} more ({filteredLiveFiles.length - liveFileLimit} left)
                            </button>
                          )}
                          {filteredLiveFiles.length > liveFileLimit && (
                            <button
                              type="button"
                              onClick={() => setLiveFileLimit(filteredLiveFiles.length)}
                              style={{
                                background: '#1e293b',
                                border: '1px solid #334155',
                                color: '#94a3b8',
                                borderRadius: '5px',
                                padding: '3px 8px',
                                fontSize: '11px',
                                cursor: 'pointer'
                              }}
                            >
                              Show all
                            </button>
                          )}
                          {liveFileLimit > 16 && (
                            <button
                              type="button"
                              onClick={() => setLiveFileLimit(16)}
                              style={{
                                background: '#1e293b',
                                border: '1px solid #334155',
                                color: '#94a3b8',
                                borderRadius: '5px',
                                padding: '3px 8px',
                                fontSize: '11px',
                                cursor: 'pointer'
                              }}
                            >
                              Show fewer
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Prompt Input Form */}
          <div style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '14px',
            padding: '24px'
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={18} color="#38bdf8" />
              What would you like Idler to do with these files?
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '16px' }}>
              Describe your desired organization in plain English. The agent scans your files, generates a safe plan, and asks for your approval before touching anything.
            </p>

            {/* Quick Prompt Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
              {QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setQuery(qp.prompt)}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#cbd5e1',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  {qp.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleCreatePlan}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. Sort PDFs into Documents, images into Images, and check for duplicates..."
                  style={{
                    flex: 1,
                    padding: '14px 18px',
                    borderRadius: '10px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff',
                    fontSize: '15px',
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  disabled={isPlanning || !query.trim()}
                  style={{
                    padding: '14px 24px',
                    background: isPlanning ? '#475569' : '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontWeight: '600',
                    fontSize: '15px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  {isPlanning ? 'Scanning & Planning...' : 'Generate Plan'}
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          </div>

          {/* Plan Preview & Approval Gate */}
          {currentPlan && (
            <div style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '14px',
              padding: '24px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{
                      background: '#1e3a8a',
                      color: '#93c5fd',
                      fontSize: '12px',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontWeight: '600'
                    }}>
                      STATUS: {currentPlan.status.toUpperCase()}
                    </span>
                    <span style={{ color: '#64748b', fontSize: '13px' }}>Task ID: {currentPlan.task_id}</span>
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Plan Summary: {currentPlan.summary}</h3>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    onClick={handleDiscardPlan}
                    style={{
                      padding: '10px 18px',
                      background: '#374151',
                      color: '#f3f4f6',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: '600',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <XCircle size={16} />
                    Discard
                  </button>

                  {currentPlan.actions.length > 0 && !executionSummary && (
                    <button
                      onClick={handleApproveAndExecute}
                      disabled={isExecuting}
                      style={{
                        padding: '10px 22px',
                        background: isExecuting ? '#475569' : '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      <CheckCircle2 size={16} />
                      {isExecuting ? 'Executing Moves on Computer...' : 'Approve & Execute Plan'}
                    </button>
                  )}
                </div>
              </div>

              {/* AI-Detected Subdirectories & Quick Remap Bar */}
              {detectedSubdirs.length > 0 && (
                <div style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  marginTop: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc' }}>
                        AI-Detected Subdirectories:
                      </span>
                      {detectedSubdirs.map((sub) => (
                        <span key={sub.name} style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          fontSize: '12px',
                          color: '#38bdf8'
                        }}>
                          <span>📁 {sub.name}</span>
                          <span style={{ color: '#64748b', fontSize: '11px' }}>({sub.count} file{sub.count > 1 ? 's' : ''})</span>
                          <button
                            type="button"
                            onClick={() => handleStartBatchEdit(sub.name)}
                            title={`Change all files destined for "${sub.name}" to another folder`}
                            style={{
                              background: '#334155',
                              border: 'none',
                              color: '#f8fafc',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <Pencil size={10} />
                            Change Folder
                          </button>
                        </span>
                      ))}
                    </div>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Don't like the AI detection? Click <strong>Change Folder</strong> above or edit any file below.
                    </span>
                  </div>

                  {/* Batch Edit Input Box (when triggered) */}
                  {batchEditingSubdir && (
                    <div style={{
                      background: '#0f172a',
                      border: '1px solid #3b82f6',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap'
                    }}>
                      <span style={{ fontSize: '13px', color: '#e2e8f0' }}>
                        Change all files from <code>{batchEditingSubdir}</code> to new subdirectory:
                      </span>
                      <input
                        type="text"
                        placeholder="e.g. Invoices, Personal/2026, or empty for root"
                        value={batchNewSubdir}
                        onChange={(e) => setBatchNewSubdir(e.target.value)}
                        style={{
                          background: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          color: '#ffffff',
                          padding: '6px 10px',
                          fontSize: '13px',
                          flex: 1,
                          minWidth: '200px'
                        }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApplyBatchSubdir();
                          if (e.key === 'Escape') handleCancelBatchEdit();
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleApplyBatchSubdir}
                        disabled={isSavingPlan}
                        style={{
                          background: '#2563eb',
                          border: 'none',
                          color: '#ffffff',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Check size={14} />
                        {isSavingPlan ? 'Saving...' : 'Apply to All'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelBatchEdit}
                        style={{
                          background: '#374151',
                          border: 'none',
                          color: '#cbd5e1',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '13px',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Action items table */}
              <div style={{ overflowX: 'auto', marginTop: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                      <th style={{ padding: '10px 12px' }}>Action</th>
                      <th style={{ padding: '10px 12px' }}>Source File</th>
                      <th style={{ padding: '10px 12px' }}>Target Subdirectory & Destination</th>
                      <th style={{ padding: '10px 12px' }}>Reason</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Customize</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPlan.actions.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                          No files needed moving. Workspace is already clean!
                        </td>
                      </tr>
                    ) : (
                      currentPlan.actions.map((act) => (
                        <tr key={act.id} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '12px' }}>
                            <span style={{
                              background: '#312e81',
                              color: '#c7d2fe',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '600'
                            }}>
                              {act.type}
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontFamily: 'monospace', color: '#e2e8f0' }}>{act.source}</td>
                          <td style={{ padding: '12px' }}>
                            {editingActionId === act.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <input
                                    type="text"
                                    value={editingSubdir}
                                    onChange={(e) => setEditingSubdir(e.target.value)}
                                    placeholder="Subfolder name (or leave empty for root)"
                                    style={{
                                      background: '#0f172a',
                                      border: '1px solid #3b82f6',
                                      borderRadius: '6px',
                                      color: '#ffffff',
                                      padding: '4px 8px',
                                      fontSize: '13px',
                                      width: '220px'
                                    }}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveActionSubdir(act.id, act.source);
                                      if (e.key === 'Escape') handleCancelEditAction();
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSaveActionSubdir(act.id, act.source)}
                                    disabled={isSavingPlan}
                                    style={{
                                      background: '#10b981',
                                      border: 'none',
                                      color: '#ffffff',
                                      padding: '4px 8px',
                                      borderRadius: '6px',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '3px'
                                    }}
                                  >
                                    <Check size={12} />
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelEditAction}
                                    style={{
                                      background: '#374151',
                                      border: 'none',
                                      color: '#cbd5e1',
                                      padding: '4px 8px',
                                      borderRadius: '6px',
                                      fontSize: '12px',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                                <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                                  Result: {computeDestination(act.source, editingSubdir)}
                                </span>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  color: '#38bdf8',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: '600'
                                }}>
                                  📁 {getSubdirectory(act.destination) || '(root)'}
                                </span>
                                <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{act.destination || '—'}</span>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px', color: '#94a3b8' }}>{act.reason || '—'}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                              {editingActionId !== act.id && (
                                <button
                                  type="button"
                                  onClick={() => handleStartEditAction(act.id, act.destination)}
                                  title="Edit subdirectory for this file"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    background: '#1e293b',
                                    border: '1px solid #334155',
                                    color: '#cbd5e1',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Pencil size={11} />
                                  Edit Subdirectory
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveAction(act.id, act.source)}
                                title="Exclude this file from plan"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  padding: '4px 6px',
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  border: '1px solid rgba(239, 68, 68, 0.2)',
                                  color: '#fca5a5',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                <X size={11} />
                                Skip
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Execution Results Summary */}
          {executionSummary && (
            <div style={{
              background: '#064e3b',
              border: '1px solid #059669',
              borderRadius: '14px',
              padding: '24px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <CheckCircle2 size={24} color="#34d399" />
                <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#ecfdf5' }}>
                  Execution Complete — Status: {executionSummary.status.toUpperCase()}
                </h3>
              </div>
              <p style={{ color: '#a7f3d0', fontSize: '14px', marginBottom: '16px' }}>
                Total Actions: <strong>{executionSummary.total_actions}</strong> | Completed: <strong>{executionSummary.completed_actions}</strong> | Failed: <strong>{executionSummary.failed_actions}</strong> | Skipped: <strong>{executionSummary.skipped_actions}</strong>
              </p>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setTab('ledger')}
                  style={{
                    background: '#047857',
                    color: '#ffffff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}
                >
                  View in Action Ledger &rarr;
                </button>
                <button
                  onClick={handleDiscardPlan}
                  style={{
                    background: 'transparent',
                    color: '#ecfdf5',
                    border: '1px solid #10b981',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '13px'
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ACTION LEDGER */}
      {tab === 'ledger' && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Immutable Action Ledger</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px' }}>
                Full audit trail of all executed tasks and safe rollbacks on your computer.
              </p>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={ledgerFilter}
                onChange={(e) => setLedgerFilter(e.target.value as 'all' | 'completed' | 'undone')}
                style={{
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '13px'
                }}
              >
                <option value="all">All Events ({actions.length})</option>
                <option value="completed">Active Changes</option>
                <option value="undone">Rolled Back</option>
              </select>

              <button
                onClick={loadActions}
                style={{
                  padding: '6px 12px',
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '13px'
                }}
              >
                Refresh
              </button>

              <a
                href="http://127.0.0.1:8000/api/actions/export?format=csv"
                download="idler_action_ledger.csv"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  background: '#1e293b',
                  color: '#38bdf8',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '13px',
                  textDecoration: 'none'
                }}
              >
                <Download size={13} />
                Export CSV
              </a>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ padding: '10px 12px' }}>Timestamp</th>
                  <th style={{ padding: '10px 12px' }}>Action Type</th>
                  <th style={{ padding: '10px 12px' }}>Source / Target</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Rollback</th>
                </tr>
              </thead>
              <tbody>
                {filteredActions.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
                      No actions match the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredActions.map((act) => (
                    <tr key={act.id} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '12px', color: '#64748b', fontSize: '12px' }}>
                        {act.created_at ? new Date(act.created_at).toLocaleTimeString() : '—'}
                      </td>
                      <td style={{ padding: '12px', fontWeight: '600', color: '#cbd5e1' }}>{act.action_type}</td>
                      <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                        <div style={{ color: '#e2e8f0' }}>{act.source}</div>
                        {act.destination && <div style={{ color: '#38bdf8', fontSize: '12px' }}>&rarr; {act.destination}</div>}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          background: act.status === 'completed' ? '#064e3b' : act.status === 'rolled_back' ? '#451a03' : '#1e293b',
                          color: act.status === 'completed' ? '#6ee7b7' : act.status === 'rolled_back' ? '#fcd34d' : '#94a3b8'
                        }}>
                          {act.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        {act.rollback_supported && !act.is_undone && (
                          <button
                            onClick={() => handleUndo(act.id)}
                            disabled={undoingId === act.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 12px',
                              background: '#374151',
                              color: '#f9fafb',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '600'
                            }}
                          >
                            <RotateCcw size={14} />
                            {undoingId === act.id ? 'Undoing...' : 'Undo Move'}
                          </button>
                        )}
                        {act.is_undone && (
                          <span style={{ fontSize: '12px', color: '#f59e0b' }}>Restored</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: DUPLICATE FINDER */}
      {tab === 'duplicates' && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Cryptographic Duplicate Finder</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px' }}>
                Pre-filters by file size, then computes streaming SHA-256 hashes. Safe and strictly read-only: no files are deleted.
              </p>
            </div>
            <button
              onClick={handleScanDuplicates}
              disabled={isScanningDups}
              style={{
                padding: '10px 20px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '600',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Search size={16} />
              {isScanningDups ? 'Scanning Hashes...' : 'Scan For Duplicates'}
            </button>
          </div>

          {dupResult && (
            <div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
              }}>
                <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>Scanned Files</div>
                  <div style={{ fontSize: '24px', fontWeight: '700' }}>{dupResult.scanned_files}</div>
                </div>
                <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>Duplicate Groups</div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>
                    {dupResult.duplicate_groups.length}
                  </div>
                </div>
                <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>Wasted Storage</div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#38bdf8' }}>
                    {(dupResult.total_wasted_bytes / 1024).toFixed(1)} KB
                  </div>
                </div>
              </div>

              {dupResult.duplicate_groups.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
                  <button
                    onClick={handleTrashAllDuplicates}
                    disabled={isTrashingAll}
                    style={{
                      padding: '10px 18px',
                      background: isTrashingAll ? '#7f1d1d' : '#dc2626',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: '600',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)'
                    }}
                  >
                    <Trash2 size={16} />
                    {isTrashingAll ? 'Moving Redundant Copies to Trash...' : 'Trash All Redundant Copies (Keep Originals)'}
                  </button>
                </div>
              )}

              {dupResult.duplicate_groups.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                  No duplicate files found in workspace!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {dupResult.duplicate_groups.map((group, idx) => (
                    <div key={idx} style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '10px',
                      padding: '16px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#f59e0b' }}>
                          Duplicate Group #{idx + 1} ({group.count} copies, {(group.size_bytes / 1024).toFixed(1)} KB each)
                        </span>
                        <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#64748b' }}>
                          SHA-256: {group.sha256.substring(0, 16)}...
                        </span>
                      </div>
                      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {group.paths.map((p, pIdx) => (
                          <li key={pIdx} style={{
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            color: '#e2e8f0',
                            padding: '8px 12px',
                            background: '#0f172a',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                              <FileCheck size={14} color={pIdx === 0 ? '#10b981' : '#38bdf8'} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
                            </div>
                            {pIdx === 0 ? (
                              <span style={{
                                fontSize: '11px',
                                background: '#064e3b',
                                color: '#6ee7b7',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontWeight: '600',
                                flexShrink: 0
                              }}>
                                Keep Original
                              </span>
                            ) : (
                              <button
                                onClick={() => handleTrashDuplicate(p)}
                                disabled={trashingPath === p}
                                title="Move duplicate copy to macOS Trash (recoverable)"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 10px',
                                  background: '#450a0a',
                                  color: '#fca5a5',
                                  border: '1px solid #7f1d1d',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  cursor: 'pointer',
                                  flexShrink: 0
                                }}
                              >
                                <Trash2 size={12} />
                                {trashingPath === p ? 'Trashing...' : 'Move to Trash'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SAVED WORKFLOWS */}
      {tab === 'workflows' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
          {/* Create Workflow Card */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderSync size={18} color="#38bdf8" />
              Save New Repetitive Workflow
            </h2>
            <form onSubmit={handleCreateWorkflow} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Workflow Name (e.g. Daily Downloads Tidy)"
                  value={wfName}
                  onChange={(e) => setWfName(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff'
                  }}
                />
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={wfDesc}
                  onChange={(e) => setWfDesc(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff'
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Natural Language Command (e.g. Sort PDFs and images into their folders)"
                  value={wfQuery}
                  onChange={(e) => setWfQuery(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff'
                  }}
                />
                <input
                  type="text"
                  placeholder="Auto-run Daily (HH:MM UTC, e.g. 09:00)"
                  value={wfCron}
                  onChange={(e) => setWfCron(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff'
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={!wfName.trim() || !wfQuery.trim()}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 20px',
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '600'
                }}
              >
                Save Workflow
              </button>
            </form>
          </div>

          {/* Saved Workflows List */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Your Saved Workflows</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {workflows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px', color: '#64748b' }}>
                  No saved workflows yet. Create one above to automate repetitive tasks!
                </div>
              ) : (
                workflows.map((wf) => (
                  <div key={wf.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#1e293b',
                    padding: '16px',
                    borderRadius: '10px',
                    border: '1px solid #334155',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px', fontWeight: '600', color: '#f8fafc' }}>{wf.name}</span>
                        {wf.schedule_cron && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#1e3a8a',
                            color: '#93c5fd',
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontWeight: '600'
                          }}>
                            <Clock size={11} />
                            Daily at {wf.schedule_cron} UTC
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>{wf.query}</div>
                      {wf.description && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{wf.description}</div>}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {wf.schedule_cron && (
                        <button
                          onClick={() => handleToggleWorkflow(wf.id)}
                          title={wf.is_active ? 'Click to pause auto-schedule' : 'Click to enable auto-schedule'}
                          style={{
                            padding: '8px 12px',
                            background: wf.is_active ? '#064e3b' : '#374151',
                            color: wf.is_active ? '#6ee7b7' : '#9ca3af',
                            border: '1px solid #334155',
                            borderRadius: '8px',
                            fontWeight: '600',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          {wf.is_active ? 'Active' : 'Paused'}
                        </button>
                      )}

                      <button
                        onClick={() => handleRunWorkflow(wf.id, wf.name)}
                        disabled={isRunningWf === wf.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 16px',
                          background: isRunningWf === wf.id ? '#475569' : '#10b981',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontWeight: '600',
                          fontSize: '13px',
                          cursor: 'pointer'
                        }}
                      >
                        <Play size={14} />
                        {isRunningWf === wf.id ? 'Running...' : 'Run Now'}
                      </button>

                      <button
                        onClick={() => handleDeleteWorkflow(wf.id, wf.name)}
                        title="Delete workflow"
                        style={{
                          padding: '8px 10px',
                          background: '#450a0a',
                          color: '#fca5a5',
                          border: '1px solid #7f1d1d',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          cursor: 'pointer'
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB: PROJECT INSPECTOR */}
      {tab === 'projects' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Code2 size={20} color="#38bdf8" />
                Project & Repository Inspector
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
                Safely inspects project structure, detects manifests (Python, Node, Rust, Go), categorizes languages, and parses README documentation without executing untrusted code.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Folder relative to workspace (e.g. . or Projects/portfolio-site)"
                value={projPath}
                onChange={(e) => setProjPath(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: '280px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#ffffff',
                  fontSize: '14px'
                }}
              />
              <button
                type="button"
                onClick={handleInspectProject}
                disabled={isInspectingProj}
                style={{
                  padding: '12px 20px',
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '600',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer'
                }}
              >
                <Search size={16} />
                {isInspectingProj ? 'Inspecting Repo...' : 'Inspect Repository'}
              </button>
            </div>

            {projResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Stats Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
                  <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                    <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Project Stack</div>
                    <div style={{ fontSize: '22px', fontWeight: '700', color: '#38bdf8', textTransform: 'uppercase' }}>
                      {projResult.project_type}
                    </div>
                  </div>
                  <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                    <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Files</div>
                    <div style={{ fontSize: '22px', fontWeight: '700', color: '#f8fafc' }}>
                      {projResult.total_files}
                    </div>
                  </div>
                  <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                    <div style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Key Manifests</div>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#a7f3d0', marginTop: '6px' }}>
                      {projResult.key_files.slice(0, 3).join(', ') || 'Standard Directory'}
                    </div>
                  </div>
                </div>

                {/* Languages breakdown */}
                <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '18px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Layers size={15} color="#38bdf8" />
                    Language Composition
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {Object.entries(projResult.languages).map(([lang, count]) => (
                      <span key={lang} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: '#0f172a',
                        color: '#f8fafc',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '13px',
                        border: '1px solid #334155'
                      }}>
                        <strong style={{ color: '#38bdf8' }}>{lang}</strong>
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>({count} files)</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* README Snippet Preview Card */}
                {projResult.readme_snippet && (
                  <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '18px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#cbd5e1', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <File size={15} color="#38bdf8" />
                      README Overview (Untrusted Text Preview)
                    </h4>
                    <pre style={{
                      background: '#0f172a',
                      color: '#cbd5e1',
                      padding: '16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      maxHeight: '260px',
                      overflowY: 'auto',
                      border: '1px solid #1e293b',
                      lineHeight: '1.5'
                    }}>
                      {projResult.readme_snippet}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: WORKSPACES */}
      {tab === 'workspaces' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
          {/* Register New Local Folder Card */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PlusCircle size={18} color="#38bdf8" />
              Add Local Folder on Your Computer to Idler
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '16px' }}>
              Allow Idler to manage and clean up any folder on your computer (e.g. <code>~/Downloads</code>, <code>/Users/kashvi/Desktop/MyFolder</code>).
            </p>

            {registerSuccess && (
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid #10b981',
                color: '#6ee7b7',
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '14px'
              }}>
                ✓ {registerSuccess}
              </div>
            )}

            <form onSubmit={handleAddCustomWorkspace} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Local folder path (e.g. ~/Downloads or /Users/kashvi/Downloads)"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff'
                  }}
                />
                <input
                  type="text"
                  placeholder="Friendly name (e.g. My Downloads)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff'
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={!customPath.trim()}
                style={{
                  alignSelf: 'flex-start',
                  padding: '10px 20px',
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '600'
                }}
              >
                Allow & Add Folder
              </button>
            </form>
          </div>

          {/* Allowed Workspaces List */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Allowed Workspaces & Folders</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px' }}>
                Idler is strictly confined to these directories on your computer.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {workspaces.map((ws, idx) => (
                <div key={idx} style={{
                  background: '#1e293b',
                  border: selectedWorkspace === ws.path ? '1px solid #3b82f6' : '1px solid #334155',
                  borderRadius: '10px',
                  padding: '16px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <span style={{ fontWeight: '600', color: '#f8fafc', marginRight: '8px' }}>{ws.name}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#38bdf8' }}>{ws.path}</span>
                      <span style={{ marginLeft: '12px', fontSize: '13px', color: '#94a3b8' }}>
                        ({ws.files_count} files, {(ws.total_size_bytes / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {selectedWorkspace === ws.path ? (
                        <span style={{ fontSize: '12px', background: '#1e3a8a', color: '#93c5fd', padding: '3px 8px', borderRadius: '4px' }}>
                          Active Folder
                        </span>
                      ) : (
                        <button
                          onClick={() => setSelectedWorkspace(ws.path)}
                          style={{
                            padding: '4px 10px',
                            background: '#374151',
                            color: '#f9fafb',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          Set as Active
                        </button>
                      )}
                      {ws.is_removable && (
                        <button
                          onClick={() => handleRemoveWorkspace(ws.path, ws.name)}
                          title="Remove folder from Idler (files on disk are NOT deleted)"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 10px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            color: '#fca5a5',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={13} />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {ws.preview.slice(0, 6).map((f, fIdx) => (
                      <span key={fIdx} style={{
                        fontSize: '11px',
                        background: '#0f172a',
                        color: '#cbd5e1',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontFamily: 'monospace'
                      }}>
                        {f.name} <span style={{ color: '#64748b' }}>({f.category})</span>
                      </span>
                    ))}
                    {ws.files_count > 6 && (
                      <span style={{
                        fontSize: '11px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#94a3b8',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontStyle: 'italic',
                      }}>
                        +{ws.files_count - 6} more files
                      </span>
                    )}
                  </div>

                  {/* Subfolders in this workspace */}
                  {ws.subdirectories && ws.subdirectories.length > 0 && (
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #334155' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>
                        Subfolders & Categories in this Workspace ({ws.subdirectories.length}):
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                        {ws.subdirectories.map((sub, sIdx) => {
                          const isActiveSub = selectedWorkspace === sub.path;
                          return (
                            <button
                              key={sIdx}
                              onClick={() => { setSelectedWorkspace(sub.path); setTab('planner'); }}
                              title={`Focus on folder "${sub.name}" in Planner`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '4px 10px',
                                background: isActiveSub ? '#1e3a8a' : '#0f172a',
                                border: isActiveSub ? '1px solid #38bdf8' : '1px solid #334155',
                                borderRadius: '6px',
                                color: isActiveSub ? '#ffffff' : '#cbd5e1',
                                fontSize: '12px',
                                cursor: 'pointer'
                              }}
                            >
                              <span>📁 {sub.name}</span>
                              <span style={{ color: '#38bdf8', fontSize: '11px' }}>({sub.files_count} files)</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Global Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
