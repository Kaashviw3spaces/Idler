import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  FileText,
  FileCode,
  Image as ImageIcon,
  Presentation,
  Table as TableIcon,
  File,
  ChevronLeft,
  ChevronRight,
  Archive,
  Trash2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import {
  fetchFileTextPreview,
  getFilePreviewUrl,
  getFileThumbnailUrl,
  FilePreviewInspection
} from '../api';

export interface FilePreviewTarget {
  name: string;
  relative_path: string;
  category?: string;
  size_bytes?: number;
  formatted_size?: string;
  days_inactive?: number;
}

interface FilePreviewModalProps {
  file: FilePreviewTarget | null;
  workspacePath?: string;
  onClose: () => void;
  onArchive?: (file: FilePreviewTarget) => void;
  onTrash?: (file: FilePreviewTarget) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  workspacePath,
  onClose,
  onArchive,
  onTrash
}) => {
  const [data, setData] = useState<FilePreviewInspection | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'visual' | 'content'>('visual');
  const [thumbnailFailed, setThumbnailFailed] = useState<boolean>(false);

  useEffect(() => {
    if (!file) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setActiveSlideIndex(0);
    setThumbnailFailed(false);

    fetchFileTextPreview(file.relative_path || file.name, workspacePath)
      .then((res) => {
        setData(res);
        if (res.is_presentation) {
          setActiveTab('visual');
        } else if (res.is_image || res.is_pdf) {
          setActiveTab('visual');
        } else {
          setActiveTab('content');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [file, workspacePath]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!file) return null;

  const handleCopy = () => {
    if (!data?.content) return;
    navigator.clipboard.writeText(data.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getHeaderIcon = () => {
    if (!data) return <File size={18} color="#94a3b8" />;
    if (data.is_presentation) return <Presentation size={18} color="#f97316" />;
    if (data.is_spreadsheet) return <TableIcon size={18} color="#10b981" />;
    if (data.is_image) return <ImageIcon size={18} color="#f472b6" />;
    if (data.is_pdf) return <FileText size={18} color="#ef4444" />;
    if (data.is_document) return <FileText size={18} color="#38bdf8" />;
    if (data.file_type === 'text') return <FileCode size={18} color="#38bdf8" />;
    return <File size={18} color="#94a3b8" />;
  };

  const previewUrl = getFilePreviewUrl(file.relative_path || file.name, workspacePath);
  const thumbnailUrl = getFileThumbnailUrl(file.relative_path || file.name, workspacePath);

  const slides = data?.presentation_data?.slides || [];
  const activeSlide = slides[activeSlideIndex];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '20px',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '88vh',
          backgroundColor: '#070b16',
          borderRadius: '16px',
          border: '1px solid rgba(56, 189, 248, 0.28)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85), 0 0 40px rgba(56, 189, 248, 0.08)',
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
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.85) 0%, rgba(7, 11, 22, 0.85) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '9px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {getHeaderIcon()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: '15px',
                    fontWeight: '700',
                    color: '#f8fafc',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {file.name}
                </h3>
                {file.category && (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      color: '#38bdf8',
                      fontWeight: '600',
                    }}
                  >
                    {file.category}
                  </span>
                )}
                {data?.formatted_size && (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#94a3b8',
                      fontWeight: '500',
                    }}
                  >
                    {data.formatted_size}
                  </span>
                )}
              </div>
              <p
                style={{
                  margin: '3px 0 0 0',
                  fontSize: '11px',
                  color: '#64748b',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {file.relative_path || file.name}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {/* Tab switch for presentations */}
            {data?.is_presentation && (
              <div
                style={{
                  display: 'inline-flex',
                  background: 'rgba(0, 0, 0, 0.4)',
                  padding: '3px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('visual')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: activeTab === 'visual' ? '600' : '400',
                    background: activeTab === 'visual' ? '#0284c7' : 'transparent',
                    color: activeTab === 'visual' ? '#ffffff' : '#94a3b8',
                  }}
                >
                  Slide Deck View
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('content')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: activeTab === 'content' ? '600' : '400',
                    background: activeTab === 'content' ? '#0284c7' : 'transparent',
                    color: activeTab === 'content' ? '#ffffff' : '#94a3b8',
                  }}
                >
                  Slide Outline ({slides.length})
                </button>
              </div>
            )}

            {data?.content && (
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 10px',
                  borderRadius: '7px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: copied ? '#4ade80' : '#cbd5e1',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
                title="Copy contents"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Content Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            background: '#040711',
            display: 'flex',
            flexDirection: 'column',
            minHeight: '260px',
            maxHeight: '68vh',
          }}
        >
          {loading ? (
            <div
              style={{
                margin: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                color: '#38bdf8',
                padding: '40px 0',
              }}
            >
              <RefreshCw size={24} className="spin-clockwise" />
              <span style={{ fontSize: '13px', fontWeight: '500' }}>Loading preview…</span>
            </div>
          ) : error ? (
            <div
              style={{
                margin: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                color: '#f87171',
                padding: '40px 0',
              }}
            >
              <AlertCircle size={28} />
              <span style={{ fontSize: '13px', fontWeight: '600' }}>Could not load preview</span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{error}</span>
            </div>
          ) : data?.is_image ? (
            /* ── Image Preview View ── */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                margin: 'auto',
                width: '100%',
              }}
            >
              <img
                src={previewUrl}
                alt={file.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '56vh',
                  objectFit: 'contain',
                  borderRadius: '10px',
                  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              />
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Full resolution image render • {data.mime_type}
              </div>
            </div>
          ) : data?.is_presentation ? (
            /* ── PowerPoint / Presentation Preview View ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
              {activeTab === 'visual' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}>
                  {/* High-res rendered slide thumbnail */}
                  {!thumbnailFailed ? (
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        maxWidth: '720px',
                        background: '#090d1a',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        border: '1px solid rgba(249, 115, 22, 0.3)',
                        boxShadow: '0 12px 35px rgba(0, 0, 0, 0.6), 0 0 25px rgba(249, 115, 22, 0.1)',
                      }}
                    >
                      <img
                        src={thumbnailUrl}
                        alt="Slide Thumbnail"
                        onError={() => setThumbnailFailed(true)}
                        style={{
                          width: '100%',
                          maxHeight: '44vh',
                          objectFit: 'contain',
                          display: 'block',
                          backgroundColor: '#000000',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '10px',
                          left: '12px',
                          padding: '3px 10px',
                          borderRadius: '6px',
                          background: 'rgba(0, 0, 0, 0.75)',
                          backdropFilter: 'blur(6px)',
                          color: '#fed7aa',
                          fontSize: '11px',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Presentation size={13} color="#f97316" />
                        Quick Look Slide Render
                      </div>
                    </div>
                  ) : (
                    /* Fallback when QuickLook preview is unavailable */
                    <div
                      style={{
                        width: '100%',
                        padding: '32px',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.1) 0%, rgba(15, 23, 42, 0.6) 100%)',
                        border: '1px solid rgba(249, 115, 22, 0.25)',
                        textAlign: 'center',
                      }}
                    >
                      <Presentation size={48} color="#f97316" style={{ margin: '0 auto 12px' }} />
                      <div style={{ fontSize: '16px', fontWeight: '700', color: '#f8fafc' }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '6px' }}>
                        PowerPoint Presentation ({slides.length} slides extracted)
                      </div>
                    </div>
                  )}

                  {/* Slide Carousel Navigator */}
                  {slides.length > 0 && activeSlide && (
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '720px',
                        background: '#090d1a',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '12px',
                        padding: '14px 18px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '10px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              background: '#f97316',
                              color: '#ffffff',
                              fontSize: '11px',
                              fontWeight: '700',
                              padding: '2px 8px',
                              borderRadius: '6px',
                            }}
                          >
                            Slide {activeSlide.slide_number} of {slides.length}
                          </span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9' }}>
                            {activeSlide.title}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            disabled={activeSlideIndex === 0}
                            onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              background: 'rgba(255, 255, 255, 0.04)',
                              color: activeSlideIndex === 0 ? '#475569' : '#cbd5e1',
                              cursor: activeSlideIndex === 0 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={activeSlideIndex === slides.length - 1}
                            onClick={() => setActiveSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              background: 'rgba(255, 255, 255, 0.04)',
                              color: activeSlideIndex === slides.length - 1 ? '#475569' : '#cbd5e1',
                              cursor: activeSlideIndex === slides.length - 1 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Slide Bullets */}
                      {activeSlide.bullets.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '4px' }}>
                          {activeSlide.bullets.map((b, bIdx) => (
                            <div
                              key={bIdx}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                fontSize: '12px',
                                color: '#cbd5e1',
                                lineHeight: '1.5',
                              }}
                            >
                              <span style={{ color: '#f97316', fontWeight: '700' }}>•</span>
                              <span>{b}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                          No text bullets found on this slide.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Slide Outline Grid */
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                  {slides.map((s, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setActiveSlideIndex(idx);
                        setActiveTab('visual');
                      }}
                      style={{
                        padding: '12px 14px',
                        background: idx === activeSlideIndex ? 'rgba(249, 115, 22, 0.12)' : '#080d1b',
                        border: idx === activeSlideIndex ? '1px solid #f97316' : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: '700',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: '#f97316',
                            color: '#ffffff',
                          }}
                        >
                          Slide {s.slide_number}
                        </span>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: '#f8fafc',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.title}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#94a3b8',
                          lineHeight: '1.4',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {s.preview_snippet || 'Slide content'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : data?.is_spreadsheet ? (
            /* ── Spreadsheet Preview View (.xlsx, .csv) ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data.spreadsheet_data?.sheets && data.spreadsheet_data.sheets.length > 0 ? (
                <div style={{ overflowX: 'auto', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <tbody>
                      {data.spreadsheet_data.sheets[0].rows.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          style={{
                            background: rIdx === 0 ? 'rgba(16, 185, 129, 0.12)' : rIdx % 2 === 0 ? '#060a14' : '#080d1b',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                          }}
                        >
                          {row.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              style={{
                                padding: '8px 12px',
                                color: rIdx === 0 ? '#34d399' : '#e2e8f0',
                                fontWeight: rIdx === 0 ? '700' : '400',
                                whiteSpace: 'nowrap',
                                borderRight: '1px solid rgba(255, 255, 255, 0.04)',
                              }}
                            >
                              {cell || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                  No spreadsheet rows extracted.
                </div>
              )}
            </div>
          ) : data?.is_document ? (
            /* ── Document View (.docx, .doc) ── */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxWidth: '740px',
                margin: '0 auto',
                width: '100%',
              }}
            >
              {data.document_data?.paragraphs && data.document_data.paragraphs.length > 0 ? (
                <div
                  style={{
                    background: '#080d1b',
                    padding: '24px',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {data.document_data.paragraphs.map((p, pIdx) => (
                    <p
                      key={pIdx}
                      style={{
                        margin: 0,
                        fontSize: '13px',
                        color: '#cbd5e1',
                        lineHeight: '1.6',
                      }}
                    >
                      {p}
                    </p>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                  No formatted document paragraphs extracted.
                </div>
              )}
            </div>
          ) : data?.is_pdf ? (
            /* ── PDF View ── */
            <div style={{ width: '100%', height: '54vh', minHeight: '360px' }}>
              <iframe
                src={previewUrl}
                title={file.name}
                style={{
                  width: '100%',
                  height: '100%',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  backgroundColor: '#0f172a',
                }}
              />
            </div>
          ) : data?.content ? (
            /* ── Text / Code Preview View ── */
            <div
              style={{
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: '#050813',
                overflow: 'hidden',
              }}
            >
              <pre
                style={{
                  margin: 0,
                  padding: '16px',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: '12px',
                  color: '#e2e8f0',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '52vh',
                  overflowY: 'auto',
                }}
              >
                {data.content}
              </pre>
            </div>
          ) : (
            /* ── Binary / Fallback View ── */
            <div
              style={{
                margin: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                padding: '40px 0',
                color: '#94a3b8',
              }}
            >
              <File size={42} color="#38bdf8" />
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#f8fafc' }}>
                {file.name}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', maxWidth: '360px', textAlign: 'center' }}>
                Binary file ({data?.extension || 'unknown type'}). Preview is optimized for Presentations (PPT/PPTX), Images, Documents, Spreadsheets, PDFs, and Code files.
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'linear-gradient(180deg, rgba(7, 11, 22, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#94a3b8' }}>
            {data?.lines_count !== undefined && (
              <span>{data.lines_count} line(s)</span>
            )}
            {data?.presentation_data?.total_slides !== undefined && (
              <span style={{ color: '#f97316', fontWeight: '600' }}>
                {data.presentation_data.total_slides} slide(s)
              </span>
            )}
            {file.days_inactive !== undefined && (
              <span style={{ color: '#fbbf24' }}>⏰ {file.days_inactive}d unopened</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onArchive && (
              <button
                type="button"
                onClick={() => {
                  onArchive(file);
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 12px',
                  borderRadius: '7px',
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.28)',
                  color: '#38bdf8',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <Archive size={13} />
                Archive
              </button>
            )}

            {onTrash && (
              <button
                type="button"
                onClick={() => {
                  onTrash(file);
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 12px',
                  borderRadius: '7px',
                  background: 'rgba(244, 63, 94, 0.12)',
                  border: '1px solid rgba(244, 63, 94, 0.28)',
                  color: '#fb7185',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={13} />
                Trash
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 14px',
                borderRadius: '7px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#e2e8f0',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
