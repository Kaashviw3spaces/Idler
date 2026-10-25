import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  History,
  Search,
  Code2,
  FolderSync,
  FolderOpen,
  FolderPlus,
  Folder,
  ArrowRight,
  Settings,
  Power,
  RotateCcw,
  Trash2,
  Play,
  ChevronRight,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  FileCode,
  Archive,
  FileSpreadsheet,
  File,
  Download,
  HardDrive,
} from 'lucide-react';
import { CompactStorageAnalytics } from './components/CompactStorageAnalytics';
import { FilePreviewModal, FilePreviewTarget } from './components/FilePreviewModal';
import {
  PlanResponse,
  ActionRecord,
  WorkspaceItem,
  DuplicateScanResult,
  WorkflowItem,
  ProjectInspectionResult,
  WorkspaceFilePreview,
} from './types';
import { SoundPlatform, playTaskCompleteChime } from './sound';
import * as api from './api';

interface CozyPopoverProps {
  workspaces: WorkspaceItem[];
  selectedWorkspace: string;
  onSelectWorkspace: (path: string) => void;
  actions: ActionRecord[];
  onRefreshActions: () => Promise<void>;
  onRefreshWorkspaces: () => Promise<void>;
  workflows?: WorkflowItem[];
  onRefreshWorkflows?: () => Promise<void>;
  soundMode: SoundPlatform;
  onChangeSoundMode: (mode: SoundPlatform) => void;
  soundMuted: boolean;
  onToggleSoundMute: () => void;
  onOpenStudio?: () => void;
  onQuit?: () => void;
  liveFiles?: WorkspaceFilePreview[];
  isLoadingFiles?: boolean;
  addToast: (kind: 'success' | 'error' | 'info', message: string) => void;
}

