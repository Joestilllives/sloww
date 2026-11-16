import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Lock, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import type { BrainDump, MapEdge, MapNode, MindMap, PatternInsight } from '../types';
import {
  exportSanctuaryAsJson,
  exportSanctuaryAsMarkdown,
  parseImportedSanctuaryJson,
  type ExportableSanctuary,
} from '../lib/exportSanctuary';

interface SanctuariesModalProps {
  maps: MindMap[];
  activeMapId: string | null;
  activeMap: MindMap | null;
  activeNodes: MapNode[];
  activeEdges: MapEdge[];
  activeDumps: BrainDump[];
  activePatterns: PatternInsight[];
  isSignedIn: boolean;
  onFetchSearchIndex?: () => Promise<{ nodes: MapNode[]; dumps: BrainDump[] }>;
  onSelectMap: (mapId: string) => void;
  onCreateMap: (title: string, intention: string) => Promise<void>;
  onImportBundle: (bundle: ExportableSanctuary) => Promise<void>;
  onDeleteMap: (mapId: string) => Promise<void>;
  onClose: () => void;
}

export const SanctuariesModal: React.FC<SanctuariesModalProps> = ({
  maps,
  activeMapId,
  activeMap,
  activeNodes,
  activeEdges,
  activeDumps,
  activePatterns,
  isSignedIn,
  onFetchSearchIndex,
  onSelectMap,
  onCreateMap,
  onImportBundle,
  onDeleteMap,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState('');
  const [intention, setIntention] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState<{ nodes: MapNode[]; dumps: BrainDump[] } | null>(
    null
  );
  const [isIndexingSearch, setIsIndexingSearch] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [exportedFormat, setExportedFormat] = useState<'md' | 'json' | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!exportedFormat) return;
    const t = window.setTimeout(() => setExportedFormat(null), 2000);
    return () => window.clearTimeout(t);
  }, [exportedFormat]);

  useEffect(() => {
    if (searchQuery.trim().length < 2 || searchIndex || !onFetchSearchIndex) return;
    let cancelled = false;
    setIsIndexingSearch(true);
    void onFetchSearchIndex()
      .then((idx) => {
        if (!cancelled) setSearchIndex(idx);
      })
      .catch(() => {
        // Non-blocking fallback to map titles/intentions and active map
      })
      .finally(() => {
        if (!cancelled) setIsIndexingSearch(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchQuery, searchIndex, onFetchSearchIndex]);

  const filteredSanctuaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const indexedNodes = searchIndex ? searchIndex.nodes : activeNodes;
    const indexedDumps = searchIndex ? searchIndex.dumps : activeDumps;

    if (!q) {
      return maps.map((m) => ({
        map: m,
        snippets: [] as Array<{ source: 'Card' | 'Journal'; text: string }>,
      }));
    }

    const results: Array<{
      map: MindMap;
      snippets: Array<{ source: 'Card' | 'Journal'; text: string }>;
    }> = [];

    for (const m of maps) {
      const mapMatches =
        m.title.toLowerCase().includes(q) ||
        (m.intention || '').toLowerCase().includes(q) ||
        (m.encouragementTitle || '').toLowerCase().includes(q) ||
        (m.encouragementNote || '').toLowerCase().includes(q);

      const snippets: Array<{ source: 'Card' | 'Journal'; text: string }> = [];
      for (const n of indexedNodes) {
        if (n.mapId !== m.id) continue;
        if (
          n.text.toLowerCase().includes(q) ||
          (n.note || '').toLowerCase().includes(q) ||
          (n.theme || '').toLowerCase().includes(q)
        ) {
          snippets.push({ source: 'Card', text: n.text });
        }
      }
      for (const d of indexedDumps) {
        if (d.mapId !== m.id) continue;
        if (
          d.rawText.toLowerCase().includes(q) ||
          (d.moodWord || '').toLowerCase().includes(q)
        ) {
          snippets.push({ source: 'Journal', text: d.rawText });
        }
      }

      if (mapMatches || snippets.length > 0) {
        results.push({ map: m, snippets: snippets.slice(0, 2) });
      }
    }

    return results;
  }, [searchQuery, maps, searchIndex, activeNodes, activeDumps]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isCreating) return;
    setModalError(null);
    setIsCreating(true);
    try {
      await onCreateMap(title.trim(), intention.trim());
      setTitle('');
      setIntention('');
      onClose();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Unable to create sanctuary right now.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDelete = async (mapId: string) => {
    if (deletingId) return;
    setModalError(null);
    setDeletingId(mapId);
    try {
      await onDeleteMap(mapId);
      setConfirmDeleteId(null);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Unable to delete sanctuary right now.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = (format: 'md' | 'json') => {
    if (!activeMap) return;
    const bundle = {
      map: activeMap,
      nodes: activeNodes,
      edges: activeEdges,
      dumps: activeDumps,
      patterns: activePatterns,
    };
    if (format === 'md') {
      exportSanctuaryAsMarkdown(bundle);
    } else {
      exportSanctuaryAsJson(bundle);
    }
    setExportedFormat(format);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isImporting) return;

    setModalError(null);
    setIsImporting(true);
    try {
      const text = await file.text();
      const parsedBundle = parseImportedSanctuaryJson(text);
      await onImportBundle(parsedBundle);
      onClose();
    } catch (error) {
      setModalError(
        error instanceof Error ? error.message : 'Unable to import this Sanctuary file.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your Thinking Sanctuaries"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-[#2B2118]/35 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DDD1BD] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-medium text-[#2B2118]">
              Your Thinking Sanctuaries
            </h2>
            <p className="text-xs text-[#635345]">
              Switch between saved mind maps, export or import backups, or open a fresh clearing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-[#635345] hover:text-[#2B2118] rounded-md hover:bg-[#EFE8DA]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto calm-scroll">
          {modalError && (
            <p className="text-xs text-[#8F472B] bg-[#F7E9E2] border border-[#DFB6A5] rounded-md px-3 py-2">
              {modalError}
            </p>
          )}

          <div className="space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8C7A68] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search across all sanctuaries, cards, and journal entries..."
                className="w-full rounded-md border border-[#DDD1BD] bg-[#F4ECE0]/60 pl-8 pr-8 py-1.5 text-xs text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8C7A68] hover:text-[#2B2118]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {isIndexingSearch && searchQuery.trim().length >= 2 && (
              <p className="text-[11px] text-[#8C7A68]">Searching inside saved sanctuaries...</p>
            )}

            <div className="divide-y divide-[#DDD1BD] border border-[#DDD1BD] rounded-md">
              {filteredSanctuaries.length === 0 ? (
                <p className="px-4 py-5 text-center text-xs text-[#635345]">
                  No sanctuaries or thoughts matched &ldquo;{searchQuery.trim()}&rdquo;.
                </p>
              ) : (
                filteredSanctuaries.map(({ map: m, snippets }) => {
                  const isActive = m.id === activeMapId;
                  const isConfirming = confirmDeleteId === m.id;
                  const isDeleting = deletingId === m.id;

                  return (
                    <div
                      key={m.id}
                      className={`px-4 py-3 space-y-2 ${
                        isActive ? 'bg-[#E5EBE3]/65' : 'bg-[#FBF6EC]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectMap(m.id);
                            onClose();
                          }}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className="text-sm font-semibold text-[#2B2118] truncate">
                            {m.title}
                            {isActive && (
                              <span className="ml-2 text-xs font-normal text-[#5F735D]">
                                · Open now
                              </span>
                            )}
                          </p>
                          {m.intention && (
                            <p className="text-xs text-[#635345] truncate mt-0.5">
                              {m.intention}
                            </p>
                          )}
                          {snippets.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {snippets.map((snip, idx) => (
                                <p
                                  key={`${m.id}-snip-${idx}`}
                                  className="text-[11px] text-[#5F735D] truncate"
                                >
                                  <span className="font-medium">{snip.source}:</span> {snip.text}
                                </p>
                              ))}
                            </div>
                          )}
                        </button>

                        {maps.length > 1 && !isConfirming && (
                          <button
                            type="button"
                            disabled={Boolean(deletingId)}
                            onClick={() => setConfirmDeleteId(m.id)}
                            aria-label={`Delete ${m.title}`}
                            className="p-1.5 text-[#8C7A68] hover:text-[#B86B4B] rounded transition-colors shrink-0 disabled:opacity-40"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {isConfirming && (
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#DDD1BD]/70 text-[11px]">
                          <span className="text-[#635345]">
                            Remove this sanctuary and all its cards?
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 text-[#635345] hover:text-[#2B2118]"
                            >
                              Keep
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => void handleConfirmDelete(m.id)}
                              className="px-2.5 py-0.5 font-medium text-[#FBF6EC] bg-[#B86B4B] rounded hover:bg-[#9E593D] disabled:opacity-50"
                            >
                              {isDeleting ? 'Removing...' : 'Remove'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <form onSubmit={handleCreate} className="space-y-3 pt-2 border-t border-[#DDD1BD]">
            <h3 className="text-xs font-semibold text-[#2B2118]">
              Open a new sanctuary
            </h3>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={110}
              required
              placeholder="Title (e.g., Autumn Reset, Book Outline)"
              className="w-full rounded-md border border-[#DDD1BD] bg-[#F4ECE0]/60 px-3 py-2 text-sm text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none"
            />
            <input
              type="text"
              value={intention}
              onChange={(e) => setIntention(e.target.value)}
              maxLength={350}
              placeholder="Optional intention (e.g., Find breathing room around deadlines)"
              className="w-full rounded-md border border-[#DDD1BD] bg-[#F4ECE0]/60 px-3 py-2 text-xs text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!title.trim() || isCreating}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] disabled:opacity-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isCreating ? 'Creating...' : 'Create Sanctuary'}</span>
              </button>
            </div>
          </form>

          {/* Privacy Note, Export & Import */}
          <div className="rounded-md bg-[#F4ECE0] border border-[#DDD1BD] p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-[#5F735D] mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#2B2118]">
                  How your words &amp; voice are handled
                </p>
                <p className="text-xs leading-relaxed text-[#635345]">
                  Your Sanctuaries are private to you and never sold or used for ads. Voice notes are transcribed once into text and immediately discarded—never stored as audio recordings.
                </p>
                <p className="text-[11px] text-[#8C7A68]">
                  {isSignedIn
                    ? 'Synced privately to your Google account. Export or delete cleanly anytime.'
                    : 'Currently stored locally in this browser only. Export or delete cleanly anytime.'}
                </p>
              </div>
            </div>

            <div className="pt-2.5 border-t border-[#DDD1BD] flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-[#635345] truncate max-w-[180px]">
                {activeMap ? `Backup "${activeMap.title}"` : 'Portable backup'}
              </span>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void handleImportFile(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#5F735D] bg-[#FBF6EC] border border-[#DDD1BD] rounded hover:bg-[#EFE8DA] disabled:opacity-50 transition-colors"
                  title="Import a previously exported Sloww .json Sanctuary"
                >
                  <Upload className="w-3 h-3" />
                  <span>{isImporting ? 'Importing...' : 'Import JSON'}</span>
                </button>

                {activeMap && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleExport('md')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#2B2118] bg-[#FBF6EC] border border-[#DDD1BD] rounded hover:bg-[#EFE8DA] transition-colors"
                    >
                      {exportedFormat === 'md' ? (
                        <Check className="w-3 h-3 text-[#5F735D]" />
                      ) : (
                        <Download className="w-3 h-3 text-[#5F735D]" />
                      )}
                      <span>{exportedFormat === 'md' ? 'Exported .md' : 'Export Markdown'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport('json')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#2B2118] bg-[#FBF6EC] border border-[#DDD1BD] rounded hover:bg-[#EFE8DA] transition-colors"
                    >
                      {exportedFormat === 'json' ? (
                        <Check className="w-3 h-3 text-[#5F735D]" />
                      ) : (
                        <Download className="w-3 h-3 text-[#5F735D]" />
                      )}
                      <span>{exportedFormat === 'json' ? 'Exported .json' : 'Export JSON'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
