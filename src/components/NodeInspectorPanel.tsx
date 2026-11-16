import React, { useEffect, useState } from 'react';
import { Check, Link2, Trash2, X } from 'lucide-react';
import type { MapEdge, MapNode, NodeKind, PriorityTier } from '../types';

interface NodeInspectorPanelProps {
  node: MapNode;
  connectedThreads?: Array<{ edge: MapEdge; peerNode: MapNode }>;
  availableTargets?: MapNode[];
  onSave: (
    nodeId: string,
    updates: {
      text: string;
      note: string;
      kind: NodeKind;
      theme: string;
      priorityTier: PriorityTier;
      completed: boolean;
    }
  ) => Promise<void>;
  onDelete: (nodeId: string) => Promise<void>;
  onCreateEdge?: (fromId: string, toId: string, label?: string) => Promise<void>;
  onUpdateEdge?: (edgeId: string, label: string) => Promise<void>;
  onDeleteEdge?: (edgeId: string) => Promise<void>;
  onClose: () => void;
}

const KIND_OPTIONS: Array<{ value: NodeKind; label: string }> = [
  { value: 'thought', label: 'Thought' },
  { value: 'anchor', label: 'Anchor' },
  { value: 'feeling', label: 'Feeling' },
  { value: 'question', label: 'Question' },
];

const TIER_OPTIONS: Array<{ value: PriorityTier; label: string; hint: string }> = [
  { value: 'now', label: 'Today', hint: 'Pinned to Today in your Hearth as a top focus.' },
  { value: 'next', label: 'Up Next', hint: 'Queued in the Hearth for after Today clears.' },
  { value: 'later', label: 'Later', hint: 'Parked gently under Later with zero rush.' },
  { value: 'none', label: 'Map Only', hint: 'Visual card on the map only — not a task.' },
];

const THREAD_LABELS = ['supports', 'grounds into', 'clarifies', 'tugs against', 'leads to'];

