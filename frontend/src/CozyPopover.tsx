import React, { useState } from 'react';
import {
  Sparkles,
  History,
  Search,
  Code2,
  FolderSync,
  FolderOpen,
  ArrowRight,
  Settings,
  Power,
  RotateCcw,
  Trash2,
  Play,
  ChevronDown,
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
  const [activeTab, setActiveTab] = useState<CozyTab>('planner');
  const [hoveredTab, setHoveredTab] = useState<CozyTab | null>(null);

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

  const activeWsObj = workspaces.find((w) => w.path === selectedWorkspace) || workspaces[0];

  // 8 Minimalist Chips in 2x4 grid (matching screenshot layout)
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
        return `LOCAL WORKSPACES (${workspaces.length})`;
    }
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '380px',
        margin: '0 auto',
        background: 'rgba(28, 25, 32, 0.96)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '22px',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(0,0,0,0.5)',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        color: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
        position: 'relative',
        userSelect: 'none',
        boxSizing: 'border-box',
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
          background: '#1c1920',
          borderTop: '1px solid rgba(255, 255, 255, 0.15)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.15)',
          zIndex: 2,
        }}
      />

      {/* Top Status Banner Card with Quick Sort Button */}
      <div
        style={{
          background: 'linear-gradient(135deg, #007aff 0%, #0060df 100%)',
          borderRadius: '14px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 4px 14px rgba(0, 122, 255, 0.35)',
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
            <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.85)', marginTop: '2px' }}>
              {activeWsObj ? `${activeWsObj.name} • ${activeWsObj.files_count} files` : 'Ready to organize'}
            </div>
          </div>
        </div>

        <button
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
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            transition: 'all 0.15s ease',
          }}
        >
          {isPlanning ? 'Thinking…' : 'Quick Sort'}
        </button>
      </div>

      {/* 1. Center Hero Mascot: Pure White & Cool Sloth (No Background) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 0 2px 0',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Subtle Soft Ambient Glow */}
          <div
            style={{
              position: 'absolute',
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255, 255, 255, 0.22) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <img
            src="./sloth.png"
            alt="Idler Cool Sloth"
            style={{
              width: '46px',
              height: '46px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 2px 8px rgba(255, 255, 255, 0.4)) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.7))',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      </div>

      {/* 2. Segmented Icon Tab Bar with Hover Labels */}
      <div
        onMouseLeave={() => setHoveredTab(null)}
        style={{
          background: '#252229',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
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
              title={tab.label}
              style={{
                flex: isHovered ? '1 1 auto' : hoveredTab ? '0 0 32px' : '1 1 0px',
                minWidth: '32px',
                maxWidth: isHovered ? '210px' : undefined,
                height: '32px',
                padding: isHovered ? '0 10px' : '0 6px',
                background: isActive ? '#2563eb' : isHovered ? 'rgba(255, 255, 255, 0.09)' : 'transparent',
                border: 'none',
                borderRadius: '8px',
                color: isActive ? '#ffffff' : isHovered ? '#ffffff' : '#8e8c95',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                position: 'relative',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
                    animation: 'popoverTextIn 0.18s ease-out forwards',
                  }}
                >
                  {tab.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 3. Section Label (Matching Screenshot "KEEP AWAKE") */}
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

      {/* 4. THE BOX (Unified Minimalist Card matching the screenshot) */}
      <div
        style={{
          background: '#252229',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxSizing: 'border-box',
        }}
      >
        {/* TAB 1: SCAN & PLAN (Default View) */}
        {activeTab === 'planner' && (
          <>
            {/* Row 1: The Mac follows its normal energy rules / Auto-sort */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: '500' }}>
                Auto-sort files by category
              </span>
              <div
                onClick={() => setAutoSortEnabled(!autoSortEnabled)}
                style={{
                  width: '42px',
                  height: '24px',
                  borderRadius: '12px',
                  background: autoSortEnabled ? '#e2e8f0' : '#38353d',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
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
                    transition: 'left 0.2s',
                  }}
                />
              </div>
            </div>

            {/* Row 2: 8 Chips in 2x4 Grid (Matching Screenshot Chips Layout) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {chipsRow1.map((chip) => {
                  const isSel = activeChip === chip.label;
                  return (
                    <button
                      key={chip.label}
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
                        background: isSel ? '#2563eb' : '#312e36',
                        border: '1px solid ' + (isSel ? '#3b82f6' : 'rgba(255, 255, 255, 0.06)'),
                        borderRadius: '8px',
                        padding: '7px 2px',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: isSel ? '#ffffff' : '#e2e8f0',
                        cursor: 'pointer',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        transition: 'all 0.15s ease',
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
                        background: isSel ? '#2563eb' : '#312e36',
                        border: '1px solid ' + (isSel ? '#3b82f6' : 'rgba(255, 255, 255, 0.06)'),
                        borderRadius: '8px',
                        padding: '7px 2px',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: isSel ? '#ffffff' : '#e2e8f0',
                        cursor: 'pointer',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row 3: Caption Text (Matching Screenshot) */}
            <div style={{ fontSize: '11px', color: '#8a8790' }}>
              Click a chip to start. Click it again to stop
            </div>

            {/* Row 4: Expandable Accordion (Matching Screenshot "> Options") */}
            <div>
              <button
                onClick={() => setOptionsExpanded(!optionsExpanded)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  color: '#cbd5e1',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {optionsExpanded ? <ChevronDown size={14} color="#94a3b8" /> : <ChevronRight size={14} color="#94a3b8" />}
                <span>Options & Natural Language</span>
              </button>

              {optionsExpanded && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: '#1a181e',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
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
                        background: prompt.trim() ? '#2563eb' : '#312e36',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: prompt.trim() ? 'pointer' : 'default',
                      }}
                    >
                      <ArrowRight size={12} />
                    </button>
                  </div>

                  {currentPlan && (
                    <div
                      style={{
                        background: '#16141a',
                        border: '1px solid #2563eb',
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
                            background: '#312e36',
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
                          background: soundMode === mode ? '#2563eb' : '#1a181e',
                          color: soundMode === mode ? '#ffffff' : '#8a8790',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        {mode === 'auto' ? 'Auto OS' : mode === 'mac' ? 'Mac Glass' : 'Win Triad'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Divider Line (Matching Screenshot) */}
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', margin: '2px 0' }} />

            {/* Row 5: Keep going with the lid closed / Audible Chime (Matching Screenshot) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                  background: soundMuted ? '#38353d' : '#e2e8f0',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
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
                    transition: 'left 0.2s',
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* TAB 2: ACTION LEDGER & UNDO */}
        {activeTab === 'ledger' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between' }}>
              <span>Recent File Actions</span>
              <span style={{ color: '#8a8790' }}>{actions.length} operations</span>
            </div>
            {actions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 10px', color: '#8a8790', fontSize: '12px' }}>
                No operations logged yet.
              </div>
            ) : (
              <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {actions.slice(0, 5).map((act) => (
                  <div
                    key={act.id}
                    style={{
                      background: '#312e36',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
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
                        style={{
                          background: '#252229',
                          color: '#93c5fd',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '4px',
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                {dupScan
                  ? `${dupScan.duplicate_groups.length} duplicate groups (${fmtBytes(dupScan.total_wasted_bytes)} wasted)`
                  : 'Scan for identical files using SHA-256'}
              </span>
              <button
                onClick={handleScanDuplicates}
                disabled={isScanningDups}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
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
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
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
            <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
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
                  background: '#1a181e',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '6px 8px',
                  fontSize: '11px',
                  color: '#ffffff',
                }}
              />
              <button
                onClick={handleInspectProject}
                disabled={isInspectingProj}
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
                  background: '#1a181e',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
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
            <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between' }}>
              <span>Recurring Workflows</span>
              <span style={{ color: '#8a8790' }}>{workflows.length} configured</span>
            </div>

            {workflows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 10px', color: '#8a8790', fontSize: '12px' }}>
                No saved workflows yet.
              </div>
            ) : (
              <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {workflows.map((wf) => (
                  <div
                    key={wf.id}
                    style={{
                      background: '#312e36',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '8px',
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
                        style={{
                          background: '#2563eb',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '4px',
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
                          background: wf.is_active ? '#10b981' : '#38353d',
                          position: 'relative',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
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
                            transition: 'left 0.2s',
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
            <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
              Switch active local directory:
            </div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {workspaces.map((ws) => {
                const isSel = ws.path === selectedWorkspace;
                return (
                  <button
                    key={ws.path}
                    onClick={() => onSelectWorkspace(ws.path)}
                    style={{
                      background: isSel ? '#2563eb' : '#312e36',
                      border: '1px solid ' + (isSel ? '#3b82f6' : 'rgba(255, 255, 255, 0.06)'),
                      borderRadius: '8px',
                      padding: '8px 10px',
                      color: isSel ? '#ffffff' : '#cbd5e1',
                      fontSize: '12px',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontWeight: isSel ? '700' : '500' }}>{ws.name}</span>
                    <span style={{ fontSize: '11px', opacity: 0.8 }}>{ws.files_count} files</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 5. Bottom Action Footer: Settings & Quit Buttons (Matching Screenshot) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginTop: '2px',
        }}
      >
        <button
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
            background: '#252229',
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
            transition: 'background 0.15s ease',
          }}
        >
          <Settings size={15} color="#8a8790" />
          <span>Settings</span>
        </button>

        <button
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
            background: '#252229',
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
            transition: 'background 0.15s ease',
          }}
        >
          <Power size={15} color="#8a8790" />
          <span>Quit</span>
        </button>
      </div>
    </div>
  );
};
