import React, { useState } from 'react';
import {
  ArrowRight,
  Settings,
  Power,
  RotateCcw,
  Trash2,
  Play
} from 'lucide-react';
import {
  PlanResponse,
  ActionRecord,
  WorkspaceItem,
  DuplicateScanResult,
} from './types';
import { SoundPlatform, playTaskCompleteChime, playMacChime, playWindowsChime } from './sound';
import * as api from './api';

interface CozyPopoverProps {
  workspaces: WorkspaceItem[];
  selectedWorkspace: string;
  onSelectWorkspace: (path: string) => void;
  actions: ActionRecord[];
  onRefreshActions: () => Promise<void>;
  onRefreshWorkspaces: () => Promise<void>;
  soundMode: SoundPlatform;
  onChangeSoundMode: (mode: SoundPlatform) => void;
  soundMuted: boolean;
  onToggleSoundMute: () => void;
  onOpenStudio?: () => void;
  onQuit?: () => void;
  addToast: (kind: 'success' | 'error' | 'info', message: string) => void;
}

type CozyTab = 'planner' | 'clean' | 'workspaces' | 'duplicates' | 'ledger' | 'sound';

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
  soundMode,
  onChangeSoundMode,
  soundMuted,
  onToggleSoundMute,
  onOpenStudio,
  onQuit,
  addToast,
}) => {
  const [activeTab, setActiveTab] = useState<CozyTab>('planner');
  const [prompt, setPrompt] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PlanResponse | null>(null);
  const [autoSortEnabled, setAutoSortEnabled] = useState(true);
  const [dupScan, setDupScan] = useState<DuplicateScanResult | null>(null);
  const [isScanningDups, setIsScanningDups] = useState(false);

  const activeWsObj = workspaces.find((w) => w.path === selectedWorkspace) || workspaces[0];

  // Quick Chips
  const quickChips = [
    { label: 'Downloads', query: 'Organize files in Downloads folder by category' },
    { label: 'Sort Images', query: 'Move all images into Images subfolder' },
    { label: 'Documents', query: 'Sort PDF, Word, and text files into Documents' },
    { label: 'Duplicates', action: 'duplicates' },
    { label: 'Clean Temp', query: 'Identify temporary and scratch files' },
    { label: 'Spreadsheets', query: 'Group Excel and CSV spreadsheets into Spreadsheets' },
  ];

  async function handleRunPrompt(queryToRun?: string) {
    const q = queryToRun || prompt;
    if (!q.trim()) return;
    setIsPlanning(true);
    setCurrentPlan(null);

    try {
      const res = await api.createPlan(q, selectedWorkspace || undefined);
      setCurrentPlan(res);
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

  return (
    <div style={{
      width: '100%',
      maxWidth: '380px',
      margin: '0 auto',
      background: 'rgba(23, 26, 35, 0.94)',
      backdropFilter: 'blur(36px) saturate(180%)',
      WebkitBackdropFilter: 'blur(36px) saturate(180%)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '22px',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0,0,0,0.5)',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      color: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      position: 'relative',
      userSelect: 'none',
      boxSizing: 'border-box',
    }}>
      {/* Top Anchor Notch pointing to menu bar */}
      <div style={{
        position: 'absolute',
        top: '-6px',
        left: '50%',
        transform: 'translateX(-50%) rotate(45deg)',
        width: '12px',
        height: '12px',
        background: '#171a23',
        borderTop: '1px solid rgba(255, 255, 255, 0.15)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.15)',
        zIndex: 2,
      }} />

      {/* 1. Top Status Banner Card (Matching Blue Card in Screenshot) */}
      <div style={{
        background: 'linear-gradient(135deg, #007aff 0%, #0060df 100%)',
        borderRadius: '14px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 4px 14px rgba(0, 122, 255, 0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '15px',
          }}>
            🦥
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
          onClick={() => handleRunPrompt('Organize all unorganized files by category')}
          disabled={isPlanning}
          style={{
            background: '#ffffff',
            color: '#007aff',
            border: 'none',
            borderRadius: '16px',
            padding: '5px 12px',
            fontSize: '12px',
            fontWeight: '700',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          }}
        >
          {isPlanning ? 'Thinking…' : 'Quick Sort'}
        </button>
      </div>

      {/* 2. Center Mascot Hero Icon */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 0',
      }}>
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* Subtle Ambient Halo */}
          <div style={{
            position: 'absolute',
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <img
            src="/sloth.png"
            alt="Idler Sloth Mascot"
            style={{
              width: '46px',
              height: '46px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      </div>

      {/* 3. Segmented Icon Tab Bar (Matching Horizontal Pill in Screenshot) */}
      <div style={{
        background: '#1d222e',
        border: '1px solid #283042',
        borderRadius: '12px',
        padding: '3px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '4px',
      }}>
        {[
          { id: 'planner', icon: '💤', label: 'Planner' },
          { id: 'clean', icon: '🧹', label: 'Clean' },
          { id: 'workspaces', icon: '🗂️', label: 'Spaces' },
          { id: 'duplicates', icon: '⚡', label: 'Duplicates' },
          { id: 'ledger', icon: '📜', label: 'History' },
          { id: 'sound', icon: soundMuted ? '🔇' : '🔔', label: 'Sound' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as CozyTab)}
              title={tab.label}
              style={{
                flex: 1,
                padding: '7px 0',
                background: isActive ? '#2563eb' : 'transparent',
                border: 'none',
                borderRadius: '8px',
                color: isActive ? '#ffffff' : '#8a99ad',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{tab.icon}</span>
            </button>
          );
        })}
      </div>

      {/* 4. Section Label */}
      <div style={{
        fontSize: '11px',
        fontWeight: '700',
        letterSpacing: '1px',
        color: '#64748b',
        textTransform: 'uppercase',
        paddingLeft: '2px',
      }}>
        {activeTab === 'planner' && 'LOCAL AI PLANNER'}
        {activeTab === 'clean' && 'QUICK HOUSEKEEPING'}
        {activeTab === 'workspaces' && 'ACTIVE WORKSPACE'}
        {activeTab === 'duplicates' && 'DUPLICATE CLEANER'}
        {activeTab === 'ledger' && 'RECENT ACTIONS & UNDO'}
        {activeTab === 'sound' && 'AUDIO CHIME SETTINGS'}
      </div>

      {/* 5. Main Card Container (Matching Rounded Box in Screenshot) */}
      <div style={{
        background: '#1d222e',
        border: '1px solid #2b3345',
        borderRadius: '16px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {activeTab === 'planner' && (
          <>
            {/* Toggle Row (Matching Screenshot Toggle) */}
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
                  background: autoSortEnabled ? '#e2e8f0' : '#334155',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: '2px',
                  left: autoSortEnabled ? '20px' : '2px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: autoSortEnabled ? '#0f172a' : '#94a3b8',
                  transition: 'left 0.2s',
                }} />
              </div>
            </div>

            {/* Chips Grid (Matching Screenshot 15m, 30m, 1h Chips) */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
            }}>
              {quickChips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => {
                    if (chip.action === 'duplicates') {
                      setActiveTab('duplicates');
                      handleScanDuplicates();
                    } else if (chip.query) {
                      setPrompt(chip.query);
                      handleRunPrompt(chip.query);
                    }
                  }}
                  style={{
                    background: '#272f40',
                    border: '1px solid #364157',
                    borderRadius: '8px',
                    padding: '8px 4px',
                    fontSize: '11px',
                    fontWeight: '600',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div style={{ fontSize: '11px', color: '#8896ab' }}>
              Click a chip to start. Natural language assistant below.
            </div>

            {/* Natural Language Prompt Input Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              background: '#131722',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '6px 10px',
              gap: '8px',
            }}>
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
                  fontSize: '12px',
                }}
              />
              <button
                onClick={() => handleRunPrompt()}
                disabled={isPlanning || !prompt.trim()}
                style={{
                  background: prompt.trim() ? '#2563eb' : '#334155',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  width: '26px',
                  height: '26px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: prompt.trim() ? 'pointer' : 'default',
                }}
              >
                <ArrowRight size={13} />
              </button>
            </div>

            {/* Plan Review Box (if generated) */}
            {currentPlan && (
              <div style={{
                background: '#131826',
                border: '1px solid #2563eb',
                borderRadius: '10px',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#60a5fa' }}>
                  ⚡ {currentPlan.actions.length} Actions Proposed
                </div>
                <div style={{ fontSize: '11px', color: '#cbd5e1', maxHeight: '60px', overflowY: 'auto' }}>
                  {currentPlan.actions.map((act, i) => (
                    <div key={i} style={{ marginBottom: '3px' }}>
                      • {act.type.replace('_', ' ')}: <span style={{ color: '#93c5fd' }}>{act.source.split('/').pop()}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
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
                      fontWeight: '700',
                      cursor: 'pointer',
                    }}
                  >
                    {isExecuting ? 'Running…' : 'Approve & Run'}
                  </button>
                  <button
                    onClick={() => setCurrentPlan(null)}
                    style={{
                      background: '#334155',
                      color: '#cbd5e1',
                      border: 'none',
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
          </>
        )}

        {activeTab === 'clean' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
              One-click cleanup presets for <strong>{activeWsObj?.name || 'Workspace'}</strong>:
            </div>
            {[
              { title: 'Sort Downloads by File Type', query: 'Organize all files in Downloads by file category' },
              { title: 'Consolidate Spreadsheets', query: 'Group Excel and CSV files into Spreadsheets folder' },
              { title: 'Archive Screenshots', query: 'Move all screenshots into Screenshots folder' },
              { title: 'Find & Trash Redundant Duplicates', action: 'trash-all' },
            ].map((preset, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (preset.action === 'trash-all') {
                    handleTrashAllDuplicates();
                  } else {
                    handleRunPrompt(preset.query);
                  }
                }}
                style={{
                  background: '#272f40',
                  border: '1px solid #364157',
                  borderRadius: '8px',
                  padding: '9px 12px',
                  color: '#f1f5f9',
                  fontSize: '12px',
                  fontWeight: '600',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span>{preset.title}</span>
                <Play size={12} color="#38bdf8" />
              </button>
            ))}
          </div>
        )}

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
                      background: isSel ? '#2563eb' : '#272f40',
                      border: '1px solid ' + (isSel ? '#3b82f6' : '#364157'),
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

        {activeTab === 'duplicates' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                {dupScan ? `${dupScan.duplicate_groups.length} groups (${fmtBytes(dupScan.total_wasted_bytes)})` : 'Scan for identical files'}
              </span>
              <button
                onClick={handleScanDuplicates}
                disabled={isScanningDups}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '4px 8px',
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
          </div>
        )}

        {activeTab === 'ledger' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between' }}>
              <span>Recent File Actions</span>
              <span style={{ color: '#94a3b8' }}>{actions.length} logged</span>
            </div>
            <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {actions.slice(0, 5).map((act) => (
                <div
                  key={act.id}
                  style={{
                    background: '#272f40',
                    border: '1px solid #364157',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ overflow: 'hidden', paddingRight: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#f1f5f9' }}>
                      {act.action_type}
                    </div>
                    <div style={{ fontSize: '10px', color: '#94a3b8', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {act.source?.split('/').pop() || 'file'}
                    </div>
                  </div>
                  {!act.is_undone && (
                    <button
                      onClick={() => handleUndo(act.id)}
                      style={{
                        background: '#334155',
                        color: '#93c5fd',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '3px 6px',
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
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'sound' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: '500' }}>
                Mute Audio Chimes
              </span>
              <div
                onClick={onToggleSoundMute}
                style={{
                  width: '42px',
                  height: '24px',
                  borderRadius: '12px',
                  background: soundMuted ? '#334155' : '#e2e8f0',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: '2px',
                  left: soundMuted ? '2px' : '20px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: soundMuted ? '#94a3b8' : '#0f172a',
                  transition: 'left 0.2s',
                }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              {(['auto', 'mac', 'win'] as SoundPlatform[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onChangeSoundMode(mode)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    fontSize: '11px',
                    fontWeight: '600',
                    background: soundMode === mode ? '#2563eb' : '#272f40',
                    color: soundMode === mode ? '#ffffff' : '#cbd5e1',
                    border: '1px solid #364157',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  {mode === 'auto' ? 'Auto (OS)' : mode === 'mac' ? '🍎 Mac' : '🪟 Win'}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => playMacChime()}
                style={{
                  flex: 1,
                  padding: '6px',
                  background: '#272f40',
                  color: '#93c5fd',
                  border: '1px solid #364157',
                  borderRadius: '6px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                🍎 Test Mac Glass
              </button>
              <button
                onClick={() => playWindowsChime()}
                style={{
                  flex: 1,
                  padding: '6px',
                  background: '#272f40',
                  color: '#93c5fd',
                  border: '1px solid #364157',
                  borderRadius: '6px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                🪟 Test Windows Triad
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 6. Second Option Card (Matching "Keep going with lid closed" in Screenshot) */}
      <div style={{
        background: '#1d222e',
        border: '1px solid #2b3345',
        borderRadius: '16px',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '500', color: '#f1f5f9' }}>
            Audible completion chime
          </div>
          <div style={{ fontSize: '11px', color: '#8896ab' }}>
            {soundMuted ? 'Muted' : soundMode === 'mac' ? 'macOS Glass harmonic sound' : soundMode === 'win' ? 'Windows ascending triad' : 'Auto-detected for your OS'}
          </div>
        </div>

        <div
          onClick={onToggleSoundMute}
          style={{
            width: '42px',
            height: '24px',
            borderRadius: '12px',
            background: soundMuted ? '#334155' : '#e2e8f0',
            position: 'relative',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          <div style={{
            position: 'absolute',
            top: '2px',
            left: soundMuted ? '2px' : '20px',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: soundMuted ? '#94a3b8' : '#0f172a',
            transition: 'left 0.2s',
          }} />
        </div>
      </div>

      {/* 7. Bottom Action Footer (Matching Settings & Quit Buttons in Screenshot) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        marginTop: '2px',
      }}>
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
            background: '#1d222e',
            border: '1px solid #2b3345',
            borderRadius: '12px',
            padding: '10px 14px',
            color: '#cbd5e1',
            fontSize: '13px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <Settings size={15} color="#94a3b8" />
          <span>Full Studio</span>
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
            background: '#1d222e',
            border: '1px solid #2b3345',
            borderRadius: '12px',
            padding: '10px 14px',
            color: '#cbd5e1',
            fontSize: '13px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <Power size={15} color="#ef4444" />
          <span>Quit</span>
        </button>
      </div>
    </div>
  );
};
