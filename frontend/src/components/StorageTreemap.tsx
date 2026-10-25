import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  HardDrive,
  PieChart,
  Cloud,
  Archive,
  Trash2,
  Folder,
  FileText,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronRight,
  Clock,
  Sparkles,
  Info,
  ArrowUpLeft,
  X,
} from 'lucide-react';
import {
  StorageAnalyticsResponse,
  StorageTreeNode,
  LargeForgottenFile,
  WorkspaceItem,
} from '../types';
import { getStorageAnalytics, archiveLargeFile, trashLargeFile } from '../api';

interface StorageTreemapProps {
  activeWorkspace?: WorkspaceItem | null;
  workspaces?: WorkspaceItem[];
  onSelectWorkspace?: (ws: WorkspaceItem) => void;
  onActionComplete?: (message: string) => void;
}

export const StorageTreemap: React.FC<StorageTreemapProps> = ({
  activeWorkspace,
  workspaces = [],
  onSelectWorkspace,
  onActionComplete,
}) => {
  const [data, setData] = useState<StorageAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & thresholds
  const [minSizeMB, setMinSizeMB] = useState<number>(500); // Default 500 MB
  const [forgottenDays, setForgottenDays] = useState<number>(180); // Default 6 months
  const [activeView, setActiveView] = useState<'treemap' | 'list'>('treemap');

  // Breadcrumb navigation for treemap zoom
  const [currentNodePath, setCurrentNodePath] = useState<string[]>([]);
  const [selectedFileForAction, setSelectedFileForAction] = useState<LargeForgottenFile | null>(null);
  const [actionType, setActionType] = useState<'archive' | 'trash' | null>(null);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);

  // Load analytics
  const loadAnalytics = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const bytes = minSizeMB * 1024 * 1024;
      const res = await getStorageAnalytics(activeWorkspace.path, '.', bytes, forgottenDays);
      setData(res);
      setCurrentNodePath([]);
    } catch (err: any) {
      setError(err?.message || 'Failed to scan storage');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, minSizeMB, forgottenDays]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Navigate Treemap current node based on breadcrumb path
  const currentNode = useMemo<StorageTreeNode | null>(() => {
    if (!data?.tree) return null;
    let curr = data.tree;
    for (const segment of currentNodePath) {
      const next = curr.children?.find((c) => c.name === segment);
      if (next) {
        curr = next;
      } else {
        break;
      }
    }
    return curr;
  }, [data, currentNodePath]);

  // Execute 1-click Archive
  const handleArchive = async (file: LargeForgottenFile) => {
    if (!activeWorkspace) return;
    setActionInProgress(true);
    try {
      const res = await archiveLargeFile(file.relative_path, activeWorkspace.path, 'Archive');
      setSelectedFileForAction(null);
      setActionType(null);
      if (onActionComplete) {
        onActionComplete(res.message || `Archived ${file.name}`);
      }
      await loadAnalytics();
    } catch (err: any) {
      alert(`Archival failed: ${err.message}`);
    } finally {
      setActionInProgress(false);
    }
  };

  // Execute 1-click Trash
  const handleTrash = async (file: LargeForgottenFile) => {
    if (!activeWorkspace) return;
    setActionInProgress(true);
    try {
      const res = await trashLargeFile(file.relative_path, activeWorkspace.path);
      setSelectedFileForAction(null);
      setActionType(null);
      if (onActionComplete) {
        onActionComplete(res.message || `Moved ${file.name} to Trash`);
      }
      await loadAnalytics();
    } catch (err: any) {
      alert(`Trashing failed: ${err.message}`);
    } finally {
      setActionInProgress(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', color: '#f8fafc' }}>
      {/* ── Top Control Bar ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '16px 20px',
          background: 'rgba(11, 17, 32, 0.75)',
          backdropFilter: 'blur(16px)',
          borderRadius: '14px',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.36)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(99, 102, 241, 0.25))',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              color: '#38bdf8',
            }}
          >
            <HardDrive size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', margin: 0, letterSpacing: '-0.02em', color: '#f8fafc' }}>
              Storage Analytics & Visual Insights
            </h2>
            <p style={{ fontSize: '13px', margin: '2px 0 0 0', color: '#94a3b8' }}>
              Treemap visualizer, large file hunter (&gt;{minSizeMB}MB, &gt;{forgottenDays}d), and cloud sync awareness.
            </p>
          </div>
        </div>

        {/* Filters & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Workspace selector if multiple */}
          {workspaces.length > 0 && onSelectWorkspace && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Workspace:</span>
              <select
                value={activeWorkspace?.path || ''}
                onChange={(e) => {
                  const ws = workspaces.find((w) => w.path === e.target.value);
                  if (ws) onSelectWorkspace(ws);
                }}
                style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '8px',
                  color: '#e2e8f0',
                  padding: '6px 10px',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.path} value={w.path}>
                    {w.name} ({w.files_count} files)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Size Threshold */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Min Size:</span>
            <select
              value={minSizeMB}
              onChange={(e) => setMinSizeMB(Number(e.target.value))}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '8px',
                color: '#38bdf8',
                fontWeight: '600',
                padding: '6px 10px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value={50}>&gt; 50 MB</option>
              <option value={100}>&gt; 100 MB</option>
              <option value={250}>&gt; 250 MB</option>
              <option value={500}>&gt; 500 MB (Default)</option>
              <option value={1024}>&gt; 1 GB</option>
              <option value={2048}>&gt; 2 GB</option>
            </select>
          </div>

          {/* Forgotten Threshold */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Inactive:</span>
            <select
              value={forgottenDays}
              onChange={(e) => setForgottenDays(Number(e.target.value))}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '8px',
                color: '#fbbf24',
                fontWeight: '600',
                padding: '6px 10px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value={30}>&gt; 30 Days</option>
              <option value={90}>&gt; 90 Days</option>
              <option value={180}>&gt; 180 Days (6 mos)</option>
              <option value={365}>&gt; 365 Days (1 yr)</option>
            </select>
          </div>

          {/* Rescan Button */}
          <button
            onClick={loadAnalytics}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(56, 189, 248, 0.1))',
              border: '1px solid #38bdf8',
              borderRadius: '8px',
              color: '#38bdf8',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin-clockwise' : ''} />
            {loading ? 'Analyzing…' : 'Rescan'}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '14px',
          }}
        >
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Key Metrics Cards ──────────────────────────────────────────── */}
      {data && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
          }}
        >
          {/* Total Space */}
          <div
            style={{
              padding: '16px 20px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '12px',
              border: '1px solid rgba(56, 189, 248, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '13px' }}>
              <span>Total Workspace Storage</span>
              <PieChart size={16} color="#38bdf8" />
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: '#f8fafc', marginTop: '8px', letterSpacing: '-0.02em' }}>
              {data.total_size_formatted}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              {data.total_files.toLocaleString()} files across {data.total_directories} directories
            </div>
          </div>

          {/* Large & Forgotten Files */}
          <div
            style={{
              padding: '16px 20px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '12px',
              border: data.large_forgotten_files.length > 0 ? '1px solid rgba(251, 191, 36, 0.3)' : '1px solid rgba(56, 189, 248, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '13px' }}>
              <span>Large &amp; Forgotten Files</span>
              <Clock size={16} color="#fbbf24" />
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: data.large_forgotten_files.length > 0 ? '#fbbf24' : '#f8fafc', marginTop: '8px' }}>
              {data.large_forgotten_files.length}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              &gt;{minSizeMB}MB &amp; unopened for &gt;{forgottenDays} days
            </div>
          </div>

          {/* Cloud Sync Awareness */}
          <div
            style={{
              padding: '16px 20px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '12px',
              border: '1px solid rgba(168, 85, 247, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '13px' }}>
              <span>Cloud Storage Awareness</span>
              <Cloud size={16} color="#c084fc" />
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: '#c084fc', marginTop: '8px' }}>
              {data.cloud_summary.space_saved_formatted} Saved
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              {data.cloud_summary.cloud_placeholder_count} cloud-only placeholders detected
            </div>
          </div>

          {/* Scan Performance */}
          <div
            style={{
              padding: '16px 20px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '12px',
              border: '1px solid rgba(56, 189, 248, 0.15)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#94a3b8', fontSize: '13px' }}>
              <span>Scan Performance</span>
              <Sparkles size={16} color="#34d399" />
            </div>
            <div style={{ fontSize: '26px', fontWeight: '800', color: '#34d399', marginTop: '8px' }}>
              {data.scan_duration_ms} ms
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              Native non-blocking filesystem walk
            </div>
          </div>
        </div>
      )}

      {/* ── Category Breakdown Horizontal Distribution Bar ─────────────── */}
      {data && data.category_breakdowns.length > 0 && (
        <div
          style={{
            padding: '20px',
            background: 'rgba(11, 17, 32, 0.75)',
            backdropFilter: 'blur(16px)',
            borderRadius: '14px',
            border: '1px solid rgba(56, 189, 248, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#e2e8f0', letterSpacing: '-0.01em' }}>
              Storage Breakdown by File Type
            </span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {data.category_breakdowns.length} active categories
            </span>
          </div>

          {/* Proportional Segmented Bar */}
          <div
            style={{
              display: 'flex',
              height: '14px',
              width: '100%',
              borderRadius: '7px',
              overflow: 'hidden',
              background: '#1e293b',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
            }}
          >
            {data.category_breakdowns.map((cat) => (
              <div
                key={cat.category}
                title={`${cat.category}: ${cat.formatted_size} (${cat.percentage}%)`}
                style={{
                  width: `${Math.max(cat.percentage, 0.5)}%`,
                  background: cat.color,
                  height: '100%',
                  transition: 'width 0.4s ease',
                }}
              />
            ))}
          </div>

          {/* Legend Pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
            {data.category_breakdowns.map((cat) => (
              <div
                key={cat.category}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: `1px solid ${cat.color}33`,
                  fontSize: '12px',
                }}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cat.color }} />
                <span style={{ fontWeight: '600', color: '#e2e8f0' }}>{cat.category}</span>
                <span style={{ color: '#94a3b8' }}>{cat.formatted_size}</span>
                <span style={{ color: '#64748b', fontSize: '11px' }}>({cat.percentage}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Disk Space Treemap Visualizer ─────────────────────────────────── */}
      {data && (
        <div
          style={{
            padding: '20px',
            background: 'rgba(11, 17, 32, 0.75)',
            backdropFilter: 'blur(16px)',
            borderRadius: '14px',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {/* Header & Breadcrumb Navigation */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setCurrentNodePath([])}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: currentNodePath.length === 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(30, 41, 59, 0.6)',
                  border: currentNodePath.length === 0 ? '1px solid #38bdf8' : '1px solid transparent',
                  color: currentNodePath.length === 0 ? '#38bdf8' : '#94a3b8',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <Folder size={14} />
                {data.tree.name || 'Workspace Root'}
              </button>

              {currentNodePath.map((segment, idx) => (
                <React.Fragment key={segment}>
                  <ChevronRight size={14} color="#64748b" />
                  <button
                    onClick={() => setCurrentNodePath(currentNodePath.slice(0, idx + 1))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      background: idx === currentNodePath.length - 1 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(30, 41, 59, 0.6)',
                      border: idx === currentNodePath.length - 1 ? '1px solid #38bdf8' : '1px solid transparent',
                      color: idx === currentNodePath.length - 1 ? '#38bdf8' : '#94a3b8',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              ))}

              {currentNodePath.length > 0 && (
                <button
                  onClick={() => setCurrentNodePath(currentNodePath.slice(0, -1))}
                  title="Go up one folder"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    background: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid #334155',
                    color: '#cbd5e1',
                    fontSize: '12px',
                    cursor: 'pointer',
                    marginLeft: '4px',
                  }}
                >
                  <ArrowUpLeft size={14} /> Up
                </button>
              )}
            </div>

            {/* View Mode Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', background: '#0f172a', borderRadius: '8px', padding: '3px', border: '1px solid #1e293b' }}>
              <button
                onClick={() => setActiveView('treemap')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeView === 'treemap' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: activeView === 'treemap' ? '#38bdf8' : '#64748b',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Treemap Grid
              </button>
              <button
                onClick={() => setActiveView('list')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeView === 'list' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: activeView === 'list' ? '#38bdf8' : '#64748b',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Hierarchy List
              </button>
            </div>
          </div>

          {/* Current Node Summary */}
          {currentNode && (
            <div style={{ fontSize: '13px', color: '#94a3b8', display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span>Total size in view: <strong style={{ color: '#38bdf8' }}>{currentNode.size_formatted}</strong></span>
              <span>•</span>
              <span>{currentNode.file_count} files</span>
              {currentNode.cloud_placeholders_count > 0 && (
                <>
                  <span>•</span>
                  <span style={{ color: '#c084fc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Cloud size={14} /> {currentNode.cloud_placeholders_count} cloud stubs
                  </span>
                </>
              )}
            </div>
          )}

          {/* Treemap Grid View */}
          {activeView === 'treemap' && currentNode && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '12px',
                minHeight: '260px',
              }}
            >
              {currentNode.children && currentNode.children.length > 0 ? (
                currentNode.children.map((item) => {
                  const pct = currentNode.size_bytes > 0 ? ((item.size_bytes / currentNode.size_bytes) * 100).toFixed(1) : '0';
                  return (
                    <div
                      key={item.name}
                      onClick={() => {
                        if (item.is_dir) {
                          setCurrentNodePath([...currentNodePath, item.name]);
                        }
                      }}
                      style={{
                        padding: '16px',
                        borderRadius: '10px',
                        background: item.is_dir
                          ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.6))'
                          : 'rgba(15, 23, 42, 0.6)',
                        border: item.is_dir ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(148, 163, 184, 0.15)',
                        cursor: item.is_dir ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px',
                        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                      onMouseEnter={(e) => {
                        if (item.is_dir) {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.borderColor = '#38bdf8';
                          e.currentTarget.style.boxShadow = '0 6px 20px rgba(56, 189, 248, 0.15)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (item.is_dir) {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.25)';
                          e.currentTarget.style.boxShadow = 'none';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {item.is_dir ? (
                            <Folder size={18} color="#38bdf8" />
                          ) : (
                            <FileText size={16} color="#94a3b8" />
                          )}
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: '600',
                              color: '#f1f5f9',
                              wordBreak: 'break-all',
                            }}
                          >
                            {item.name}
                          </span>
                        </div>
                        {item.cloud_placeholders_count > 0 && (
                          <span title="Contains cloud-only placeholder files" style={{ color: '#c084fc', flexShrink: 0 }}>
                            <Cloud size={14} />
                          </span>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: '18px', fontWeight: '700', color: '#38bdf8' }}>
                          {item.size_formatted}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          <span>{item.is_dir ? `${item.file_count} files` : item.category || 'File'}</span>
                          <span>{pct}% of folder</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ gridColumn: '1 / -1', padding: '36px', textAlign: 'center', color: '#64748b' }}>
                  No subdirectories or files in this folder.
                </div>
              )}
            </div>
          )}

          {/* List View */}
          {activeView === 'list' && currentNode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {currentNode.children && currentNode.children.length > 0 ? (
                currentNode.children.map((item) => (
                  <div
                    key={item.name}
                    onClick={() => {
                      if (item.is_dir) {
                        setCurrentNodePath([...currentNodePath, item.name]);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(56, 189, 248, 0.1)',
                      cursor: item.is_dir ? 'pointer' : 'default',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (item.is_dir) e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      if (item.is_dir) e.currentTarget.style.background = 'rgba(15, 23, 42, 0.6)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {item.is_dir ? <Folder size={16} color="#38bdf8" /> : <FileText size={16} color="#94a3b8" />}
                      <span style={{ fontSize: '13px', fontWeight: '500', color: '#f8fafc' }}>{item.name}</span>
                      {item.cloud_placeholders_count > 0 && (
                        <span style={{ fontSize: '11px', color: '#c084fc', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <Cloud size={12} /> {item.cloud_placeholders_count} cloud
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#38bdf8' }}>{item.size_formatted}</span>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>{item.is_dir ? `${item.file_count} files` : ''}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  No items in this directory.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── "Large & Forgotten Files" Hunter ───────────────────────────── */}
      {data && (
        <div
          style={{
            padding: '20px',
            background: 'rgba(11, 17, 32, 0.75)',
            backdropFilter: 'blur(16px)',
            borderRadius: '14px',
            border: '1px solid rgba(251, 191, 36, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'rgba(251, 191, 36, 0.15)',
                  color: '#fbbf24',
                }}
              >
                <Clock size={18} />
              </div>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '700', margin: 0, color: '#f8fafc' }}>
                  "Large &amp; Forgotten Files" Hunter
                </h3>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Identifies very large files (&gt;{minSizeMB} MB) unopened for &gt;{forgottenDays} days with safe 1-click archival or trashing
                </span>
              </div>
            </div>

            <span
              style={{
                fontSize: '12px',
                fontWeight: '600',
                padding: '4px 10px',
                borderRadius: '6px',
                background: data.large_forgotten_files.length > 0 ? 'rgba(251, 191, 36, 0.15)' : 'rgba(52, 211, 153, 0.15)',
                color: data.large_forgotten_files.length > 0 ? '#fbbf24' : '#34d399',
                border: data.large_forgotten_files.length > 0 ? '1px solid rgba(251, 191, 36, 0.3)' : '1px solid rgba(52, 211, 153, 0.3)',
              }}
            >
              {data.large_forgotten_files.length} candidate(s) detected
            </span>
          </div>

          {data.large_forgotten_files.length === 0 ? (
            <div
              style={{
                padding: '32px',
                textAlign: 'center',
                background: 'rgba(15, 23, 42, 0.5)',
                borderRadius: '10px',
                border: '1px dashed rgba(56, 189, 248, 0.2)',
                color: '#94a3b8',
              }}
            >
              <CheckCircle2 size={32} color="#34d399" style={{ margin: '0 auto 8px auto' }} />
              <div style={{ fontWeight: '600', color: '#e2e8f0', fontSize: '14px' }}>
                No large forgotten files found
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                No files exceeding {minSizeMB} MB have been inactive for more than {forgottenDays} days in this workspace.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.large_forgotten_files.map((file) => (
                <div
                  key={file.relative_path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '14px 18px',
                    borderRadius: '10px',
                    background: 'rgba(15, 23, 42, 0.75)',
                    border: '1px solid rgba(251, 191, 36, 0.2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '260px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        background: 'rgba(251, 191, 36, 0.1)',
                        color: '#fbbf24',
                        flexShrink: 0,
                      }}
                    >
                      <FileText size={18} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                      <span style={{ fontSize: '14px', fontWeight: '600', color: '#f8fafc', wordBreak: 'break-all' }}>
                        {file.name}
                      </span>
                      <span style={{ fontSize: '12px', color: '#64748b', wordBreak: 'break-all' }}>
                        {file.relative_path}
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: '600',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'rgba(251, 191, 36, 0.15)',
                            color: '#fbbf24',
                          }}
                        >
                          Inactive for {file.days_inactive} days (since {file.last_modified_formatted})
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: file.cloud_info.is_cloud_placeholder
                              ? 'rgba(168, 85, 247, 0.2)'
                              : 'rgba(56, 189, 248, 0.15)',
                            color: file.cloud_info.is_cloud_placeholder ? '#c084fc' : '#38bdf8',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {file.cloud_info.is_cloud_placeholder ? (
                            <>
                              <Cloud size={12} /> Cloud-only ({file.cloud_info.cloud_provider || 'Cloud'})
                            </>
                          ) : (
                            <>
                              <HardDrive size={12} /> Local Copy
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Size and Action Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '16px', fontWeight: '800', color: '#fbbf24' }}>
                        {file.size_formatted}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{file.category}</div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Archive Button */}
                      <button
                        onClick={() => {
                          setSelectedFileForAction(file);
                          setActionType('archive');
                        }}
                        disabled={actionInProgress}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '7px 12px',
                          borderRadius: '8px',
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          color: '#38bdf8',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        title="Safely move to Archive/ folder with instant undo support"
                      >
                        <Archive size={14} />
                        Archive
                      </button>

                      {/* Trash Button */}
                      <button
                        onClick={() => {
                          setSelectedFileForAction(file);
                          setActionType('trash');
                        }}
                        disabled={actionInProgress}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '7px 12px',
                          borderRadius: '8px',
                          background: 'rgba(244, 63, 94, 0.12)',
                          border: '1px solid rgba(244, 63, 94, 0.3)',
                          color: '#fb7185',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        title="Move to macOS / Windows Trash safely via send2trash (recoverable)"
                      >
                        <Trash2 size={14} />
                        Trash
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Cloud Storage Sync Awareness Section ───────────────────────── */}
      {data && (
        <div
          style={{
            padding: '20px',
            background: 'rgba(11, 17, 32, 0.75)',
            backdropFilter: 'blur(16px)',
            borderRadius: '14px',
            border: '1px solid rgba(168, 85, 247, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#c084fc',
              }}
            >
              <Cloud size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '700', margin: 0, color: '#f8fafc' }}>
                Cloud Storage Sync Awareness
              </h3>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Detects whether files in Google Drive, iCloud, OneDrive, or Dropbox are cloud-only placeholders or local copies to avoid accidental cloud re-downloads.
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
            }}
          >
            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Total Cloud Files Scanned</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#f8fafc', marginTop: '4px' }}>
                {data.cloud_summary.total_cloud_files}
              </div>
            </div>

            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Cloud-Only (Dataless) Placeholders</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#c084fc', marginTop: '4px' }}>
                {data.cloud_summary.cloud_placeholder_count}
              </div>
            </div>

            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Fully Synced Local Copies</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#38bdf8', marginTop: '4px' }}>
                {data.cloud_summary.local_copy_count}
              </div>
            </div>

            <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Local Disk Space Saved</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#34d399', marginTop: '4px' }}>
                {data.cloud_summary.space_saved_formatted}
              </div>
            </div>
          </div>

          {/* Providers Pill Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Detected Cloud Services:</span>
            {data.cloud_summary.providers_detected.length > 0 ? (
              data.cloud_summary.providers_detected.map((p) => (
                <span
                  key={p}
                  style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: 'rgba(168, 85, 247, 0.15)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    color: '#c084fc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Cloud size={12} /> {p}
                </span>
              ))
            ) : (
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Workspace is located on local drive (no external cloud sync folders detected)
              </span>
            )}
          </div>

          {/* Safe Guard Info Notice */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              color: '#93c5fd',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}
          >
            <Info size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              <strong>Smart Cloud Safety Guard:</strong> Cloud-only placeholder files (e.g. iCloud stubs, Google Drive shortcuts, and OneDrive/Dropbox online-only pointers) consume 0 local physical blocks. Idler inspects them without triggering automatic data hydration, preventing unwanted bandwidth consumption or cellular meter overages.
            </span>
          </div>
        </div>
      )}

      {/* ── Confirmation Modal for 1-Click Action ──────────────────────── */}
      {selectedFileForAction && actionType && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div
            style={{
              width: '90%',
              maxWidth: '460px',
              background: '#0b1120',
              border: actionType === 'trash' ? '1px solid rgba(244, 63, 94, 0.4)' : '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: actionType === 'trash' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                    color: actionType === 'trash' ? '#fb7185' : '#38bdf8',
                  }}
                >
                  {actionType === 'trash' ? <Trash2 size={20} /> : <Archive size={20} />}
                </div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#f8fafc' }}>
                  {actionType === 'trash' ? 'Move to Trash' : 'Archive Large File'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setSelectedFileForAction(null);
                  setActionType(null);
                }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '14px', color: '#cbd5e1', lineHeight: '1.5' }}>
              {actionType === 'trash' ? (
                <>
                  Are you sure you want to move <strong style={{ color: '#f8fafc' }}>{selectedFileForAction.name}</strong> ({selectedFileForAction.size_formatted}) to your computer's Trash?
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                    This operation uses system Trash (<code>send2trash</code>) and is fully recoverable anytime.
                  </div>
                </>
              ) : (
                <>
                  Move <strong style={{ color: '#f8fafc' }}>{selectedFileForAction.name}</strong> ({selectedFileForAction.size_formatted}) to the <code style={{ color: '#38bdf8' }}>Archive/</code> folder?
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                    This action will be recorded in the Action Ledger and can be instantly undone with 1-click.
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                onClick={() => {
                  setSelectedFileForAction(null);
                  setActionType(null);
                }}
                disabled={actionInProgress}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid #334155',
                  color: '#94a3b8',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  if (actionType === 'trash') {
                    handleTrash(selectedFileForAction);
                  } else {
                    handleArchive(selectedFileForAction);
                  }
                }}
                disabled={actionInProgress}
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  background: actionType === 'trash'
                    ? 'linear-gradient(135deg, #e11d48, #be123c)'
                    : 'linear-gradient(135deg, #0284c7, #0369a1)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: actionInProgress ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {actionInProgress ? (
                  <RefreshCw size={14} className="spin-clockwise" />
                ) : actionType === 'trash' ? (
                  <Trash2 size={14} />
                ) : (
                  <Archive size={14} />
                )}
                {actionInProgress ? 'Processing…' : actionType === 'trash' ? 'Move to Trash' : 'Archive File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
