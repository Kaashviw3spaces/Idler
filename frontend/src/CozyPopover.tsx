import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  History,
  Search,
  Code2,
  FolderSync,
  FolderOpen,
  FolderPlus,
  ArrowRight,
  Settings,
  Power,
  RotateCcw,
  Trash2,
  Play,
  ChevronRight,
} from 'lucide-react';
import {
  PlanResponse,
  ActionRecord,
  WorkspaceItem,
  DuplicateScanResult,
  WorkflowItem,
  ProjectInspectionResult,
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
  addToast: (kind: 'success' | 'error' | 'info', message: string) => void;
}

type CozyTab = 'planner' | 'ledger' | 'duplicates' | 'projects' | 'workflows' | 'workspaces';

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

  // Maintain and restore active tab whenever window is shown from macOS menu bar
  useEffect(() => {
    const restoreSavedTab = () => {
      try {
        const saved = localStorage.getItem('idler_active_cozy_tab') as CozyTab | null;
        const validTabs: CozyTab[] = ['planner', 'ledger', 'duplicates', 'projects', 'workflows', 'workspaces'];
        if (saved && validTabs.includes(saved)) {
          setActiveTab((prev) => (prev !== saved ? saved : prev));
        }
      } catch {}
    };

    let unsubscribeDesktop: (() => void) | undefined;
    if (window.idlerDesktop?.onWindowShown) {
      unsubscribeDesktop = window.idlerDesktop.onWindowShown(restoreSavedTab);
    }

    window.addEventListener('focus', restoreSavedTab);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        restoreSavedTab();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (unsubscribeDesktop) unsubscribeDesktop();
      window.removeEventListener('focus', restoreSavedTab);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

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

  const activeWsObj = workspaces.find((w) => w.path === selectedWorkspace) || workspaces[0];

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
  }, [activeTab, optionsExpanded, actions.length, workflows.length, workspaces.length, isAddingManualFolder]);

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
      label: `Workspaces (${workspaces.length})`,
      icon: <FolderOpen size={15} />,
    },
  ];

  async function handleRunPrompt(queryToRun?: string) {
    const q = queryToRun || prompt;
    if (!q.trim()) return;
    setIsPlanning(true);
    setCurrentPlan(null);

    try {
      const res = await api.createPlan(q, selectedWorkspace || undefined);
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
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        color: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
        position: 'relative',
        userSelect: 'none',
        boxSizing: 'border-box',
        transition: 'height 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
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

      {/* 1. Top Status Banner Card with Quick Sort Button */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(0, 122, 255, 0.92) 0%, rgba(0, 96, 223, 0.92) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.25)',
          borderRadius: '16px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          animation: 'bannerShimmer 4s ease-in-out infinite',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <Sparkles size={16} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#ffffff', lineHeight: 1.2 }}>
              Idler Local AI
            </div>
            <div
              onClick={() => setActiveTab('workspaces')}
              title="Click to change or add active folder to scan"
              style={{
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.92)',
                marginTop: '2px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                textDecoration: 'underline dotted rgba(255,255,255,0.4)',
              }}
            >
              <span>{activeWsObj ? `${activeWsObj.name} • ${activeWsObj.files_count} files` : 'Ready to organize'}</span>
              <ChevronRight size={10} style={{ opacity: 0.85 }} />
            </div>
          </div>
        </div>

        <button
          className="quick-sort-btn"
          onClick={() => {
            setActiveTab('planner');
            handleRunPrompt('Organize all unorganized files by category');
          }}
          disabled={isPlanning}
          style={{
            background: '#ffffff',
            color: '#007aff',
            border: 'none',
            borderRadius: '16px',
            padding: '5px 14px',
            fontSize: '12px',
            fontWeight: '700',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
          }}
        >
          {isPlanning ? 'Thinking…' : 'Quick Sort'}
        </button>
      </div>

      {/* 2. Center Hero Mascot: Pure White & Cool Sloth with Ambient Breathing Glow */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 0 0px 0',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'slothFloat 3s ease-in-out infinite',
          }}
        >
          {/* Ambient Breathing Glow */}
          <div
            style={{
              position: 'absolute',
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%)',
              pointerEvents: 'none',
              animation: 'slothBreathingGlow 2.5s ease-in-out infinite',
            }}
          />
          <img
            src="./sloth.png"
            alt="Idler Cool Sloth"
            style={{
              width: '46px',
              height: '46px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 2px 10px rgba(255, 255, 255, 0.45)) drop-shadow(0 4px 16px rgba(0, 0, 0, 0.8))',
              transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      </div>

      {/* 3. Segmented Icon Tab Bar with Enhanced Animations */}
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
                        border: '1px solid rgba(37, 99, 235, 0.4)',
                        borderRadius: '8px',
                        padding: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: '600', color: '#60a5fa' }}>
                        Proposed {currentPlan.actions.length} Actions
                      </div>
                      <div style={{ fontSize: '10px', color: '#cbd5e1', maxHeight: '55px', overflowY: 'auto' }}>
                        {currentPlan.actions.map((act, i) => (
                          <div key={i}>• {act.type}: <span style={{ color: '#93c5fd' }}>{act.source.split('/').pop()}</span></div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                        <button
                          onClick={handleApproveAndExecute}
                          disabled={isExecuting}
                          style={{
                            flex: 1,
                            background: '#059669',
                            color: '#ffffff',
                            border: 'none',
                            padding: '5px',
                            borderRadius: '5px',
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
                            background: 'rgba(255, 255, 255, 0.1)',
                            color: '#cbd5e1',
                            border: 'none',
                            padding: '5px 8px',
                            borderRadius: '5px',
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
            <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between', padding: '0 2px' }}>
              <span>Recent File Actions</span>
              <span style={{ color: '#8a8790' }}>{actions.length} operations</span>
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
                    <div style={{ overflow: 'hidden', paddingRight: '8px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '600', color: '#f1f5f9' }}>
                        {act.action_type.toUpperCase()}
                      </div>
                      <div style={{ fontSize: '10px', color: '#8a8790', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {act.source?.split('/').pop() || 'file'}
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
                Select active directory to scan ({workspaces.length})
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
            <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {workspaces.map((ws) => {
                const isSel = ws.path === selectedWorkspace;
                return (
                  <div
                    key={ws.path}
                    onClick={() => {
                      onSelectWorkspace(ws.path);
                      addToast('info', `Active folder: ${ws.name}`);
                    }}
                    className="cozy-chip"
                    style={{
                      background: isSel ? 'rgba(37, 99, 235, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid ' + (isSel ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)'),
                      boxShadow: isSel ? '0 4px 14px rgba(37, 99, 235, 0.3)' : undefined,
                      borderRadius: '10px',
                      padding: '8px 10px',
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
                          width: '26px',
                          height: '26px',
                          borderRadius: '6px',
                          background: isSel ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <FolderOpen size={14} color={isSel ? '#ffffff' : '#94a3b8'} />
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
                );
              })}
            </div>
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
    </div>
  );
};
