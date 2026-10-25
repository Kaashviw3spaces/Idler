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
  ArrowUpLeft,
  X,
  Eye,
  Image as ImageIcon,
  FileCode,
} from 'lucide-react';
import {
  StorageAnalyticsResponse,
  StorageTreeNode,
  LargeForgottenFile,
  WorkspaceItem,
} from '../types';
import {
  getStorageAnalytics,
  archiveLargeFile,
  trashLargeFile,
  getFilePreviewUrl,
  fetchFileTextPreview,
} from '../api';

interface StorageTreemapProps {
  activeWorkspace?: WorkspaceItem | null;
  workspaces?: WorkspaceItem[];
  onSelectWorkspace?: (ws: WorkspaceItem) => void;
  onActionComplete?: (message: string) => void;
  compact?: boolean;
}

type SubSection = 'treemap' | 'large' | 'cloud' | 'categories';

function isImageFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext);
}

function isTextFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return ['.txt', '.md', '.py', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.yaml', '.yml', '.sh', '.rs', '.go', '.csv', '.toml', '.log'].includes(ext);
}

export const StorageTreemap: React.FC<StorageTreemapProps> = ({
  activeWorkspace,
  workspaces = [],
  onSelectWorkspace,
  onActionComplete,
  compact = false,
}) => {
  const [data, setData] = useState<StorageAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & thresholds
  const [minSizeMB, setMinSizeMB] = useState<number>(500); // Default 500 MB
  const [forgottenDays, setForgottenDays] = useState<number>(180); // Default 6 months
  const [activeSection, setActiveSection] = useState<SubSection>('treemap');
  const [treeViewMode, setTreeViewMode] = useState<'grid' | 'list'>('grid');

  // Breadcrumb navigation for treemap zoom
  const [currentNodePath, setCurrentNodePath] = useState<string[]>([]);
  const [selectedFileForAction, setSelectedFileForAction] = useState<LargeForgottenFile | null>(null);
  const [actionType, setActionType] = useState<'archive' | 'trash' | null>(null);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);

  // Quick Look File Preview Modal State
  const [quickLookFile, setQuickLookFile] = useState<{
    relative_path: string;
    name: string;
    size_formatted?: string;
    category?: string;
    days_inactive?: number;
    cloud_info?: any;
  } | null>(null);
  const [previewTextContent, setPreviewTextContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

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

  // Fetch text preview when a text/code file is opened in Quick Look
  useEffect(() => {
    if (!quickLookFile) {
      setPreviewTextContent(null);
      return;
    }
    if (isTextFile(quickLookFile.name)) {
      setPreviewLoading(true);
      fetchFileTextPreview(quickLookFile.relative_path, activeWorkspace?.path)
        .then((res) => setPreviewTextContent(res.content))
        .catch(() => setPreviewTextContent('(Could not load text preview)'))
        .finally(() => setPreviewLoading(false));
    } else {
      setPreviewTextContent(null);
    }
  }, [quickLookFile, activeWorkspace]);

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '12px' : '16px',
        width: '100%',
        color: '#f8fafc',
      }}
    >
      {/* ── Concise Control Bar ────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: compact ? '10px 14px' : '12px 18px',
          background: 'rgba(11, 17, 32, 0.75)',
          backdropFilter: 'blur(16px)',
          borderRadius: '12px',
          border: '1px solid rgba(56, 189, 248, 0.2)',
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
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
            }}
          >
            <HardDrive size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15px', fontWeight: '700', color: '#f8fafc' }}>
                Storage Analytics
              </span>
              {data && (
                <span
                  style={{
                    fontSize: '11px',
                    color: '#34d399',
                    background: 'rgba(52, 211, 153, 0.1)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    border: '1px solid rgba(52, 211, 153, 0.2)',
                  }}
                >
                  {data.scan_duration_ms}ms
                </span>
              )}
            </div>
            {activeWorkspace && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                {activeWorkspace.name} ({activeWorkspace.files_count} files)
              </span>
            )}
          </div>
        </div>

        {/* Concise Filter Controls */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          {workspaces.length > 1 && onSelectWorkspace && (
            <select
              value={activeWorkspace?.path || ''}
              onChange={(e) => {
                const ws = workspaces.find((w) => w.path === e.target.value);
                if (ws) onSelectWorkspace(ws);
              }}
              style={{
                background: '#0f172a',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '6px',
                color: '#e2e8f0',
                padding: '4px 8px',
                fontSize: '12px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {workspaces.map((w) => (
                <option key={w.path} value={w.path}>
                  {w.name}
                </option>
              ))}
            </select>
          )}

          {/* Min Size */}
          <select
            value={minSizeMB}
            onChange={(e) => setMinSizeMB(Number(e.target.value))}
            title="Large file threshold"
            style={{
              background: '#0f172a',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '6px',
              color: '#38bdf8',
              fontWeight: '600',
              padding: '4px 8px',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value={50}>&gt; 50 MB</option>
            <option value={100}>&gt; 100 MB</option>
            <option value={250}>&gt; 250 MB</option>
            <option value={500}>&gt; 500 MB</option>
            <option value={1024}>&gt; 1 GB</option>
            <option value={2048}>&gt; 2 GB</option>
          </select>

          {/* Forgotten Days */}
          <select
            value={forgottenDays}
            onChange={(e) => setForgottenDays(Number(e.target.value))}
            title="Inactivity period"
            style={{
              background: '#0f172a',
              border: '1px solid rgba(251, 191, 36, 0.25)',
              borderRadius: '6px',
              color: '#fbbf24',
              fontWeight: '600',
              padding: '4px 8px',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value={30}>&gt; 30 days</option>
            <option value={90}>&gt; 90 days</option>
            <option value={180}>&gt; 180 days (6 mo)</option>
            <option value={365}>&gt; 1 year</option>
          </select>

          {/* Rescan */}
          <button
            onClick={loadAnalytics}
            disabled={loading}
            title="Rescan storage"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid #38bdf8',
              borderRadius: '6px',
              color: '#38bdf8',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={13} className={loading ? 'spin-clockwise' : ''} />
            {loading ? '…' : 'Rescan'}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
          }}
        >
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Concise 4-Metric Summary Strip ────────────────────────────── */}
      {data && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '8px',
          }}
        >
          {/* Storage */}
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '10px',
              border: '1px solid rgba(56, 189, 248, 0.15)',
            }}
          >
            <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <HardDrive size={12} color="#38bdf8" /> Storage
            </div>
            <div style={{ fontSize: '17px', fontWeight: '800', color: '#f8fafc', marginTop: '3px' }}>
              {data.total_size_formatted}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>{data.total_files} files</div>
          </div>

          {/* Large & Forgotten */}
          <div
            onClick={() => setActiveSection('large')}
            style={{
              padding: '10px 14px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '10px',
              border: data.large_forgotten_files.length > 0 ? '1px solid rgba(251, 191, 36, 0.3)' : '1px solid rgba(56, 189, 248, 0.15)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} color="#fbbf24" /> Forgotten (&gt;{minSizeMB}MB)
            </div>
            <div style={{ fontSize: '17px', fontWeight: '800', color: data.large_forgotten_files.length > 0 ? '#fbbf24' : '#f8fafc', marginTop: '3px' }}>
              {data.large_forgotten_files.length} {data.large_forgotten_files.length === 1 ? 'file' : 'files'}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>&gt;{forgottenDays}d inactive</div>
          </div>

          {/* Cloud Sync */}
          <div
            onClick={() => setActiveSection('cloud')}
            style={{
              padding: '10px 14px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '10px',
              border: '1px solid rgba(168, 85, 247, 0.2)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Cloud size={12} color="#c084fc" /> Cloud Saved
            </div>
            <div style={{ fontSize: '17px', fontWeight: '800', color: '#c084fc', marginTop: '3px' }}>
              {data.cloud_summary.space_saved_formatted}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{data.cloud_summary.cloud_placeholder_count} cloud stubs</div>
          </div>

          {/* Breakdown / Categories */}
          <div
            onClick={() => setActiveSection('categories')}
            style={{
              padding: '10px 14px',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '10px',
              border: '1px solid rgba(56, 189, 248, 0.15)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <PieChart size={12} color="#34d399" /> Categories
            </div>
            <div style={{ fontSize: '17px', fontWeight: '800', color: '#34d399', marginTop: '3px' }}>
              {data.category_breakdowns.length} Types
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>Click to inspect</div>
          </div>
        </div>
      )}

      {/* ── Compact Category Distribution Bar ─────────────────────────── */}
      {data && data.category_breakdowns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div
            style={{
              display: 'flex',
              height: '8px',
              width: '100%',
              borderRadius: '4px',
              overflow: 'hidden',
              background: '#1e293b',
            }}
          >
            {data.category_breakdowns.map((cat) => (
              <div
                key={cat.category}
                title={`${cat.category}: ${cat.formatted_size} (${cat.percentage}%)`}
                style={{
                  width: `${Math.max(cat.percentage, 0.8)}%`,
                  background: cat.color,
                  height: '100%',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {data.category_breakdowns.slice(0, 6).map((cat) => (
              <span
                key={cat.category}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  color: '#cbd5e1',
                  background: 'rgba(15, 23, 42, 0.5)',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  border: `1px solid ${cat.color}33`,
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: cat.color }} />
                <span>{cat.category}</span>
                <span style={{ color: '#94a3b8' }}>{cat.formatted_size}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Concise Sub-Section Tabs ──────────────────────────────────── */}
      {data && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderBottom: '1px solid #1e293b',
            paddingBottom: '8px',
            overflowX: 'auto',
          }}
        >
          <button
            onClick={() => setActiveSection('treemap')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: activeSection === 'treemap' ? '1px solid #38bdf8' : '1px solid transparent',
              background: activeSection === 'treemap' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color: activeSection === 'treemap' ? '#38bdf8' : '#94a3b8',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <Folder size={14} />
            Treemap &amp; Folders
          </button>

          <button
            onClick={() => setActiveSection('large')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: activeSection === 'large' ? '1px solid #fbbf24' : '1px solid transparent',
              background: activeSection === 'large' ? 'rgba(251, 191, 36, 0.15)' : 'transparent',
              color: activeSection === 'large' ? '#fbbf24' : '#94a3b8',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <Clock size={14} />
            Large &amp; Forgotten ({data.large_forgotten_files.length})
          </button>

          <button
            onClick={() => setActiveSection('cloud')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: activeSection === 'cloud' ? '1px solid #c084fc' : '1px solid transparent',
              background: activeSection === 'cloud' ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
              color: activeSection === 'cloud' ? '#c084fc' : '#94a3b8',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <Cloud size={14} />
            Cloud Sync ({data.cloud_summary.cloud_placeholder_count})
          </button>

          <button
            onClick={() => setActiveSection('categories')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: activeSection === 'categories' ? '1px solid #34d399' : '1px solid transparent',
              background: activeSection === 'categories' ? 'rgba(52, 211, 153, 0.15)' : 'transparent',
              color: activeSection === 'categories' ? '#34d399' : '#94a3b8',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <PieChart size={14} />
            Categories ({data.category_breakdowns.length})
          </button>
        </div>
      )}

      {/* ── SUB-SECTION 1: Treemap & Folders ──────────────────────────── */}
      {data && activeSection === 'treemap' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Breadcrumbs & View Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setCurrentNodePath([])}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: currentNodePath.length === 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.6)',
                  border: currentNodePath.length === 0 ? '1px solid #38bdf8' : '1px solid transparent',
                  color: currentNodePath.length === 0 ? '#38bdf8' : '#94a3b8',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <Folder size={12} />
                {data.tree.name || 'Root'}
              </button>

              {currentNodePath.map((seg, idx) => (
                <React.Fragment key={seg}>
                  <ChevronRight size={12} color="#64748b" />
                  <button
                    onClick={() => setCurrentNodePath(currentNodePath.slice(0, idx + 1))}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      background: idx === currentNodePath.length - 1 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(30, 41, 59, 0.6)',
                      border: idx === currentNodePath.length - 1 ? '1px solid #38bdf8' : '1px solid transparent',
                      color: idx === currentNodePath.length - 1 ? '#38bdf8' : '#94a3b8',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {seg}
                  </button>
                </React.Fragment>
              ))}

              {currentNodePath.length > 0 && (
                <button
                  onClick={() => setCurrentNodePath(currentNodePath.slice(0, -1))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '3px 7px',
                    borderRadius: '5px',
                    background: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid #334155',
                    color: '#cbd5e1',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  <ArrowUpLeft size={12} /> Up
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', background: '#0f172a', borderRadius: '6px', padding: '2px', border: '1px solid #1e293b' }}>
              <button
                onClick={() => setTreeViewMode('grid')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: treeViewMode === 'grid' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: treeViewMode === 'grid' ? '#38bdf8' : '#64748b',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Grid
              </button>
              <button
                onClick={() => setTreeViewMode('list')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: treeViewMode === 'list' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: treeViewMode === 'list' ? '#38bdf8' : '#64748b',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                List
              </button>
            </div>
          </div>

          {/* Current Node Items */}
          {currentNode && treeViewMode === 'grid' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: compact
                  ? 'repeat(auto-fill, minmax(130px, 1fr))'
                  : 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '8px',
              }}
            >
              {currentNode.children && currentNode.children.length > 0 ? (
                currentNode.children.map((item) => {
                  const pct = currentNode.size_bytes > 0 ? ((item.size_bytes / currentNode.size_bytes) * 100).toFixed(1) : '0';
                  const isImg = !item.is_dir && isImageFile(item.name);
                  return (
                    <div
                      key={item.name}
                      onClick={() => {
                        if (item.is_dir) {
                          setCurrentNodePath([...currentNodePath, item.name]);
                        } else {
                          setQuickLookFile({
                            relative_path: item.relative_path,
                            name: item.name,
                            size_formatted: item.size_formatted,
                            category: item.category || 'File',
                          });
                        }
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: item.is_dir ? 'rgba(15, 23, 42, 0.85)' : 'rgba(15, 23, 42, 0.5)',
                        border: item.is_dir ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(148, 163, 184, 0.1)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '8px',
                        transition: 'transform 0.15s ease',
                      }}
                    >
                      {/* If leaf image file, render thumbnail preview banner */}
                      {isImg && (
                        <div
                          style={{
                            width: '100%',
                            height: '65px',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            background: '#040711',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: '1px solid rgba(56, 189, 248, 0.15)',
                          }}
                        >
                          <img
                            src={getFilePreviewUrl(item.relative_path, activeWorkspace?.path)}
                            alt={item.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                          {item.is_dir ? (
                            <Folder size={15} color="#38bdf8" />
                          ) : isImg ? (
                            <ImageIcon size={14} color="#f472b6" />
                          ) : isTextFile(item.name) ? (
                            <FileCode size={14} color="#38bdf8" />
                          ) : (
                            <FileText size={14} color="#94a3b8" />
                          )}
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#f1f5f9',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {item.name}
                          </span>
                        </div>
                        {item.cloud_placeholders_count > 0 && (
                          <span title="Cloud placeholder" style={{ color: '#c084fc', flexShrink: 0 }}>
                            <Cloud size={12} />
                          </span>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: '15px', fontWeight: '700', color: '#38bdf8' }}>
                          {item.size_formatted}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                          <span>{item.is_dir ? `${item.file_count} files` : item.category || 'File'}</span>
                          <span>{pct}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ gridColumn: '1 / -1', padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                  No subdirectories or files in this directory.
                </div>
              )}
            </div>
          )}

          {/* List View */}
          {currentNode && treeViewMode === 'list' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {currentNode.children && currentNode.children.length > 0 ? (
                currentNode.children.map((item) => {
                  const isImg = !item.is_dir && isImageFile(item.name);
                  return (
                    <div
                      key={item.name}
                      onClick={() => {
                        if (item.is_dir) {
                          setCurrentNodePath([...currentNodePath, item.name]);
                        } else {
                          setQuickLookFile({
                            relative_path: item.relative_path,
                            name: item.name,
                            size_formatted: item.size_formatted,
                            category: item.category || 'File',
                          });
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(56, 189, 248, 0.1)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                        {/* Thumbnail or icon */}
                        {isImg ? (
                          <div
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              background: '#000',
                              flexShrink: 0,
                            }}
                          >
                            <img
                              src={getFilePreviewUrl(item.relative_path, activeWorkspace?.path)}
                              alt={item.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                        ) : item.is_dir ? (
                          <Folder size={14} color="#38bdf8" />
                        ) : isTextFile(item.name) ? (
                          <FileCode size={14} color="#38bdf8" />
                        ) : (
                          <FileText size={14} color="#94a3b8" />
                        )}
                        <span style={{ fontSize: '12px', fontWeight: '500', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.name}
                        </span>
                        {item.cloud_placeholders_count > 0 && (
                          <span style={{ fontSize: '10px', color: '#c084fc', display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <Cloud size={10} /> {item.cloud_placeholders_count}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#38bdf8' }}>{item.size_formatted}</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>{item.is_dir ? `${item.file_count} f` : ''}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                  No items in this directory.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SUB-SECTION 2: Large & Forgotten Files ────────────────────── */}
      {data && activeSection === 'large' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {data.large_forgotten_files.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                background: 'rgba(15, 23, 42, 0.5)',
                borderRadius: '8px',
                border: '1px dashed rgba(56, 189, 248, 0.2)',
                color: '#94a3b8',
              }}
            >
              <CheckCircle2 size={24} color="#34d399" style={{ margin: '0 auto 6px auto' }} />
              <div style={{ fontWeight: '600', color: '#e2e8f0', fontSize: '13px' }}>
                No large forgotten files found
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                No files &gt;{minSizeMB}MB inactive for &gt;{forgottenDays} days in this workspace.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {data.large_forgotten_files.map((file) => {
                const isImg = isImageFile(file.name);
                return (
                  <div
                    key={file.relative_path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(15, 23, 42, 0.75)',
                      border: '1px solid rgba(251, 191, 36, 0.2)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '220px' }}>
                      {/* Image Thumbnail Preview or Category Icon */}
                      {isImg ? (
                        <div
                          onClick={() => setQuickLookFile(file)}
                          title="Click to preview full image"
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            background: '#040711',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            cursor: 'pointer',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <img
                            src={getFilePreviewUrl(file.relative_path, activeWorkspace?.path)}
                            alt={file.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                      ) : isTextFile(file.name) ? (
                        <div
                          onClick={() => setQuickLookFile(file)}
                          title="Click to preview code"
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '8px',
                            background: 'rgba(56, 189, 248, 0.1)',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            color: '#38bdf8',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          <FileCode size={20} />
                        </div>
                      ) : (
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '8px',
                            background: 'rgba(251, 191, 36, 0.1)',
                            color: '#fbbf24',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <FileText size={20} />
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <span
                          onClick={() => setQuickLookFile(file)}
                          style={{
                            fontSize: '13px',
                            fontWeight: '600',
                            color: '#f8fafc',
                            wordBreak: 'break-all',
                            cursor: 'pointer',
                          }}
                        >
                          {file.name}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', fontSize: '11px' }}>
                          <span style={{ color: '#fbbf24' }}>
                            ⏰ {file.days_inactive}d unopened
                          </span>
                          <span style={{ color: '#64748b' }}>•</span>
                          <span style={{ color: file.cloud_info.is_cloud_placeholder ? '#c084fc' : '#38bdf8' }}>
                            {file.cloud_info.is_cloud_placeholder ? '☁️ Cloud' : '💾 Local'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: '#fbbf24', marginRight: '4px' }}>
                        {file.size_formatted}
                      </span>

                      {/* Preview Button */}
                      <button
                        onClick={() => setQuickLookFile(file)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          background: 'rgba(56, 189, 248, 0.08)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          color: '#38bdf8',
                          fontSize: '11px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                        title="View image or file preview"
                      >
                        <Eye size={12} /> Preview
                      </button>

                      <button
                        onClick={() => {
                          setSelectedFileForAction(file);
                          setActionType('archive');
                        }}
                        disabled={actionInProgress}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          color: '#38bdf8',
                          fontSize: '11px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                        title="Safely move to Archive/ folder"
                      >
                        <Archive size={12} /> Archive
                      </button>

                      <button
                        onClick={() => {
                          setSelectedFileForAction(file);
                          setActionType('trash');
                        }}
                        disabled={actionInProgress}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          background: 'rgba(244, 63, 94, 0.12)',
                          border: '1px solid rgba(244, 63, 94, 0.3)',
                          color: '#fb7185',
                          fontSize: '11px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                        title="Move safely to Trash"
                      >
                        <Trash2 size={12} /> Trash
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SUB-SECTION 3: Cloud Sync Awareness ───────────────────────── */}
      {data && activeSection === 'cloud' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '8px',
            }}
          >
            <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Cloud Files</div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#f8fafc', marginTop: '2px' }}>
                {data.cloud_summary.total_cloud_files}
              </div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Cloud-Only Stubs</div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#c084fc', marginTop: '2px' }}>
                {data.cloud_summary.cloud_placeholder_count}
              </div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Local Copies</div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#38bdf8', marginTop: '2px' }}>
                {data.cloud_summary.local_copy_count}
              </div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Disk Saved</div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#34d399', marginTop: '2px' }}>
                {data.cloud_summary.space_saved_formatted}
              </div>
            </div>
          </div>

          {/* Providers & Guard */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '8px 12px', background: 'rgba(15, 23, 42, 0.5)', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <span style={{ color: '#64748b' }}>Providers:</span>
              {data.cloud_summary.providers_detected.length > 0 ? (
                data.cloud_summary.providers_detected.map((p) => (
                  <span key={p} style={{ color: '#c084fc', fontWeight: '600' }}>
                    ☁️ {p}
                  </span>
                ))
              ) : (
                <span style={{ color: '#94a3b8' }}>Local Workspace</span>
              )}
            </div>

            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Dataless files use 0 local blocks • Safe against auto-hydration
            </span>
          </div>
        </div>
      )}

      {/* ── SUB-SECTION 4: Categories ─────────────────────────────────── */}
      {data && activeSection === 'categories' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
          {data.category_breakdowns.map((cat) => (
            <div
              key={cat.category}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.6)',
                border: `1px solid ${cat.color}33`,
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: cat.color }} />
                  {cat.category}
                </span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{cat.percentage}%</span>
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: cat.color }}>
                {cat.formatted_size}
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{cat.file_count} files</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Quick Look File Preview Modal ─────────────────────────────── */}
      {quickLookFile && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.82)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999999,
          }}
          onClick={() => setQuickLookFile(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '92%',
              maxWidth: '680px',
              maxHeight: '88vh',
              background: '#0b1120',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: '16px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px',
                borderBottom: '1px solid #1e293b',
                background: 'rgba(15, 23, 42, 0.8)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                {isImageFile(quickLookFile.name) ? (
                  <ImageIcon size={18} color="#f472b6" />
                ) : isTextFile(quickLookFile.name) ? (
                  <FileCode size={18} color="#38bdf8" />
                ) : (
                  <FileText size={18} color="#94a3b8" />
                )}
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {quickLookFile.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {quickLookFile.relative_path}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setQuickLookFile(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content: Image or Text Preview */}
            <div
              style={{
                padding: '16px',
                overflowY: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#040711',
                minHeight: '220px',
                maxHeight: '56vh',
              }}
            >
              {isImageFile(quickLookFile.name) ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
                  <img
                    src={getFilePreviewUrl(quickLookFile.relative_path, activeWorkspace?.path)}
                    alt={quickLookFile.name}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '50vh',
                      objectFit: 'contain',
                      borderRadius: '8px',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
                    }}
                  />
                </div>
              ) : isTextFile(quickLookFile.name) ? (
                previewLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontSize: '13px' }}>
                    <RefreshCw size={16} className="spin-clockwise" /> Loading preview…
                  </div>
                ) : (
                  <pre
                    style={{
                      margin: 0,
                      width: '100%',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      color: '#cbd5e1',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      lineHeight: '1.5',
                      background: 'rgba(15, 23, 42, 0.4)',
                      padding: '12px',
                      borderRadius: '8px',
                      maxHeight: '50vh',
                      overflowY: 'auto',
                    }}
                  >
                    {previewTextContent}
                  </pre>
                )
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: '#94a3b8', padding: '24px' }}>
                  <FileText size={48} color="#38bdf8" />
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#e2e8f0' }}>Binary File ({quickLookFile.category || 'File'})</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Direct in-browser visual preview is available for images, code, text, and markdown files.</div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 18px',
                borderTop: '1px solid #1e293b',
                background: 'rgba(15, 23, 42, 0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                <span style={{ fontWeight: '700', color: '#38bdf8' }}>{quickLookFile.size_formatted || ''}</span>
                {quickLookFile.days_inactive !== undefined && (
                  <span style={{ color: '#fbbf24' }}>⏰ {quickLookFile.days_inactive}d unopened</span>
                )}
                {quickLookFile.cloud_info?.is_cloud_placeholder && (
                  <span style={{ color: '#c084fc' }}>☁️ Cloud-only</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => {
                    const f = quickLookFile as LargeForgottenFile;
                    setQuickLookFile(null);
                    setSelectedFileForAction(f);
                    setActionType('archive');
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#38bdf8',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Archive size={13} /> Archive
                </button>

                <button
                  onClick={() => {
                    const f = quickLookFile as LargeForgottenFile;
                    setQuickLookFile(null);
                    setSelectedFileForAction(f);
                    setActionType('trash');
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    background: 'rgba(244, 63, 94, 0.15)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    color: '#fb7185',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Trash2 size={13} /> Trash
                </button>
              </div>
            </div>
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
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div
            style={{
              width: '90%',
              maxWidth: '400px',
              background: '#0b1120',
              border: actionType === 'trash' ? '1px solid rgba(244, 63, 94, 0.4)' : '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: '12px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '15px', fontWeight: '700', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {actionType === 'trash' ? <Trash2 size={16} color="#fb7185" /> : <Archive size={16} color="#38bdf8" />}
                {actionType === 'trash' ? 'Move to Trash' : 'Archive File'}
              </span>
              <button
                onClick={() => {
                  setSelectedFileForAction(null);
                  setActionType(null);
                }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.4' }}>
              {actionType === 'trash' ? (
                <>
                  Move <strong style={{ color: '#f8fafc' }}>{selectedFileForAction.name}</strong> ({selectedFileForAction.size_formatted}) to Trash?
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    Recoverable anytime via system Trash.
                  </div>
                </>
              ) : (
                <>
                  Move <strong style={{ color: '#f8fafc' }}>{selectedFileForAction.name}</strong> ({selectedFileForAction.size_formatted}) to <code>Archive/</code>?
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    Logged in Action Ledger with 1-click Undo.
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => {
                  setSelectedFileForAction(null);
                  setActionType(null);
                }}
                disabled={actionInProgress}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid #334155',
                  color: '#94a3b8',
                  fontSize: '12px',
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
                  padding: '6px 14px',
                  borderRadius: '6px',
                  background: actionType === 'trash' ? '#e11d48' : '#0284c7',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: actionInProgress ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                {actionInProgress ? <RefreshCw size={12} className="spin-clockwise" /> : null}
                {actionInProgress ? 'Working…' : actionType === 'trash' ? 'Trash' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