type CozyTab = 'planner' | 'ledger' | 'duplicates' | 'projects' | 'workflows' | 'workspaces' | 'storage';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileIcon(category?: string, filename?: string) {
  const cat = (category || '').toLowerCase();
  const ext = filename ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';

  if (cat === 'images' || ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'].includes(ext)) {
    return <ImageIcon size={13} color="#f472b6" />;
  }
  if (cat === 'code' || ['.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.json', '.c', '.cpp', '.rs', '.go', '.sh', '.yaml', '.yml'].includes(ext)) {
    return <FileCode size={13} color="#34d399" />;
  }
  if (cat === 'spreadsheets' || ['.csv', '.xlsx', '.xls', '.tsv'].includes(ext)) {
    return <FileSpreadsheet size={13} color="#4ade80" />;
  }
  if (cat === 'archives' || ['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) {
    return <Archive size={13} color="#fb923c" />;
  }
  if (cat === 'documents' || ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf'].includes(ext)) {
    return <FileText size={13} color="#60a5fa" />;
  }
  return <File size={13} color="#94a3b8" />;
}

const STANDARD_CATEGORIES = new Set([
  'documents', 'spreadsheets', 'images', 'code', 'archives', 'media', 'presentations', 'other'
]);

function getDestinationSubfolder(destination?: string): string {
  if (!destination) return '';
  const clean = destination.trim().replace(/^\/+|\/+$/g, '');
  const lastSlash = clean.lastIndexOf('/');
  if (lastSlash > -1) {
    return clean.substring(0, lastSlash);
  }
  if (clean.includes('.')) {
    return '(root)';
  }
  return clean || '(root)';
}

export const CozyPopover: React.FC<CozyPopoverProps> = ({
  workspaces,
  selectedWorkspace,
  onSelectWorkspace,
  actions,
  onRefreshActions,
  onRefreshWorkspaces,
  workflows = [],
  onRefreshWorkflows,
  soundMode,
  onChangeSoundMode,
  soundMuted,
  onToggleSoundMute,
  onOpenStudio,
  onQuit,
  liveFiles = [],
  isLoadingFiles = false,
  addToast,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<CozyTab>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('idler_active_cozy_tab') as CozyTab | null;
        const validTabs: CozyTab[] = ['planner', 'ledger', 'duplicates', 'projects', 'workflows', 'workspaces'];
        if (saved && validTabs.includes(saved)) {
          return saved;
        }
      } catch {}
    }
    return 'planner';
  });
  const [hoveredTab, setHoveredTab] = useState<CozyTab | null>(null);

  // Persist active tab so clicking the menu bar icon always reopens to the same tab
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('idler_active_cozy_tab', activeTab);
      } catch {}
    }
  }, [activeTab]);

  // Planner state
  const [prompt, setPrompt] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PlanResponse | null>(null);
  const [autoSortEnabled, setAutoSortEnabled] = useState(true);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);

  // Duplicates state
  const [dupScan, setDupScan] = useState<DuplicateScanResult | null>(null);
  const [isScanningDups, setIsScanningDups] = useState(false);

  // Project inspector state
  const [projPath, setProjPath] = useState('.');
  const [isInspectingProj, setIsInspectingProj] = useState(false);
  const [projResult, setProjResult] = useState<ProjectInspectionResult | null>(null);

  // Workflow running state
  const [runningWfId, setRunningWfId] = useState<string | null>(null);

  // Active folder / workspace addition state
  const [isAddingManualFolder, setIsAddingManualFolder] = useState(false);
  const [manualFolderPath, setManualFolderPath] = useState('');
  const [isRegisteringFolder, setIsRegisteringFolder] = useState(false);
  const [activePreviewFile, setActivePreviewFile] = useState<FilePreviewTarget | null>(null);

  // Targeted subfolder within active workspace (e.g. 'Idler')
  const [selectedSubfolder, setSelectedSubfolder] = useState<string | null>(null);

  // Reset selected subfolder when active workspace changes
  useEffect(() => {
    setSelectedSubfolder(null);
  }, [selectedWorkspace]);

  // Clean workspaces excluding any test workspaces
  const cleanWorkspaces = workspaces.filter(
    (w) => !w.path.toLowerCase().includes('test_workspace') && !w.name.toLowerCase().includes('test_workspace')
  );

  const effectiveWorkspace = selectedWorkspace || (
    cleanWorkspaces.find((w) => w.name.toLowerCase() === 'downloads')?.path || cleanWorkspaces[0]?.path || ''
  );

  const activeWsObj = cleanWorkspaces.find((w) => w.path === effectiveWorkspace) || cleanWorkspaces[0];

  // Auto-synchronize active workspace if selectedWorkspace is empty
  useEffect(() => {
    if (!selectedWorkspace && effectiveWorkspace) {
      onSelectWorkspace(effectiveWorkspace);
    }
  }, [selectedWorkspace, effectiveWorkspace, onSelectWorkspace]);

  // Active directory live files state
  const [workspaceFileFilter, setWorkspaceFileFilter] = useState('');
  const [internalFiles, setInternalFiles] = useState<WorkspaceFilePreview[]>([]);
  const [isFetchingInternalFiles, setIsFetchingInternalFiles] = useState(false);

  const fetchFiles = useCallback((targetPath: string) => {
    if (!targetPath) return;
    setIsFetchingInternalFiles(true);
    api.fetchWorkspaceFiles(targetPath)
      .then((res) => {
        if (res.files) {
          setInternalFiles(res.files);
        }
      })
      .catch(() => {
        setInternalFiles([]);
      })
      .finally(() => {
        setIsFetchingInternalFiles(false);
      });
  }, []);

  useEffect(() => {
    if (effectiveWorkspace) {
      fetchFiles(effectiveWorkspace);
    }
  }, [effectiveWorkspace, fetchFiles]);

  // Maintain and restore active tab & refresh data whenever window is shown from macOS menu bar
  useEffect(() => {
    const handlePopoutWakeup = () => {
      try {
        const saved = localStorage.getItem('idler_active_cozy_tab') as CozyTab | null;
        const validTabs: CozyTab[] = ['planner', 'ledger', 'duplicates', 'projects', 'workflows', 'workspaces'];
        if (saved && validTabs.includes(saved)) {
          setActiveTab((prev) => (prev !== saved ? saved : prev));
        }
      } catch {}
      onRefreshWorkspaces();
      onRefreshActions();
      if (effectiveWorkspace) {
        fetchFiles(effectiveWorkspace);
      }
    };

    let unsubscribeDesktop: (() => void) | undefined;
    if (window.idlerDesktop?.onWindowShown) {
      unsubscribeDesktop = window.idlerDesktop.onWindowShown(handlePopoutWakeup);
    }

    window.addEventListener('focus', handlePopoutWakeup);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        handlePopoutWakeup();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (unsubscribeDesktop) unsubscribeDesktop();
      window.removeEventListener('focus', handlePopoutWakeup);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [effectiveWorkspace, fetchFiles, onRefreshWorkspaces, onRefreshActions]);

  // Resolve files for active directory
  const activeFilesList = internalFiles.length > 0
    ? internalFiles
    : ((liveFiles && liveFiles.length > 0) ? liveFiles : (activeWsObj?.preview || []));

  const filteredActiveFiles = activeFilesList.filter((f) => {
    if (!workspaceFileFilter.trim()) return true;
    const q = workspaceFileFilter.toLowerCase();
    return (
      f.name.toLowerCase().includes(q) ||
      (f.relative_path && f.relative_path.toLowerCase().includes(q)) ||
      (f.category && f.category.toLowerCase().includes(q))
    );
  });

  const [visibleFileLimit, setVisibleFileLimit] = useState(8);
  const [isFilesSectionExpanded, setIsFilesSectionExpanded] = useState(true);

  // Reset file limit when switching workspace
  useEffect(() => {
    setVisibleFileLimit(8);
  }, [selectedWorkspace]);

  // Category counts breakdown for active workspace
  const activeCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of activeFilesList) {
      const c = f.category || 'other';
      counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  }, [activeFilesList]);

  // Compute sortable unorganized loose files for root and each subfolder (only >0 actions qualify)
  const sortableCounts = useMemo(() => {
    const rootName = activeWsObj?.name?.toLowerCase() || '';
    let rootSortable = 0;
    const subfolderSortable: Record<string, number> = {};

    for (const f of activeFilesList) {
      const rel = f.relative_path || f.name;
      const parts = rel.split('/').filter(Boolean);
      const cat = (f.category || '').toLowerCase();

      if (parts.length === 1) {
        // Loose file directly in workspace root
        if (rootName !== cat && !STANDARD_CATEGORIES.has(rootName)) {
          rootSortable++;
        }
      } else if (parts.length === 2) {
        // Loose file directly inside a subfolder (e.g. Idler/pyproject.toml)
        const subName = parts[0];
        // If subfolder is a category folder matching file type (e.g. Images/photo.png), it is already sorted!
        if (subName.toLowerCase() !== cat && !STANDARD_CATEGORIES.has(subName.toLowerCase())) {
          subfolderSortable[subName] = (subfolderSortable[subName] || 0) + 1;
        }
      }
    }

    return { rootSortable, subfolderSortable };
  }, [activeFilesList, activeWsObj?.name]);

  // Only suggest subfolders that CAN have proposed actions (> 0 sortable loose files)
  const sortableSubfolders = useMemo(() => {
    return (activeWsObj?.subdirectories || []).filter((sub) => {
      if (STANDARD_CATEGORIES.has(sub.name.toLowerCase())) return false;
      return (sortableCounts.subfolderSortable[sub.name] || 0) > 0;
    });
  }, [activeWsObj?.subdirectories, sortableCounts.subfolderSortable]);

  // Dynamic window resizing based on content height
  useEffect(() => {
    if (!containerRef.current) return;
    const updateHeight = () => {
      if (!containerRef.current) return;
      const height = Math.ceil(containerRef.current.offsetHeight || containerRef.current.getBoundingClientRect().height);
      if (window.idlerDesktop?.resizeHeight && height > 100) {
        window.idlerDesktop.resizeHeight(height);
      }
    };

    updateHeight();

    const ro = new ResizeObserver(() => {
      updateHeight();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [
    activeTab,
    optionsExpanded,
    actions.length,
    workflows.length,
    cleanWorkspaces.length,
    isAddingManualFolder,
    activeFilesList.length,
    isFetchingInternalFiles,
    visibleFileLimit,
    isFilesSectionExpanded,
  ]);

  // 8 Minimalist Chips in 2x4 Grid
  const chipsRow1 = [
    { label: 'Downloads', query: 'Organize files in Downloads folder by category' },
    { label: 'Sort Images', query: 'Move all images into Images subfolder' },
    { label: 'Documents', query: 'Sort PDF, Word, and text files into Documents' },
    { label: 'Duplicates', action: 'duplicates' },
  ];

  const chipsRow2 = [
    { label: 'Clean Temp', query: 'Identify temporary and scratch files' },
    { label: 'Spreadsheets', query: 'Group Excel and CSV spreadsheets into Spreadsheets' },
    { label: 'Auto-Sort', query: 'Organize all unorganized files by category' },
    { label: 'Custom…', action: 'custom' },
  ];

  // 6 Tabs exactly matching the attachment
  const tabs: { id: CozyTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'planner',
      label: 'Scan & Plan',
      icon: <Sparkles size={15} />,
    },
    {
      id: 'ledger',
      label: `Action Ledger & Undo (${actions.length})`,
      icon: <History size={15} />,
    },
    {
      id: 'duplicates',
      label: 'Duplicate Finder',
      icon: <Search size={15} />,
    },
    {
      id: 'projects',
      label: 'Project Inspector',
      icon: <Code2 size={15} />,
    },
    {
      id: 'workflows',
      label: `Saved Workflows (${workflows.length})`,
      icon: <FolderSync size={15} />,
    },
    {
      id: 'workspaces',
      label: `Workspaces (${cleanWorkspaces.length})`,
      icon: <FolderOpen size={15} />,
    },
    {
      id: 'storage',
      label: 'Storage Insights',
      icon: <HardDrive size={15} />,
    },
  ];

  async function handleRunPrompt(queryToRun?: string, subfolderOverride?: string | null) {
    const q = queryToRun || prompt;
    if (!q.trim()) return;
    setIsPlanning(true);
    setCurrentPlan(null);

    const targetSub = subfolderOverride !== undefined ? subfolderOverride : selectedSubfolder;
    const params: Record<string, any> = {};
    if (targetSub) {
      params.target_subfolder = targetSub;
    }

    try {
      const res = await api.createPlan(q, selectedWorkspace || undefined, params);
      setCurrentPlan(res);
      setOptionsExpanded(true);
      addToast('info', `Plan generated: ${res.actions.length} actions proposed`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleApproveAndExecute() {
    if (!currentPlan) return;
    setIsExecuting(true);
    try {
      // Step 1: Explicitly approve the plan
      await api.approveTask(currentPlan.task_id);
      // Step 2: Execute the approved task
      const res = await api.executeTask(currentPlan.task_id);
      setCurrentPlan(null);
      setPrompt('');
      setActiveChip(null);
      addToast('success', `Executed ${res.completed_actions}/${res.total_actions} actions`);
      playTaskCompleteChime(soundMode);
      await onRefreshActions();
      await onRefreshWorkspaces();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleUndo(actionId: string) {
    try {
      await api.undoAction(actionId);
      addToast('success', 'Action undone successfully');
      await onRefreshActions();
      await onRefreshWorkspaces();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  }

  async function handleScanDuplicates() {
    setIsScanningDups(true);
    try {
      const res = await api.scanDuplicates('.', selectedWorkspace || undefined);
      setDupScan(res);
      addToast('info', `Found ${res.duplicate_groups.length} duplicate groups (${fmtBytes(res.total_wasted_bytes)} wasted)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsScanningDups(false);
    }
  }

  async function handleTrashAllDuplicates() {
    try {
      const res = await api.trashAllDuplicates(selectedWorkspace || undefined);
      addToast('success', `Moved ${res.trashed_count} duplicate files to Trash`);
      await handleScanDuplicates();
      await onRefreshWorkspaces();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  }

  async function handleInspectProject() {
    setIsInspectingProj(true);
    try {
      const res = await api.inspectProject(projPath || '.', selectedWorkspace || undefined);
      setProjResult(res);
      addToast('success', `Inspected repository: detected ${res.project_type.toUpperCase()} stack`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setIsInspectingProj(false);
    }
  }

  async function handleToggleWorkflow(wfId: string) {
    try {
      await api.toggleWorkflow(wfId);
      if (onRefreshWorkflows) await onRefreshWorkflows();
      addToast('info', 'Workflow schedule updated');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    }
  }

  async function handleRunWorkflow(wf: WorkflowItem) {
    setRunningWfId(wf.id);
    try {
      const res = await api.runWorkflow(wf.id);
      addToast('success', `Workflow executed: ${res.completed_actions}/${res.total_actions} actions`);
      playTaskCompleteChime(soundMode);
      await onRefreshActions();
      await onRefreshWorkspaces();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', msg);
    } finally {
      setRunningWfId(null);
    }
  }

  async function handleSelectAndAddFolder() {
    if (window.idlerDesktop?.selectFolder) {
      try {
        const chosenPath = await window.idlerDesktop.selectFolder();
        if (!chosenPath) return;
        await handleRegisterNewFolder(chosenPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast('error', `Failed to open folder picker: ${msg}`);
      }
    } else {
      setIsAddingManualFolder(true);
    }
  }

  async function handleRegisterNewFolder(pathToAdd: string) {
    const cleanPath = pathToAdd.trim();
    if (!cleanPath) return;
    setIsRegisteringFolder(true);
    try {
      const folderName = cleanPath.split('/').filter(Boolean).pop() || cleanPath;
      await api.registerWorkspace(cleanPath, folderName);
      await onRefreshWorkspaces();
      onSelectWorkspace(cleanPath);
      setManualFolderPath('');
      setIsAddingManualFolder(false);
      addToast('success', `Active folder set to: ${folderName}`);
      playTaskCompleteChime(soundMode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', `Could not add folder: ${msg}`);
    } finally {
      setIsRegisteringFolder(false);
    }
  }

  async function handleRemoveWorkspace(wsPath: string, wsName: string) {
    try {
      await api.deleteWorkspace(wsPath);
      await onRefreshWorkspaces();
      if (selectedWorkspace === wsPath && workspaces.length > 0) {
        const fallback = workspaces.find((w) => w.path !== wsPath);
        if (fallback) onSelectWorkspace(fallback.path);
      }
      addToast('info', `Removed folder: ${wsName}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to remove folder: ${msg}`);
    }
  }

  const effectiveTab = hoveredTab || activeTab;

  function getSectionLabel(t: CozyTab): string {
    switch (t) {
      case 'planner':
        return 'KEEP ORGANIZED';
      case 'ledger':
        return `ACTION LEDGER & UNDO (${actions.length})`;
      case 'duplicates':
        return 'CRYPTOGRAPHIC DUPLICATE FINDER';
      case 'projects':
        return 'PROJECT & REPOSITORY INSPECTOR';
      case 'workflows':
        return `SAVED WORKFLOWS (${workflows.length})`;
      case 'workspaces':
        return 'ACTIVE FOLDER TO SCAN ON COMPUTER';
      case 'storage':
        return 'STORAGE ANALYTICS & INSIGHTS';
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: '380px',
        margin: '0 auto',
        // ONE Single Tinted Transparent Glass Container
        background: 'rgba(24, 21, 30, 0.93)',
        backdropFilter: 'blur(50px) saturate(200%)',
        WebkitBackdropFilter: 'blur(50px) saturate(200%)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '24px',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '9px',
        color: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
        position: 'relative',
        userSelect: 'none',
        boxSizing: 'border-box',
        transition: 'height 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Top Anchor Notch pointing to menu bar */}
      <div
        style={{
          position: 'absolute',
          top: '-6px',
          left: '50%',
          transform: 'translateX(-50%) rotate(45deg)',
          width: '12px',
          height: '12px',
          background: 'rgba(24, 21, 30, 0.97)',
          borderTop: '1px solid rgba(255, 255, 255, 0.16)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.16)',
          zIndex: 2,
        }}
      />

      {/* 1. Concise, Clean Top Header Card */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.09)',
          borderRadius: '12px',
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '7px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Sparkles size={13} color="#ffffff" />
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#ffffff' }}>
                Idler
              </span>
              <span
                onClick={() => setActiveTab('workspaces')}
                title="Click to switch workspace"
                style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                / {activeWsObj?.name || 'Workspace'}
              </span>
            </div>

            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
              {selectedSubfolder
                ? `${sortableCounts.subfolderSortable[selectedSubfolder] || 0} to sort in subfolder`
                : `${sortableCounts.rootSortable} unorganized loose file(s)`}
            </div>
          </div>
        </div>

        <button
          className="quick-sort-btn"
          onClick={() => {
            setActiveTab('planner');
            handleRunPrompt(
              selectedSubfolder
                ? `Organize all unorganized files in ${selectedSubfolder} folder by category`
                : 'Organize all unorganized files by category'
            );
          }}
          disabled={isPlanning}
          style={{
            background: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '5px 12px',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.35)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {isPlanning ? 'Thinking…' : 'Quick Sort'}
        </button>
      </div>

      {/* 2. Target Selector: Single Clean Line (Only shown if sortable subfolders exist) */}
      {sortableSubfolders.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            borderRadius: '8px',
            padding: '4px 8px',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>
            Target:
          </span>
          <select
            value={selectedSubfolder || ''}
            onChange={(e) => setSelectedSubfolder(e.target.value || null)}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              color: '#60a5fa',
              fontSize: '11px',
              fontWeight: '600',
              outline: 'none',
              cursor: 'pointer',
              textAlign: 'right',
            }}
          >
            <option value="" style={{ background: '#18151e', color: '#ffffff' }}>
              Entire {activeWsObj?.name} ({sortableCounts.rootSortable} loose files)
            </option>
            {sortableSubfolders.map((sub) => (
              <option key={sub.name} value={sub.name} style={{ background: '#18151e', color: '#ffffff' }}>
                📁 {sub.name} ({sortableCounts.subfolderSortable[sub.name]} files)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 2. Segmented Icon Tab Bar with Enhanced Animations */}
      <div
        onMouseLeave={() => setHoveredTab(null)}
        style={{
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '14px',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          position: 'relative',
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isHovered = hoveredTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              style={{
                flex: isHovered ? '1 1 auto' : hoveredTab ? '0 0 32px' : '1 1 0px',
                minWidth: '32px',
                maxWidth: isHovered ? '210px' : undefined,
                height: '32px',
                padding: isHovered ? '0 10px' : '0 6px',
                background: isActive ? '#2563eb' : isHovered ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                boxShadow: isActive ? '0 4px 14px rgba(37, 99, 235, 0.45)' : undefined,
                border: 'none',
                borderRadius: '10px',
                color: isActive ? '#ffffff' : isHovered ? '#ffffff' : '#8e8c95',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                position: 'relative',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                  transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {tab.icon}
              </span>

              {/* Text displayed beside the icon on hover */}
              {isHovered && (
                <span
                  style={{
                    marginLeft: '6px',
                    fontSize: '11px',
                    fontWeight: '600',
                    color: isActive ? '#ffffff' : '#f8fafc',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    animation: 'popoverTextIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                  }}
                >
                  {tab.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 4. Section Label */}
      <div
        style={{
          fontSize: '11px',
          fontWeight: '700',
          letterSpacing: '0.8px',
          color: '#76737c',
          textTransform: 'uppercase',
          paddingLeft: '2px',
          transition: 'color 0.2s ease',
        }}
      >
        {getSectionLabel(effectiveTab)}
      </div>

      {/* 5. CONTENT AREA: Clean, Direct Layout Inside the Single Tinted Box */}
      <div
        key={activeTab}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          animation: 'tabContentIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) ease-out',
        }}
      >
        {/* TAB 1: SCAN & PLAN */}
        {activeTab === 'planner' && (
          <>
            {/* Row 1: Auto-sort files by category with Spring iOS Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
              <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: '500' }}>
                Auto-sort files by category
              </span>
              <div
                onClick={() => setAutoSortEnabled(!autoSortEnabled)}
                style={{
                  width: '42px',
                  height: '24px',
                  borderRadius: '12px',
                  background: autoSortEnabled ? '#e2e8f0' : 'rgba(255, 255, 255, 0.14)',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: autoSortEnabled ? '20px' : '2px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: autoSortEnabled ? '#0f172a' : '#8e8c95',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                    transition: 'left 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                />
              </div>
            </div>

            {/* Row 2: 8 Chips in 2x4 Grid with Tactile Spring Micro-interactions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {chipsRow1.map((chip) => {
                  const isSel = activeChip === chip.label;
                  return (
                    <button
                      key={chip.label}
                      className="cozy-chip"
                      onClick={() => {
                        setActiveChip(chip.label);
                        if (chip.action === 'duplicates') {
                          setActiveTab('duplicates');
                          handleScanDuplicates();
                        } else if (chip.query) {
                          setPrompt(chip.query);
                          handleRunPrompt(chip.query);
                        }
                      }}
                      style={{
                        background: isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.07)',
                        border: '1px solid ' + (isSel ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)'),
                        boxShadow: isSel ? '0 4px 12px rgba(37, 99, 235, 0.4)' : undefined,
                        borderRadius: '9px',
                        padding: '8px 2px',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: isSel ? '#ffffff' : '#e2e8f0',
                        cursor: 'pointer',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {chipsRow2.map((chip) => {
                  const isSel = activeChip === chip.label;
                  return (
                    <button
                      key={chip.label}
                      className="cozy-chip"
                      onClick={() => {
                        setActiveChip(chip.label);
                        if (chip.action === 'custom') {
                          setOptionsExpanded(true);
                        } else if (chip.query) {
                          setPrompt(chip.query);
                          handleRunPrompt(chip.query);
                        }
                      }}
                      style={{
                        background: isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.07)',
                        border: '1px solid ' + (isSel ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)'),
                        boxShadow: isSel ? '0 4px 12px rgba(37, 99, 235, 0.4)' : undefined,
                        borderRadius: '9px',
                        padding: '8px 2px',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: isSel ? '#ffffff' : '#e2e8f0',
                        cursor: 'pointer',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Caption */}
            <div style={{ fontSize: '11px', color: '#8a8790', paddingLeft: '2px' }}>
              Click a chip to start. Natural language assistant below.
            </div>

            {/* Row 4: Expandable Options Accordion */}
            <div style={{ background: 'rgba(255, 255, 255, 0.04)', borderRadius: '12px', padding: '8px 10px' }}>
              <button
                onClick={() => setOptionsExpanded(!optionsExpanded)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#cbd5e1',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <span style={{ transform: optionsExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'flex' }}>
                  <ChevronRight size={14} color="#94a3b8" />
                </span>
                <span>Options & Natural Language</span>
              </button>

              {optionsExpanded && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', animation: 'accordionExpand 0.2s ease-out' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      padding: '5px 8px',
                      gap: '6px',
                    }}
                  >
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRunPrompt()}
                      placeholder="Ask Idler to organize or clean..."
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: '#ffffff',
                        fontSize: '11px',
                      }}
                    />
                    <button
                      onClick={() => handleRunPrompt()}
                      disabled={isPlanning || !prompt.trim()}
                      style={{
                        background: prompt.trim() ? '#2563eb' : 'rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: prompt.trim() ? 'pointer' : 'default',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <ArrowRight size={12} />
                    </button>
                  </div>

                  {currentPlan && (
                    <div
                      style={{
                        background: 'rgba(37, 99, 235, 0.12)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        borderRadius: '10px',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: '#60a5fa' }}>
                          Proposed {currentPlan.actions.length} Action{currentPlan.actions.length === 1 ? '' : 's'}
                        </div>
                        {currentPlan.actions.some((a) => a.type === 'move_file') && (
                          <span style={{ fontSize: '9px', color: '#fbbf24', fontWeight: '600', background: 'rgba(251, 191, 36, 0.1)', padding: '1px 5px', borderRadius: '4px' }}>
                            Subfolder routing
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: '10px',
                          color: '#cbd5e1',
                          maxHeight: '120px',
                          overflowY: 'auto',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          paddingRight: '2px',
                        }}
                      >
                        {currentPlan.actions.map((act, i) => {
                          const fileName = act.source.split('/').pop() || act.source;
                          const destSubfolder = getDestinationSubfolder(act.destination);
                          const isMove = act.type.toLowerCase().includes('move') || act.type === 'move_file';
                          const isRename = act.type.toLowerCase().includes('rename') || act.type === 'rename_file';

                          return (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '4px 6px',
                                borderRadius: '5px',
                                background: 'rgba(255, 255, 255, 0.04)',
                                border: '1px solid rgba(255, 255, 255, 0.06)',
                                gap: '6px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, overflow: 'hidden' }}>
                                <span
                                  style={{
                                    fontSize: '8px',
                                    fontWeight: '700',
                                    padding: '1px 4px',
                                    borderRadius: '3px',
                                    background: isMove
                                      ? 'rgba(56, 189, 248, 0.2)'
                                      : isRename
                                      ? 'rgba(251, 191, 36, 0.2)'
                                      : 'rgba(168, 85, 247, 0.2)',
                                    color: isMove ? '#38bdf8' : isRename ? '#fbbf24' : '#c084fc',
                                    letterSpacing: '0.4px',
                                    textTransform: 'uppercase',
                                    flexShrink: 0,
                                  }}
                                >
                                  {isMove ? 'MOVE' : isRename ? 'RENAME' : act.type}
                                </span>
                                <span
                                  style={{
                                    color: '#f8fafc',
                                    fontWeight: '500',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={act.source}
                                >
                                  {fileName}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                {isMove && destSubfolder ? (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      color: '#fbbf24',
                                      fontWeight: '600',
                                      background: 'rgba(251, 191, 36, 0.12)',
                                      border: '1px solid rgba(251, 191, 36, 0.3)',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      fontSize: '9px',
                                    }}
                                  >
                                    <span>→</span>
                                    <span>📁 {destSubfolder}</span>
                                  </span>
                                ) : act.destination ? (
                                  <span style={{ color: '#cbd5e1', fontSize: '9px' }}>
                                    → {act.destination.split('/').pop()}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                        <button
                          onClick={handleApproveAndExecute}
                          disabled={isExecuting}
                          style={{
                            flex: 1,
                            background: '#059669',
                            color: '#ffffff',
                            border: 'none',
                            padding: '6px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          {isExecuting ? 'Running…' : 'Approve & Run'}
                        </button>
                        <button
                          onClick={() => setCurrentPlan(null)}
                          style={{
                            background: 'rgba(255, 255, 255, 0.08)',
                            color: '#cbd5e1',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Chime Sound Platform Selector */}
                  <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                    {(['auto', 'mac', 'win'] as SoundPlatform[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => onChangeSoundMode(mode)}
                        style={{
                          flex: 1,
                          padding: '4px 0',
                          fontSize: '10px',
                          fontWeight: '500',
                          background: soundMode === mode ? '#2563eb' : 'rgba(255, 255, 255, 0.06)',
                          color: soundMode === mode ? '#ffffff' : '#8a8790',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {mode === 'auto' ? 'Auto OS' : mode === 'mac' ? 'Mac Glass' : 'Win Triad'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Divider Line */}
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '2px 0' }} />

            {/* Row 5: Audible completion chime */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '500', color: '#f1f5f9' }}>
                  Audible completion chime
                </div>
                <div style={{ fontSize: '11px', color: '#8a8790' }}>
                  {soundMuted ? 'Muted' : soundMode === 'mac' ? 'macOS Glass harmonic sound' : soundMode === 'win' ? 'Windows ascending triad' : 'Auto-detected for your OS'}
                </div>
              </div>

              <div
                onClick={onToggleSoundMute}
                style={{
                  width: '42px',
                  height: '24px',
                  borderRadius: '12px',
                  background: soundMuted ? 'rgba(255, 255, 255, 0.14)' : '#e2e8f0',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: soundMuted ? '2px' : '20px',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: soundMuted ? '#8e8c95' : '#0f172a',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                    transition: 'left 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* TAB 2: ACTION LEDGER & UNDO */}
        {activeTab === 'ledger' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
              <span>Recent File Actions ({actions.length})</span>
              {actions.length > 0 && (
                <a
                  href="http://127.0.0.1:8000/api/actions/export?format=csv"
                  download="idler-actions.csv"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    color: '#38bdf8',
                    textDecoration: 'none',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(56, 189, 248, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                  }}
                >
                  <Download size={10} /> Export CSV
                </a>
              )}
            </div>
            {actions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 10px', color: '#8a8790', fontSize: '12px' }}>
                No operations logged yet.
              </div>
            ) : (
              <div style={{ maxHeight: '190px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {actions.slice(0, 5).map((act) => (
                  <div
                    key={act.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{ overflow: 'hidden', paddingRight: '8px', minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '11px', fontWeight: '600', color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{act.action_type.toUpperCase()}</span>
                        {act.destination && (
                          <span
                            style={{
                              fontSize: '9px',
                              color: '#fbbf24',
                              fontWeight: '600',
                              background: 'rgba(251, 191, 36, 0.12)',
                              border: '1px solid rgba(251, 191, 36, 0.25)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                            }}
                          >
                            📁 {getDestinationSubfolder(act.destination)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: '#8a8790', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px', overflow: 'hidden' }}>
                        <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {act.source?.split('/').pop() || 'file'}
                        </span>
                        {act.destination && (
                          <span style={{ color: '#fbbf24', flexShrink: 0, fontWeight: '500' }}>
                            → 📁 {getDestinationSubfolder(act.destination)}
                          </span>
                        )}
                      </div>
                    </div>
                    {!act.is_undone ? (
                      <button
                        onClick={() => handleUndo(act.id)}
                        className="cozy-action-btn"
                        style={{
                          background: 'rgba(37, 99, 235, 0.2)',
                          color: '#93c5fd',
                          border: '1px solid rgba(37, 99, 235, 0.4)',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          fontSize: '10px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <RotateCcw size={10} /> Undo
                      </button>
                    ) : (
                      <span style={{ fontSize: '10px', color: '#76737c', fontStyle: 'italic' }}>Undone</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DUPLICATE FINDER */}
        {activeTab === 'duplicates' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2px' }}>
              <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                {dupScan
                  ? `${dupScan.duplicate_groups.length} duplicate groups (${fmtBytes(dupScan.total_wasted_bytes)} wasted)`
                  : 'Scan for identical files using SHA-256'}
              </span>
              <button
                onClick={handleScanDuplicates}
                disabled={isScanningDups}
                className="cozy-action-btn"
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {isScanningDups ? 'Scanning…' : 'Scan Now'}
              </button>
            </div>

            {dupScan && dupScan.duplicate_groups.length > 0 && (
              <button
                onClick={handleTrashAllDuplicates}
                className="cozy-action-btn"
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '9px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 14px rgba(220, 38, 38, 0.35)',
                }}
              >
                <Trash2 size={13} />
                Trash Redundant Copies ({fmtBytes(dupScan.total_wasted_bytes)})
              </button>
            )}

            {dupScan && dupScan.duplicate_groups.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px 10px', color: '#10b981', fontSize: '12px' }}>
                ✨ Clean! No duplicate files found.
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PROJECT INSPECTOR */}
        {activeTab === 'projects' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '12px', color: '#cbd5e1', padding: '0 2px' }}>
              Inspect repo manifests & structure:
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={projPath}
                onChange={(e) => setProjPath(e.target.value)}
                placeholder="Relative path (e.g. .)"
                style={{
                  flex: 1,
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  padding: '6px 8px',
                  fontSize: '11px',
                  color: '#ffffff',
                }}
              />
              <button
                onClick={handleInspectProject}
                disabled={isInspectingProj}
                className="cozy-action-btn"
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Code2 size={12} />
                {isInspectingProj ? 'Inspecting…' : 'Inspect'}
              </button>
            </div>

            {projResult && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#8a8790' }}>Stack</span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#38bdf8' }}>
                    {projResult.project_type.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#8a8790' }}>Total Files</span>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#ffffff' }}>
                    {projResult.total_files}
                  </span>
                </div>
                {projResult.key_files.length > 0 && (
                  <div style={{ fontSize: '10px', color: '#a7f3d0' }}>
                    Manifests: {projResult.key_files.slice(0, 3).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: SAVED WORKFLOWS */}
        {activeTab === 'workflows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
              <span>Recurring Workflows</span>
              <span style={{ color: '#8a8790' }}>{workflows.length} configured</span>
            </div>

            {workflows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 10px', color: '#8a8790', fontSize: '12px' }}>
                No saved workflows yet.
              </div>
            ) : (
              <div style={{ maxHeight: '190px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {workflows.map((wf) => (
                  <div
                    key={wf.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontSize: '11px', fontWeight: '600', color: '#f1f5f9' }}>
                        {wf.name}
                      </div>
                      <div style={{ fontSize: '10px', color: '#8a8790', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {wf.schedule_cron ? `${wf.schedule_cron} • ` : ''}{wf.query}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        onClick={() => handleRunWorkflow(wf)}
                        disabled={runningWfId === wf.id}
                        className="cozy-action-btn"
                        style={{
                          background: '#2563eb',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        <Play size={10} />
                      </button>
                      <div
                        onClick={() => handleToggleWorkflow(wf.id)}
                        style={{
                          width: '28px',
                          height: '16px',
                          borderRadius: '8px',
                          background: wf.is_active ? '#10b981' : 'rgba(255, 255, 255, 0.16)',
                          position: 'relative',
                          cursor: 'pointer',
                          transition: 'background 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: '2px',
                            left: wf.is_active ? '14px' : '2px',
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            background: '#ffffff',
                            transition: 'left 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 6: WORKSPACES */}
        {activeTab === 'workspaces' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Top Bar: Subtitle & Minimalist + Add Folder Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Select active directory to scan ({cleanWorkspaces.length})
              </span>
              <button
                onClick={handleSelectAndAddFolder}
                className="cozy-action-btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  background: 'rgba(37, 99, 235, 0.22)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  borderRadius: '7px',
                  padding: '4px 9px',
                  color: '#60a5fa',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <FolderPlus size={12} />
                <span>+ Add Folder</span>
              </button>
            </div>

            {/* Manual Path Input Fallback Form */}
            {isAddingManualFolder && (
              <div style={{ display: 'flex', gap: '6px', animation: 'accordionExpand 0.2s ease-out' }}>
                <input
                  type="text"
                  placeholder="/path/to/folder or ~/Documents"
                  value={manualFolderPath}
                  onChange={(e) => setManualFolderPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRegisterNewFolder(manualFolderPath);
                    if (e.key === 'Escape') setIsAddingManualFolder(false);
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    background: 'rgba(0, 0, 0, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    borderRadius: '7px',
                    padding: '5px 9px',
                    fontSize: '11px',
                    color: '#ffffff',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => handleRegisterNewFolder(manualFolderPath)}
                  disabled={isRegisteringFolder || !manualFolderPath.trim()}
                  style={{
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '7px',
                    padding: '5px 10px',
                    fontSize: '11px',
                    fontWeight: '600',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  {isRegisteringFolder ? 'Adding…' : 'Add'}
                </button>
                <button
                  onClick={() => setIsAddingManualFolder(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '7px',
                    padding: '5px 8px',
                    fontSize: '11px',
                    color: '#94a3b8',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* List of Registered Folders */}
            <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {cleanWorkspaces.map((ws) => {
                const isSel = ws.path === selectedWorkspace;
                return (
                  <div key={ws.path} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div
                      onClick={() => {
                        onSelectWorkspace(ws.path);
                        setSelectedSubfolder(null);
                        addToast('info', `Active folder: ${ws.name}`);
                      }}
                      className="cozy-chip"
                      style={{
                        background: isSel ? 'rgba(37, 99, 235, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid ' + (isSel ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)'),
                        boxShadow: isSel ? '0 4px 14px rgba(37, 99, 235, 0.3)' : undefined,
                        borderRadius: '10px',
                        padding: '7px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '6px',
                            background: isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <FolderOpen size={13} color={isSel ? '#ffffff' : '#94a3b8'} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '12px', fontWeight: isSel ? '700' : '600', color: isSel ? '#ffffff' : '#e2e8f0' }}>
                              {ws.name}
                            </span>
                            {isSel && (
                              <span style={{
                                fontSize: '9px',
                                fontWeight: '700',
                                background: '#2563eb',
                                color: '#ffffff',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                letterSpacing: '0.4px',
                              }}>
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '10px', color: '#8a8790', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ws.path}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          {ws.files_count} files
                        </span>
                        {ws.is_removable && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveWorkspace(ws.path, ws.name);
                            }}
                            title="Remove workspace"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '3px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              opacity: 0.7,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Subdirectories of this workspace */}
                    {isSel && ws.subdirectories && ws.subdirectories.length > 0 && (
                      <div style={{
                        marginLeft: '12px',
                        paddingLeft: '8px',
                        borderLeft: '2px solid rgba(59, 130, 246, 0.25)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        marginTop: '1px',
                        marginBottom: '4px',
                      }}>
                        {ws.subdirectories.map((sub) => {
                          const isSubActive = selectedSubfolder === sub.name;
                          return (
                            <div
                              key={sub.path}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: isSubActive ? 'rgba(37, 99, 235, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid ' + (isSubActive ? 'rgba(59, 130, 246, 0.35)' : 'rgba(255, 255, 255, 0.05)'),
                                borderRadius: '6px',
                                padding: '3px 7px',
                                fontSize: '11px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, flex: 1 }}>
                                <Folder size={11} color={isSubActive ? '#60a5fa' : '#94a3b8'} />
                                <span style={{ color: isSubActive ? '#ffffff' : '#cbd5e1', fontWeight: isSubActive ? '700' : '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sub.name}
                                </span>
                                <span style={{ color: '#64748b', fontSize: '10px' }}>({sub.files_count})</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectWorkspace(sub.path);
                                    setSelectedSubfolder(null);
                                    addToast('info', `Active directory set to: ${sub.name}`);
                                  }}
                                  title="Set this subfolder as the active directory"
                                  style={{
                                    background: 'rgba(37, 99, 235, 0.22)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    borderRadius: '5px',
                                    padding: '1px 6px',
                                    color: '#93c5fd',
                                    fontSize: '10px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Open
                                </button>
                                {!STANDARD_CATEGORIES.has(sub.name.toLowerCase()) && (sortableCounts.subfolderSortable[sub.name] || 0) > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedSubfolder(sub.name);
                                      setActiveTab('planner');
                                      handleRunPrompt(`Organize all unorganized files in ${sub.name} folder by category`, sub.name);
                                    }}
                                    title={`Sort ${sortableCounts.subfolderSortable[sub.name]} loose file(s) in ${sub.name} into its own subfolders (code, images, etc.)`}
                                    style={{
                                      background: 'rgba(16, 185, 129, 0.2)',
                                      border: '1px solid rgba(52, 211, 153, 0.35)',
                                      borderRadius: '5px',
                                      padding: '1px 6px',
                                      color: '#6ee7b7',
                                      fontSize: '10px',
                                      fontWeight: '600',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Sort ({sortableCounts.subfolderSortable[sub.name]})
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Active Directory Files Preview Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
                <button
                  type="button"
                  onClick={() => setIsFilesSectionExpanded(!isFilesSectionExpanded)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: 'transparent',
                    border: 'none',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {isFilesSectionExpanded ? <ChevronDown size={12} color="#3b82f6" /> : <ChevronRight size={12} color="#3b82f6" />}
                  <span style={{ fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Files in {activeWsObj?.name || 'Active Directory'} ({activeFilesList.length})
                  </span>
                </button>
                {activeFilesList.length > 5 && isFilesSectionExpanded && (
                  <input
                    type="text"
                    placeholder="Filter files…"
                    value={workspaceFileFilter}
                    onChange={(e) => setWorkspaceFileFilter(e.target.value)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      padding: '2px 7px',
                      fontSize: '10px',
                      color: '#f8fafc',
                      outline: 'none',
                      width: '95px',
                    }}
                  />
                )}
              </div>

              {isFilesSectionExpanded && (
                <>
                  {/* Category counts overview chips */}
                  {Object.keys(activeCategoryCounts).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '0 2px' }}>
                      {Object.entries(activeCategoryCounts).map(([cat, count]) => (
                        <span
                          key={cat}
                          style={{
                            fontSize: '9px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#94a3b8',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <span style={{ textTransform: 'capitalize' }}>{cat}:</span>
                          <span style={{ color: '#cbd5e1', fontWeight: '600' }}>{count}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Scrollable Files Container */}
                  <div
                    style={{
                      maxHeight: '160px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      background: 'rgba(0, 0, 0, 0.28)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '10px',
                      padding: '5px',
                    }}
                  >
                    {(isLoadingFiles || isFetchingInternalFiles) && activeFilesList.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '16px 8px', color: '#94a3b8', fontSize: '11px' }}>
                        Scanning files…
                      </div>
                    ) : filteredActiveFiles.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '16px 8px', color: '#94a3b8', fontSize: '11px' }}>
                        {workspaceFileFilter ? 'No matching files found.' : 'No files in this directory.'}
                      </div>
                    ) : (
                      filteredActiveFiles.slice(0, visibleFileLimit).map((file, idx) => (
                        <div
                          key={`${file.relative_path || file.name}-${idx}`}
                          onClick={() => setActivePreviewFile({
                            name: file.name,
                            relative_path: file.relative_path || file.name,
                            category: file.category,
                            size_bytes: file.size_bytes,
                          })}
                          title="Click to preview file (PowerPoint, Images, Docs, Spreadsheets, PDF)"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            borderRadius: '6px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            fontSize: '11px',
                            gap: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
                            e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                            {getFileIcon(file.category, file.name)}
                            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ color: '#f1f5f9', fontWeight: '500' }}>{file.name}</span>
                              {file.relative_path && file.relative_path !== file.name && (
                                <span style={{ color: '#64748b', fontSize: '9px', marginLeft: '4px' }}>
                                  {file.relative_path.slice(0, file.relative_path.lastIndexOf('/') + 1)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            {file.category && (
                              <span
                                style={{
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: 'rgba(255, 255, 255, 0.07)',
                                  color: '#94a3b8',
                                  fontWeight: '500',
                                }}
                              >
                                {file.category}
                              </span>
                            )}
                            <span style={{ color: '#64748b', fontSize: '10px' }}>
                              {fmtBytes(file.size_bytes || 0)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Pagination Controls Footer */}
                  {filteredActiveFiles.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 4px',
                        fontSize: '10px',
                        color: '#94a3b8',
                      }}
                    >
                      <span>
                        Showing {Math.min(visibleFileLimit, filteredActiveFiles.length)} of {filteredActiveFiles.length} files
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {filteredActiveFiles.length > visibleFileLimit && (
                          <button
                            type="button"
                            onClick={() => setVisibleFileLimit((prev) => Math.min(prev + 12, filteredActiveFiles.length))}
                            style={{
                              background: 'rgba(255, 255, 255, 0.08)',
                              border: '1px solid rgba(255, 255, 255, 0.12)',
                              borderRadius: '4px',
                              color: '#38bdf8',
                              fontSize: '10px',
                              padding: '2px 6px',
                              cursor: 'pointer',
                            }}
                          >
                            + Show {Math.min(12, filteredActiveFiles.length - visibleFileLimit)} more
                          </button>
                        )}
                        {visibleFileLimit > 8 && (
                          <button
                            type="button"
                            onClick={() => setVisibleFileLimit(8)}
                            style={{
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              borderRadius: '4px',
                              color: '#94a3b8',
                              fontSize: '10px',
                              padding: '2px 6px',
                              cursor: 'pointer',
                            }}
                          >
                            Fewer
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* 7. Storage Analytics Tab */}
        {activeTab === 'storage' && (
          <div
            style={{
              padding: '4px 2px',
              animation: 'tabContentIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) ease-out',
            }}
          >
            <CompactStorageAnalytics
              activeWorkspace={cleanWorkspaces.find((w) => w.path === selectedWorkspace) || cleanWorkspaces[0] || null}
              workspaces={cleanWorkspaces}
              onSelectWorkspace={(ws) => onSelectWorkspace(ws.path)}
              onActionComplete={(msg) => addToast('success', msg)}
            />
          </div>
        )}
      </div>

      {/* 6. Bottom Action Footer: Settings & Quit Buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginTop: '4px',
        }}
      >
        <button
          className="cozy-action-btn"
          onClick={() => {
            if (onOpenStudio) {
              onOpenStudio();
            } else if (window.idlerDesktop?.openStudio) {
              window.idlerDesktop.openStudio();
            } else {
              window.open('http://localhost:5173', '_blank');
            }
          }}
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '10px 14px',
            color: '#cbd5e1',
            fontSize: '13px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <Settings size={15} color="#8a8790" />
          <span>Settings</span>
        </button>

        <button
          className="cozy-action-btn"
          onClick={() => {
            if (onQuit) {
              onQuit();
            } else if (window.idlerDesktop?.quitApp) {
              window.idlerDesktop.quitApp();
            } else {
              window.close();
            }
          }}
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '10px 14px',
            color: '#cbd5e1',
            fontSize: '13px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <Power size={15} color="#8a8790" />
          <span>Quit</span>
        </button>
      </div>

      {/* Quick Look File Preview Modal */}
      <FilePreviewModal
        file={activePreviewFile}
        workspacePath={effectiveWorkspace}
        onClose={() => setActivePreviewFile(null)}
      />
    </div>
  );
};
