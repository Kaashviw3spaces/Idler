import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardDrive,
  RefreshCw,
  Clock,
  Cloud,
  Folder,
  AlertTriangle,
  PieChart,
  CheckCircle2,
} from 'lucide-react';
import {
  StorageAnalyticsResponse,
  LargeForgottenFile,
  WorkspaceItem,
} from '../types';
import {
  getStorageAnalytics,
  archiveLargeFile,
  trashLargeFile,
} from '../api';
import { FilePreviewModal, FilePreviewTarget } from './FilePreviewModal';

interface CompactStorageAnalyticsProps {
  activeWorkspace?: WorkspaceItem | null;
  workspaces?: WorkspaceItem[];
  onSelectWorkspace?: (ws: WorkspaceItem) => void;
  onActionComplete?: (message: string) => void;
}

type CompactSection = 'folders' | 'forgotten' | 'cloud';

export const CompactStorageAnalytics: React.FC<CompactStorageAnalyticsProps> = ({
  activeWorkspace,
  workspaces = [],
  onSelectWorkspace,
  onActionComplete,
}) => {
  const [data, setData] = useState<StorageAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<CompactSection>('folders');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FilePreviewTarget | null>(null);

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      // Threshold: 500 MB, 180 days (6 months)
      const res = await getStorageAnalytics(activeWorkspace.path, '.', 500 * 1024 * 1024, 180);
      setData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to scan storage');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleArchive = async (file: LargeForgottenFile) => {
    if (!activeWorkspace) return;
    setActionInProgress(file.relative_path);
    try {
      const res = await archiveLargeFile(activeWorkspace.path, file.relative_path);
      onActionComplete?.(res.message);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTrash = async (file: LargeForgottenFile) => {
    if (!activeWorkspace) return;
    setActionInProgress(file.relative_path);
    try {
      const res = await trashLargeFile(activeWorkspace.path, file.relative_path);
      onActionComplete?.(res.message);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  // Top folders sorted by size
  const topSubfolders = useMemo(() => {
    if (!data?.tree?.children) return [];
    return data.tree.children
      .filter((c) => c.is_dir)
      .sort((a, b) => b.size_bytes - a.size_bytes)
      .slice(0, 8);
  }, [data]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: '100%',
        color: '#f8fafc',
      }}
    >
      {/* ── Top Header Bar ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          borderRadius: '10px',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
          <HardDrive size={14} color="#38bdf8" />
          {workspaces.length > 1 && onSelectWorkspace ? (
            <select
              value={activeWorkspace?.path || ''}
              onChange={(e) => {
                const ws = workspaces.find((w) => w.path === e.target.value);
                if (ws) onSelectWorkspace(ws);
              }}
              style={{
                background: '#0a0f1d',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '6px',
                color: '#e2e8f0',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: '600',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '160px',
              }}
            >
              {workspaces.map((w) => (
                <option key={w.path} value={w.path}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeWorkspace?.name || 'Storage'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {data && (
            <span
              style={{
                fontSize: '9px',
                fontWeight: '600',
                color: '#34d399',
                background: 'rgba(52, 211, 153, 0.1)',
                border: '1px solid rgba(52, 211, 153, 0.25)',
                padding: '1px 5px',
                borderRadius: '4px',
              }}
            >
              {data.scan_duration_ms}ms
            </span>
          )}

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            title="Rescan workspace storage"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              color: '#38bdf8',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={11} className={loading ? 'spin-clockwise' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '6px 10px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#f87171',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', padding: '30px 10px', color: '#38bdf8', fontSize: '12px' }}>
          <RefreshCw size={18} className="spin-clockwise" style={{ margin: '0 auto 8px' }} />
          <div>Scanning storage analytics…</div>
        </div>
      )}

      {data && (
        <>
          {/* ── 4 Colorful Micro-Stats in 2x2 Grid ────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px',
            }}
          >
            {/* 1. Storage Size */}
            <div
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15) 0%, rgba(15, 23, 42, 0.6) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <HardDrive size={11} color="#38bdf8" /> Storage
              </div>
              <div style={{ fontSize: '14px', fontWeight: '800', color: '#38bdf8', marginTop: '2px' }}>
                {data.total_size_formatted}
              </div>
              <div style={{ fontSize: '9px', color: '#64748b' }}>{data.total_files} files</div>
            </div>

            {/* 2. Forgotten Files */}
            <div
              onClick={() => setActiveSection('forgotten')}
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(15, 23, 42, 0.6) 100%)',
                border: data.large_forgotten_files.length > 0 ? '1px solid rgba(251, 191, 36, 0.4)' : '1px solid rgba(245, 158, 11, 0.2)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={11} color="#fbbf24" /> Forgotten (&gt;500M)
              </div>
              <div style={{ fontSize: '14px', fontWeight: '800', color: '#fbbf24', marginTop: '2px' }}>
                {data.large_forgotten_files.length} file{data.large_forgotten_files.length === 1 ? '' : 's'}
              </div>
              <div style={{ fontSize: '9px', color: '#94a3b8' }}>&gt;6 mo inactive</div>
            </div>

            {/* 3. Cloud Saved */}
            <div
              onClick={() => setActiveSection('cloud')}
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(15, 23, 42, 0.6) 100%)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Cloud size={11} color="#c084fc" /> Cloud Saved
              </div>
              <div style={{ fontSize: '14px', fontWeight: '800', color: '#c084fc', marginTop: '2px' }}>
                {data.cloud_summary.space_saved_formatted}
              </div>
              <div style={{ fontSize: '9px', color: '#94a3b8' }}>{data.cloud_summary.cloud_placeholder_count} stubs</div>
            </div>

            {/* 4. Categories Count */}
            <div
              onClick={() => setActiveSection('folders')}
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(15, 23, 42, 0.6) 100%)',
                border: '1px solid rgba(52, 211, 153, 0.3)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <PieChart size={11} color="#34d399" /> Types
              </div>
              <div style={{ fontSize: '14px', fontWeight: '800', color: '#34d399', marginTop: '2px' }}>
                {data.category_breakdowns.length} Categories
              </div>
              <div style={{ fontSize: '9px', color: '#64748b' }}>Inspected</div>
            </div>
          </div>

          {/* ── Multi-Color Proportional Storage Meter ────────────────────── */}
          {data.category_breakdowns.length > 0 && (
            <div
              style={{
                padding: '8px 10px',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {/* The Colorful Progress Bar */}
              <div
                style={{
                  display: 'flex',
                  height: '8px',
                  width: '100%',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  background: 'rgba(255, 255, 255, 0.08)',
                }}
              >
                {data.category_breakdowns.map((cat) => (
                  <div
                    key={cat.category}
                    title={`${cat.category}: ${cat.formatted_size} (${cat.percentage}%)`}
                    style={{
                      width: `${Math.max(cat.percentage, 1.2)}%`,
                      backgroundColor: cat.color || '#38bdf8',
                      height: '100%',
                      transition: 'width 0.3s ease',
                    }}
                  />
                ))}
              </div>

              {/* Colorful Category Legend Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {data.category_breakdowns.slice(0, 6).map((cat) => (
                  <span
                    key={cat.category}
                    style={{
                      fontSize: '9px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${cat.color}40`,
                      color: '#e2e8f0',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: cat.color || '#38bdf8',
                        display: 'inline-block',
                      }}
                    />
                    <span style={{ fontWeight: '600' }}>{cat.category}:</span>
                    <span style={{ color: cat.color }}>{cat.formatted_size}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Sub-Section Segmented Pill Switcher ────────────────────────── */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(0, 0, 0, 0.35)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              gap: '2px',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveSection('folders')}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: '10px',
                fontWeight: activeSection === 'folders' ? '700' : '500',
                borderRadius: '6px',
                border: 'none',
                background: activeSection === 'folders' ? '#0284c7' : 'transparent',
                color: activeSection === 'folders' ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              📁 Folders ({topSubfolders.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('forgotten')}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: '10px',
                fontWeight: activeSection === 'forgotten' ? '700' : '500',
                borderRadius: '6px',
                border: 'none',
                background: activeSection === 'forgotten' ? '#d97706' : 'transparent',
                color: activeSection === 'forgotten' ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              ⏰ Forgotten ({data.large_forgotten_files.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('cloud')}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: '10px',
                fontWeight: activeSection === 'cloud' ? '700' : '500',
                borderRadius: '6px',
                border: 'none',
                background: activeSection === 'cloud' ? '#7c3aed' : 'transparent',
                color: activeSection === 'cloud' ? '#ffffff' : '#94a3b8',
                cursor: 'pointer',
              }}
            >
              ☁️ Cloud ({data.cloud_summary.total_cloud_files})
            </button>
          </div>

          {/* ── Sub-Section 1: Subfolders Breakdown ───────────────────────── */}
          {activeSection === 'folders' && (
            <div
              style={{
                maxHeight: '180px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                paddingRight: '2px',
              }}
            >
              {topSubfolders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '11px' }}>
                  No subdirectories found.
                </div>
              ) : (
                topSubfolders.map((folder, idx) => {
                  const pct = data.total_size_bytes > 0
                    ? ((folder.size_bytes / data.total_size_bytes) * 100).toFixed(0)
                    : '0';

                  return (
                    <div
                      key={folder.name}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                          <Folder size={12} color="#38bdf8" />
                          <span style={{ color: '#f1f5f9', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {folder.name}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <span style={{ color: '#38bdf8', fontWeight: '700', fontSize: '10px' }}>
                            {folder.size_formatted}
                          </span>
                          <span style={{ color: '#64748b', fontSize: '9px' }}>
                            ({pct}%)
                          </span>
                        </div>
                      </div>

                      {/* Mini Fill Bar */}
                      <div
                        style={{
                          height: '3px',
                          width: '100%',
                          background: 'rgba(255, 255, 255, 0.06)',
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: idx === 0 ? '#38bdf8' : idx === 1 ? '#a855f7' : idx === 2 ? '#34d399' : '#fbbf24',
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── Sub-Section 2: Forgotten Files Hunter ─────────────────────── */}
          {activeSection === 'forgotten' && (
            <div
              style={{
                maxHeight: '180px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                paddingRight: '2px',
              }}
            >
              {data.large_forgotten_files.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px', color: '#34d399', fontSize: '11px' }}>
                  <CheckCircle2 size={16} color="#34d399" style={{ margin: '0 auto 4px' }} />
                  <div>No forgotten files &gt;500MB! Workspace is clean.</div>
                </div>
              ) : (
                data.large_forgotten_files.map((file) => (
                  <div
                    key={file.relative_path}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: 'rgba(251, 191, 36, 0.04)',
                      border: '1px solid rgba(251, 191, 36, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                  >
                    <div
                      onClick={() => setPreviewFile({
                        name: file.name,
                        relative_path: file.relative_path,
                        category: file.category,
                        formatted_size: file.size_formatted,
                        days_inactive: file.days_inactive,
                      })}
                      title="Click to preview file"
                      style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
                    >
                      <div style={{ color: '#f8fafc', fontSize: '11px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {file.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', marginTop: '2px' }}>
                        <span style={{ color: '#fbbf24', fontWeight: '700' }}>{file.size_formatted}</span>
                        <span style={{ color: '#94a3b8' }}>• ⏰ {file.days_inactive}d unopened</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => handleArchive(file)}
                        disabled={actionInProgress === file.relative_path}
                        title="Archive to Archive folder"
                        style={{
                          padding: '3px 6px',
                          borderRadius: '4px',
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          color: '#38bdf8',
                          fontSize: '9px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Archive
                      </button>

                      <button
                        type="button"
                        onClick={() => handleTrash(file)}
                        disabled={actionInProgress === file.relative_path}
                        title="Move to Trash"
                        style={{
                          padding: '3px 6px',
                          borderRadius: '4px',
                          background: 'rgba(244, 63, 94, 0.12)',
                          border: '1px solid rgba(244, 63, 94, 0.25)',
                          color: '#fb7185',
                          fontSize: '9px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Trash
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Sub-Section 3: Cloud Sync Awareness ───────────────────────── */}
          {activeSection === 'cloud' && (
            <div
              style={{
                maxHeight: '180px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                paddingRight: '2px',
              }}
            >
              {/* Cloud Overview Card */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(15, 23, 42, 0.7) 100%)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#c084fc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Cloud size={13} color="#c084fc" /> Cloud Storage Status
                  </span>
                  <span style={{ fontSize: '10px', color: '#34d399', fontWeight: '700' }}>
                    {data.cloud_summary.space_saved_formatted} Saved
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '9px' }}>
                  <div style={{ color: '#cbd5e1' }}>
                    Stubs (cloud-only): <strong style={{ color: '#c084fc' }}>{data.cloud_summary.cloud_placeholder_count}</strong>
                  </div>
                  <div style={{ color: '#cbd5e1' }}>
                    Local Copies: <strong style={{ color: '#38bdf8' }}>{data.cloud_summary.local_copy_count}</strong>
                  </div>
                </div>

                {data.cloud_summary.providers_detected.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                    {data.cloud_summary.providers_detected.map((p) => (
                      <span
                        key={p}
                        style={{
                          fontSize: '8px',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          background: 'rgba(168, 85, 247, 0.2)',
                          color: '#e9d5ff',
                          fontWeight: '600',
                        }}
                      >
                        ☁️ {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Cloud Files from large_forgotten_files with cloud info */}
              {data.large_forgotten_files.filter((f) => f.cloud_info?.is_cloud_file).length > 0 ? (
                data.large_forgotten_files
                  .filter((f) => f.cloud_info?.is_cloud_file)
                  .map((file) => (
                    <div
                      key={file.relative_path}
                      onClick={() => setPreviewFile({
                        name: file.name,
                        relative_path: file.relative_path,
                        category: file.category,
                        formatted_size: file.size_formatted,
                      })}
                      style={{
                        padding: '5px 8px',
                        borderRadius: '6px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '10px',
                        cursor: 'pointer',
                        gap: '6px',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                        <div style={{ color: '#f1f5f9', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </div>
                        <div style={{ color: '#8a8790', fontSize: '9px' }}>
                          {file.cloud_info?.cloud_provider || 'Cloud'}
                        </div>
                      </div>

                      <div style={{ flexShrink: 0 }}>
                        {file.cloud_info?.is_cloud_placeholder ? (
                          <span
                            style={{
                              fontSize: '8px',
                              color: '#c084fc',
                              background: 'rgba(168, 85, 247, 0.15)',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              fontWeight: '600',
                            }}
                          >
                            ☁️ Stub
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '8px',
                              color: '#34d399',
                              background: 'rgba(52, 211, 153, 0.12)',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              fontWeight: '600',
                            }}
                          >
                            💾 Local
                          </span>
                        )}
                      </div>
                    </div>
                  ))
              ) : (
                <div style={{ textAlign: 'center', padding: '12px', color: '#64748b', fontSize: '10px' }}>
                  No cloud stub warnings in this folder.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Quick Look Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          workspacePath={activeWorkspace?.path}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};