export const NodeInspectorPanel: React.FC<NodeInspectorPanelProps> = ({
  node,
  connectedThreads = [],
  availableTargets = [],
  onSave,
  onDelete,
  onCreateEdge,
  onUpdateEdge,
  onDeleteEdge,
  onClose,
}) => {
  const [text, setText] = useState(node.text);
  const [note, setNote] = useState(node.note || '');
  const [kind, setKind] = useState<NodeKind>(node.kind);
  const [theme, setTheme] = useState(node.theme || '');
  const [priorityTier, setPriorityTier] = useState<PriorityTier>(node.priorityTier);
  const [completed, setCompleted] = useState(node.completed);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newTargetId, setNewTargetId] = useState('');
  const [newThreadLabel, setNewThreadLabel] = useState('supports');
  const [isLinking, setIsLinking] = useState(false);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [edgeLabelDraft, setEdgeLabelDraft] = useState('');

  useEffect(() => {
    setText(node.text);
    setNote(node.note || '');
    setKind(node.kind);
    setTheme(node.theme || '');
    setPriorityTier(node.priorityTier);
    setCompleted(node.completed);
    setSaveError(null);
    setNewTargetId('');
    setEditingEdgeId(null);
  }, [node]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSaving || isDeleting) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      await onSave(node.id, {
        text: text.trim(),
        note: note.trim(),
        kind,
        theme: theme.trim(),
        priorityTier,
        completed,
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNode = async () => {
    if (isSaving || isDeleting) return;
    setSaveError(null);
    setIsDeleting(true);
    try {
      await onDelete(node.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not remove thought.');
      setIsDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Edit Mind Map Node"
      className="absolute right-4 top-4 bottom-4 w-[320px] max-w-[calc(100%-2rem)] z-30 bg-[#FBF6EC] border border-[#DDD1BD] rounded-lg shadow-lg flex flex-col"
    >
      <div className="px-4 py-3.5 border-b border-[#DDD1BD] flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-medium text-[#2B2118]">
          Refine Thought
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="p-1.5 text-[#635345] hover:text-[#2B2118] rounded-md hover:bg-[#EFE8DA] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto calm-scroll p-4 space-y-4">
        {saveError && (
          <p className="text-xs text-[#8F472B] bg-[#F7E9E2] border border-[#DFB6A5] rounded-md px-3 py-2">
            {saveError}
          </p>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[#635345]">Thought or Step</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={580}
            required
            className="w-full rounded-md border border-[#DDD1BD] bg-[#F4ECE0]/60 px-3 py-2 text-sm text-[#2B2118] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[#635345]">Quiet Context / Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1100}
            placeholder="Why does this matter? What makes it gentle?"
            className="w-full rounded-md border border-[#DDD1BD] bg-[#F4ECE0]/60 px-3 py-2 text-xs leading-relaxed text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[#635345]">Priority in Hearth</label>
          <div className="grid grid-cols-2 gap-1.5">
            {TIER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPriorityTier(opt.value)}
                className={`px-2.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                  priorityTier === opt.value
                    ? 'bg-[#5F735D] text-[#FBF6EC] border-[#5F735D]'
                    : 'bg-[#FBF6EC] text-[#635345] border-[#DDD1BD] hover:bg-[#EFE8DA]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#8C7A68] leading-snug">
            {TIER_OPTIONS.find((opt) => opt.value === priorityTier)?.hint}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[#635345]">Nature</label>
          <div className="grid grid-cols-2 gap-1.5">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setKind(opt.value)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                  kind === opt.value
                    ? 'bg-[#EFE8DA] text-[#2B2118] border-[#C48A47]'
                    : 'bg-[#FBF6EC] text-[#635345] border-[#DDD1BD] hover:bg-[#F4ECE0]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[#635345]">Theme Cluster</label>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            maxLength={75}
            placeholder="e.g., Creative Focus, Rest & Pacing"
            className="w-full rounded-md border border-[#DDD1BD] bg-[#FBF6EC] px-3 py-1.5 text-xs text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
          <button
            type="button"
            role="checkbox"
            aria-checked={completed}
            onClick={() => setCompleted((v) => !v)}
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              completed
                ? 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]'
                : 'border-[#8C7A68] bg-[#FBF6EC]'
            }`}
          >
            {completed && <Check className="w-3 h-3" />}
          </button>
          <span className="text-xs font-medium text-[#2B2118]">Mark as gently completed</span>
        </label>

        {(connectedThreads.length > 0 || (onCreateEdge && availableTargets.length > 0)) && (
          <div className="pt-2 border-t border-[#DDD1BD] space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#635345]">
              <Link2 className="w-3.5 h-3.5 text-[#5F735D]" />
              <span>Connected Threads ({connectedThreads.length})</span>
            </div>

            {connectedThreads.length > 0 && (
              <div className="space-y-1.5">
                {connectedThreads.map(({ edge, peerNode }) => {
                  const isEditingThisEdge = editingEdgeId === edge.id;
                  return (
                    <div
                      key={edge.id}
                      className="px-2.5 py-1.5 rounded bg-[#F4ECE0]/80 border border-[#DDD1BD] text-[11px] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {onUpdateEdge ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditingThisEdge) {
                                  setEditingEdgeId(null);
                                } else {
                                  setEditingEdgeId(edge.id);
                                  setEdgeLabelDraft(edge.label || 'supports');
                                }
                              }}
                              title="Click to relabel thread"
                              className="text-[#5F735D] hover:underline font-medium mr-1"
                            >
                              {edge.label || 'connects to'}:
                            </button>
                          ) : (
                            edge.label && (
                              <span className="text-[#8C7A68] mr-1">{edge.label}:</span>
                            )
                          )}
                          <span className="text-[#2B2118] truncate inline-block align-bottom max-w-[175px]">
                            {peerNode.text}
                          </span>
                        </div>
                        {onDeleteEdge && (
                          <button
                            type="button"
                            onClick={() => void onDeleteEdge(edge.id)}
                            aria-label={`Remove thread to ${peerNode.text}`}
                            title="Remove thread"
                            className="p-0.5 text-[#8C7A68] hover:text-[#B86B4B] shrink-0"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {isEditingThisEdge && onUpdateEdge && (
                        <div className="flex items-center gap-1.5 pt-1 border-t border-[#DDD1BD]/70">
                          <input
                            type="text"
                            value={edgeLabelDraft}
                            onChange={(e) => setEdgeLabelDraft(e.target.value)}
                            maxLength={60}
                            placeholder="supports, clarifies..."
                            className="flex-1 min-w-0 rounded border border-[#DDD1BD] bg-[#FBF6EC] px-2 py-1 text-[11px] text-[#2B2118] focus:border-[#5F735D] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void onUpdateEdge(edge.id, edgeLabelDraft.trim() || 'connects to');
                              setEditingEdgeId(null);
                            }}
                            className="px-2 py-1 text-[10px] font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C] shrink-0"
                          >
                            Set
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {onCreateEdge && availableTargets.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-[#8C7A68]">Link to another card</p>
                <div className="flex items-center gap-1.5">
                  <select
                    value={newThreadLabel}
                    onChange={(e) => setNewThreadLabel(e.target.value)}
                    aria-label="Thread relationship"
                    className="w-28 shrink-0 rounded border border-[#DDD1BD] bg-[#FBF6EC] px-1.5 py-1 text-[11px] text-[#2B2118] focus:border-[#5F735D] focus:outline-none"
                  >
                    {THREAD_LABELS.map((lbl) => (
                      <option key={lbl} value={lbl}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newTargetId}
                    onChange={(e) => setNewTargetId(e.target.value)}
                    aria-label="Card to connect"
                    className="flex-1 min-w-0 rounded border border-[#DDD1BD] bg-[#FBF6EC] px-1.5 py-1 text-[11px] text-[#2B2118] focus:border-[#5F735D] focus:outline-none"
                  >
                    <option value="">Choose a card...</option>
                    {availableTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.text.length > 36 ? `${target.text.slice(0, 36)}…` : target.text}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!newTargetId || isLinking}
                    onClick={async () => {
                      if (!newTargetId || isLinking) return;
                      setIsLinking(true);
                      try {
                        await onCreateEdge(node.id, newTargetId, newThreadLabel);
                        setNewTargetId('');
                      } finally {
                        setIsLinking(false);
                      }
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C] disabled:opacity-45 shrink-0"
                  >
                    Link
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-[#DDD1BD] flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={isSaving || isDeleting}
            onClick={() => void handleDeleteNode()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#B86B4B] hover:bg-[#F7E9E2] rounded-md disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isDeleting ? 'Removing...' : 'Remove'}</span>
          </button>

          <button
            type="submit"
            disabled={!text.trim() || isSaving || isDeleting}
            className="px-4 py-2 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};
