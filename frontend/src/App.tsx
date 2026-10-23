import React, { useState, useEffect } from 'react';
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
  Search
} from 'lucide-react';
import {
  PlanResponse,
  TaskExecutionSummary,
  ActionRecord,
  DuplicateScanResult,
  WorkflowItem
} from './types';
import * as api from './api';

export default function App() {
  const [tab, setTab] = useState<'planner' | 'ledger' | 'duplicates' | 'workflows'>('planner');
  const [health, setHealth] = useState<any>(null);
  
  // Planner State
  const [query, setQuery] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PlanResponse | null>(null);
  const [executionSummary, setExecutionSummary] = useState<TaskExecutionSummary | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Action Ledger State
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  // Duplicates State
  const [dupResult, setDupResult] = useState<DuplicateScanResult | null>(null);
  const [isScanningDups, setIsScanningDups] = useState(false);

  // Workflows State
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [wfName, setWfName] = useState('');
  const [wfQuery, setWfQuery] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [isRunningWf, setIsRunningWf] = useState<string | null>(null);

  useEffect(() => {
    loadHealth();
    loadActions();
    loadWorkflows();
  }, []);

  async function loadHealth() {
    try {
      const data = await api.fetchHealth();
      setHealth(data);
    } catch {
      // Backend not running yet or unreachable
    }
  }

  async function loadActions() {
    try {
      const data = await api.listActions(50);
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
      const plan = await api.createPlan(query);
      setCurrentPlan(plan);
    } catch (err: any) {
      setErrorMsg(err.message);
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
      loadActions();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsExecuting(false);
    }
  }

  async function handleUndo(actionId: string) {
    setUndoingId(actionId);
    setErrorMsg(null);
    try {
      await api.undoAction(actionId);
      await loadActions();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setUndoingId(null);
    }
  }

  async function handleScanDuplicates() {
    setIsScanningDups(true);
    setErrorMsg(null);
    try {
      const res = await api.scanDuplicates('.');
      setDupResult(res);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsScanningDups(false);
    }
  }

  async function handleCreateWorkflow(e: React.FormEvent) {
    e.preventDefault();
    if (!wfName.trim() || !wfQuery.trim()) return;
    try {
      await api.createWorkflow(wfName, wfQuery, wfDesc);
      setWfName('');
      setWfQuery('');
      setWfDesc('');
      await loadWorkflows();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  }

  async function handleRunWorkflow(id: string) {
    setIsRunningWf(id);
    setErrorMsg(null);
    try {
      const res = await api.runWorkflow(id);
      setExecutionSummary(res);
      setTab('planner');
      loadActions();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsRunningWf(null);
    }
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
        marginBottom: '28px'
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
              }}>v0.1.0 MVP</span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '14px' }}>
              Stop doing repetitive work. Let your local AI handle it safely.
            </p>
          </div>
        </div>

        {/* System Badges */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
            <span>Workspace Guard: <strong>Active</strong></span>
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
            color: '#a7f3d0'
          }}>
            <Database size={14} />
            <span>Model: <strong>{health?.ollama_model || 'Gemma Local'}</strong></span>
          </div>
        </div>
      </header>

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
        marginBottom: '28px'
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
          Agent Planner
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
      </nav>

      {/* TAB 1: AGENT PLANNER */}
      {tab === 'planner' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
          {/* Prompt Input Form */}
          <div style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '14px',
            padding: '24px'
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={18} color="#38bdf8" />
              What would you like Idler to do?
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '16px' }}>
              Describe your goal in plain English. The agent proposes a plan, you approve it, and changes can always be rolled back.
            </p>

            <form onSubmit={handleCreatePlan}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. Organize my PDFs and spreadsheets into separate folders, and find duplicates..."
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
                  {isPlanning ? 'Planning...' : 'Generate Plan'}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
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

                {currentPlan.actions.length > 0 && !executionSummary && (
                  <button
                    onClick={handleApproveAndExecute}
                    disabled={isExecuting}
                    style={{
                      padding: '12px 24px',
                      background: isExecuting ? '#475569' : '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: '600',
                      fontSize: '15px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                    }}
                  >
                    <CheckCircle2 size={18} />
                    {isExecuting ? 'Executing...' : 'Approve & Execute Plan'}
                  </button>
                )}
              </div>

              {/* Action items table */}
              <div style={{ overflowX: 'auto', marginTop: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                      <th style={{ padding: '10px 12px' }}>Action</th>
                      <th style={{ padding: '10px 12px' }}>Source File</th>
                      <th style={{ padding: '10px 12px' }}>Destination</th>
                      <th style={{ padding: '10px 12px' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPlan.actions.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                          No files needed moving. Workspace is clean!
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
                          <td style={{ padding: '12px', fontFamily: 'monospace', color: '#38bdf8' }}>{act.destination || '—'}</td>
                          <td style={{ padding: '12px', color: '#94a3b8' }}>{act.reason || '—'}</td>
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
                  Execution Complete — Status: {executionSummary.status}
                </h3>
              </div>
              <p style={{ color: '#a7f3d0', fontSize: '14px', marginBottom: '16px' }}>
                Completed: <strong>{executionSummary.completed_actions}</strong> | Failed: <strong>{executionSummary.failed_actions}</strong> | Skipped: <strong>{executionSummary.skipped_actions}</strong>
              </p>

              <div style={{ display: 'flex', gap: '8px' }}>
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
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ACTION LEDGER */}
      {tab === 'ledger' && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '14px', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Immutable Action Ledger</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px' }}>
                Full audit trail of all executed tasks and safe rollbacks.
              </p>
            </div>
            <button
              onClick={loadActions}
              style={{
                padding: '8px 14px',
                background: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '13px'
              }}
            >
              Refresh
            </button>
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
                {actions.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
                      No actions recorded yet. Run a plan to see history here!
                    </td>
                  </tr>
                ) : (
                  actions.map((act) => (
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
                            {undoingId === act.id ? 'Undoing...' : 'Undo'}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Cryptographic Duplicate Finder</h2>
              <p style={{ color: '#94a3b8', fontSize: '14px' }}>
                Pre-filters by file size, then computes SHA-256 hashes. Safe and strictly read-only: no files are deleted.
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
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
                marginBottom: '24px'
              }}>
                <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>Scanned Files</div>
                  <div style={{ fontSize: '24px', fontWeight: '700' }}>{dupResult.scanned_files}</div>
                </div>
                <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>Duplicate Sets</div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>
                    {dupResult.duplicate_groups.length}
                  </div>
                </div>
                <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>Potential Wasted Storage</div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#38bdf8' }}>
                    {(dupResult.total_wasted_bytes / 1024).toFixed(1)} KB
                  </div>
                </div>
              </div>

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
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
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
                            padding: '6px 10px',
                            background: '#0f172a',
                            borderRadius: '6px'
                          }}>
                            {p}
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
                    border: '1px solid #334155'
                  }}>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: '600', color: '#f8fafc' }}>{wf.name}</div>
                      <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '2px' }}>{wf.query}</div>
                      {wf.description && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{wf.description}</div>}
                    </div>

                    <button
                      onClick={() => handleRunWorkflow(wf.id)}
                      disabled={isRunningWf === wf.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '10px 18px',
                        background: isRunningWf === wf.id ? '#475569' : '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '13px'
                      }}
                    >
                      <Play size={14} />
                      {isRunningWf === wf.id ? 'Running...' : 'Run Now'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

