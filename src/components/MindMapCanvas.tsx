import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Feather,
  GitBranch,
  Heart,
  HelpCircle,
  Info,
  LayoutGrid,
  Link2,
  List,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Moon,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { MapEdge, MapNode, MindMap, NodeKind, PriorityTier } from '../types';
import { HEARTH_BOUNDS, NODE_HEIGHT, NODE_WIDTH } from '../lib/layout';
import { NodeInspectorPanel } from './NodeInspectorPanel';

interface MindMapCanvasProps {
  activeMap: MindMap;
  nodes: MapNode[];
  edges: MapEdge[];
  highlightedNodeIds: string[] | null;
  activePatternTitle: string | null;
  onClearPatternSpotlight: () => void;
  onUpdateMapDetails: (updates: { title?: string; intention?: string }) => Promise<void>;
  onCreateNode: (input: {
    text: string;
    note?: string;
    x: number;
    y: number;
    kind?: NodeKind;
    priorityTier?: PriorityTier;
    connectToNodeId?: string;
  }) => Promise<void>;
  onBranchNode: (parentNode: MapNode) => Promise<string | null>;
  onUpdateNode: (
    nodeId: string,
    updates: Partial<
      Pick<MapNode, 'text' | 'note' | 'kind' | 'theme' | 'priorityTier' | 'priorityOrder' | 'completed' | 'x' | 'y'>
    >
  ) => Promise<void>;
  onToggleComplete: (node: MapNode) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onCreateEdge: (fromId: string, toId: string, label?: string) => Promise<void>;
  onUpdateEdge: (edgeId: string, label: string) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onAutoArrange: () => Promise<void>;
}

const KIND_META: Record<NodeKind, { label: string; Icon: React.FC<{ className?: string }> }> = {
  anchor: { label: 'Anchor', Icon: Anchor },
  thought: { label: 'Thought', Icon: Feather },
  feeling: { label: 'Feeling', Icon: Heart },
  question: { label: 'Question', Icon: HelpCircle },
};

const TIER_LABEL: Record<PriorityTier, string> = {
  now: 'Today',
  next: 'Up Next',
  later: 'Later',
  none: 'Map Only',
};

const TIER_META: Record<PriorityTier, { label: string; hint: string }> = {
  now: { label: 'Today', hint: 'Pinned to Today in the Hearth as a top priority.' },
  next: { label: 'Up Next', hint: 'Queued under Up Next for after Today clears.' },
  later: { label: 'Later', hint: 'Saved under Later — parked gently without rush.' },
  none: { label: 'Map Only', hint: 'Stays as a visual card on the map (not a task).' },
};

const EDGE_LABELS = ['supports', 'grounds into', 'clarifies', 'tugs against', 'leads to'];
const PAN_SPEED = 1.35;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.15;

export const MindMapCanvas: React.FC<MindMapCanvasProps> = ({
  activeMap,
  nodes,
  edges,
  highlightedNodeIds,
  activePatternTitle,
  onClearPatternSpotlight,
  onUpdateMapDetails,
  onCreateNode,
  onBranchNode,
  onUpdateNode,
  onToggleComplete,
  onDeleteNode,
  onCreateEdge,
  onUpdateEdge,
  onDeleteEdge,
  onAutoArrange,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const minimapViewportRef = useRef<SVGRectElement | null>(null);

  const [pan, setPan] = useState({ x: 30, y: 20 });
  const [zoom, setZoom] = useState(0.95);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;

  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 640 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(activeMap.title);
  const [intentionDraft, setIntentionDraft] = useState(activeMap.intention || '');

  const [themeFilter, setThemeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [progressiveMode, setProgressiveMode] = useState(true);
  const [revealedNodeIds, setRevealedNodeIds] = useState<Set<string>>(() => new Set());
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(() => new Set());
  const [hearthCollapsed, setHearthCollapsed] = useState(false);
  const [hearthNextOpen, setHearthNextOpen] = useState(false);
  const [hearthLaterOpen, setHearthLaterOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [mapGuideOpen, setMapGuideOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'list' : 'canvas'
  );

  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [pendingLinkLabel, setPendingLinkLabel] = useState<string>('supports');

  const [editingEdge, setEditingEdge] = useState<{
    edge: MapEdge;
    x: number;
    y: number;
    labelDraft: string;
  } | null>(null);

  const [addingAt, setAddingAt] = useState<{ x: number; y: number } | null>(null);
  const [newNodeText, setNewNodeText] = useState('');
  const [newNodeNote, setNewNodeNote] = useState('');
  const [newNodeKind, setNewNodeKind] = useState<NodeKind>('thought');
  const [newNodeTier, setNewNodeTier] = useState<PriorityTier>('none');
  const [newNodeConnectTo, setNewNodeConnectTo] = useState<string>('');
  const [branchingNodeId, setBranchingNodeId] = useState<string | null>(null);

  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [hoveringHearth, setHoveringHearth] = useState(false);
  const dragStateRef = useRef<{
    type: 'node' | 'pan';
    nodeId?: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const activeTouchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);
  const panRafRef = useRef<number | null>(null);
  const nodeDragRafRef = useRef<number | null>(null);
  const pendingNodeDragRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);
  const latestNodeDragPosRef = useRef<Record<string, { x: number; y: number }>>({});

  const hasFittedMapRef = useRef<string | null>(null);

  const clampZoom = useCallback(
    (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(3)))),
    []
  );

  const applyZoom = useCallback(
    (targetZoom: number, anchorX?: number, anchorY?: number) => {
      const nextZoom = clampZoom(targetZoom);
      const currentZoom = zoomRef.current;
      if (nextZoom === currentZoom) return;

      const rect = viewportRef.current?.getBoundingClientRect();
      const pivotX = anchorX ?? (rect ? rect.width / 2 : viewportSize.width / 2);
      const pivotY = anchorY ?? (rect ? rect.height / 2 : viewportSize.height / 2);

      const currentPan = panRef.current;
      const worldX = (pivotX - currentPan.x) / currentZoom;
      const worldY = (pivotY - currentPan.y) / currentZoom;
      const nextPan = {
        x: Math.round(pivotX - worldX * nextZoom),
        y: Math.round(pivotY - worldY * nextZoom),
      };

      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    },
    [clampZoom, viewportSize.height, viewportSize.width]
  );

  const fitMapToViewport = useCallback(
    (targetNodes: MapNode[] = nodes) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 80 || rect.height < 80) return;

      let minX = HEARTH_BOUNDS.x;
      let minY = HEARTH_BOUNDS.y;
      let maxX = HEARTH_BOUNDS.x + HEARTH_BOUNDS.width;
      let maxY = HEARTH_BOUNDS.y + (hearthCollapsed ? 64 : HEARTH_BOUNDS.height);

      for (const n of targetNodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + NODE_WIDTH);
        maxY = Math.max(maxY, n.y + NODE_HEIGHT);
      }

      const padding = 44;
      const contentWidth = Math.max(320, maxX - minX);
      const contentHeight = Math.max(260, maxY - minY);

      const scaleX = (rect.width - padding * 2) / contentWidth;
      const scaleY = (rect.height - padding * 2) / contentHeight;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(0.95, Number(Math.min(scaleX, scaleY).toFixed(2))));

      const nextPanX = Math.round((rect.width - contentWidth * nextZoom) / 2 - minX * nextZoom);
      const nextPanY = Math.round((rect.height - contentHeight * nextZoom) / 2 - minY * nextZoom);

      zoomRef.current = nextZoom;
      panRef.current = { x: nextPanX, y: nextPanY };
      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
    },
    [nodes, hearthCollapsed]
  );

  useEffect(() => {
    setTitleDraft(activeMap.title);
    setIntentionDraft(activeMap.intention || '');
  }, [activeMap.title, activeMap.intention]);

  useEffect(() => {
    setSelectedNodeId(null);
    setConnectSourceId(null);
    setEditingEdge(null);
    setThemeFilter('all');
    setSearchQuery('');
    setRevealedNodeIds(new Set());
    setExpandedCardIds(new Set());
    setHearthNextOpen(false);
    setHearthLaterOpen(false);
    hasFittedMapRef.current = null;
  }, [activeMap.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingEdge) {
          setEditingEdge(null);
        } else if (addingAt) {
          setAddingAt(null);
        } else if (connectMode) {
          setConnectMode(false);
          setConnectSourceId(null);
        } else if (editingTitle) {
          setEditingTitle(false);
        } else if (selectedNodeId) {
          setSelectedNodeId(null);
        }
        return;
      }

      if (viewMode !== 'canvas') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        applyZoom(zoomRef.current + ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        applyZoom(zoomRef.current - ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        applyZoom(1);
      } else if (
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 50 : 20;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

        if (selectedNodeId) {
          const activeCard = nodes.find((n) => n.id === selectedNodeId);
          if (activeCard) {
            void onUpdateNode(activeCard.id, {
              x: Math.round(activeCard.x + dx),
              y: Math.round(activeCard.y + dy),
            });
            return;
          }
        }

        const nextPan = {
          x: panRef.current.x - dx * 2,
          y: panRef.current.y - dy * 2,
        };
        panRef.current = nextPan;
        setPan(nextPan);
      } else if (
        (e.key === 'c' || e.key === 'C') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        selectedNodeId
      ) {
        e.preventDefault();
        if (connectMode && connectSourceId && connectSourceId !== selectedNodeId) {
          void onCreateEdge(connectSourceId, selectedNodeId, pendingLinkLabel);
          setConnectMode(false);
          setConnectSourceId(null);
        } else {
          setConnectMode(true);
          setConnectSourceId(selectedNodeId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    addingAt,
    applyZoom,
    connectMode,
    connectSourceId,
    editingEdge,
    editingTitle,
    nodes,
    onCreateEdge,
    onUpdateNode,
    pendingLinkLabel,
    selectedNodeId,
    viewMode,
  ]);

  useEffect(() => {
    return () => {
      if (panRafRef.current !== null) window.cancelAnimationFrame(panRafRef.current);
      if (nodeDragRafRef.current !== null) window.cancelAnimationFrame(nodeDragRafRef.current);
    };
  }, []);

  const getNodeCoords = useCallback(
    (node: MapNode) => dragPositions[node.id] || { x: node.x, y: node.y },
    [dragPositions]
  );

  const availableThemes = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.theme && n.theme.trim()) set.add(n.theme.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  const priorityGroups = useMemo(() => {
    const sortFn = (a: MapNode, b: MapNode) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.priorityOrder - b.priorityOrder;
    };
    return {
      now: nodes.filter((n) => n.priorityTier === 'now').sort(sortFn),
      next: nodes.filter((n) => n.priorityTier === 'next').sort(sortFn),
      later: nodes.filter((n) => n.priorityTier === 'later').sort(sortFn),
    };
  }, [nodes]);

  const seenNodeIdsRef = useRef<Set<string>>(new Set());
  const initializedMapNodesRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedMapNodesRef.current !== activeMap.id) {
      seenNodeIdsRef.current = new Set(nodes.map((n) => n.id));
      if (nodes.length > 0) {
        initializedMapNodesRef.current = activeMap.id;
      }
      return;
    }

    const newlyAdded: string[] = [];
    for (const n of nodes) {
      if (!seenNodeIdsRef.current.has(n.id)) {
        seenNodeIdsRef.current.add(n.id);
        newlyAdded.push(n.id);
      }
    }
    if (newlyAdded.length > 0) {
      setRevealedNodeIds((prev) => {
        const next = new Set(prev);
        for (const id of newlyAdded) next.add(id);
        return next;
      });
    }
  }, [activeMap.id, nodes]);

  const visibleNodeIds = useMemo(() => {
    const queryLower = searchQuery.trim().toLowerCase();
    const hasFilter = themeFilter !== 'all' || queryLower.length > 0;
    if (!hasFilter) return null;

    const set = new Set<string>();
    for (const n of nodes) {
      const matchesTheme = themeFilter === 'all' || (n.theme || '').trim() === themeFilter;
      const matchesSearch =
        !queryLower ||
        n.text.toLowerCase().includes(queryLower) ||
        (n.note || '').toLowerCase().includes(queryLower) ||
        (n.theme || '').toLowerCase().includes(queryLower);

      if (matchesTheme && matchesSearch) {
        set.add(n.id);
      }
    }
    return set;
  }, [themeFilter, searchQuery, nodes]);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const baseAnchorIds = useMemo(() => {
    const anchors = new Set<string>();
    const nowNodes = nodes.filter((n) => n.priorityTier === 'now');
    if (nowNodes.length > 0) {
      for (const n of nowNodes) anchors.add(n.id);
    } else {
      const sorted = [...nodes].sort((a, b) => a.priorityOrder - b.priorityOrder);
      for (const n of sorted.slice(0, 2)) anchors.add(n.id);
    }
    return anchors;
  }, [nodes]);

  const hasActiveFilter = themeFilter !== 'all' || searchQuery.trim().length > 0;

  const effectiveRevealedIds = useMemo(() => {
    if (!progressiveMode || hasActiveFilter) {
      return new Set(nodes.map((n) => n.id));
    }
    const set = new Set<string>(baseAnchorIds);
    for (const id of revealedNodeIds) {
      if (nodesById.has(id)) set.add(id);
    }
    if (selectedNodeId && nodesById.has(selectedNodeId)) {
      set.add(selectedNodeId);
    }
    if (highlightedNodeIds) {
      for (const id of highlightedNodeIds) {
        if (nodesById.has(id)) set.add(id);
      }
    }
    return set;
  }, [
    progressiveMode,
    hasActiveFilter,
    nodes,
    baseAnchorIds,
    revealedNodeIds,
    nodesById,
    selectedNodeId,
    highlightedNodeIds,
  ]);

  const renderedNodes = useMemo(
    () => nodes.filter((n) => effectiveRevealedIds.has(n.id)),
    [nodes, effectiveRevealedIds]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateSizeAndFit = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width >= 80 && rect.height >= 80) {
        setViewportSize({ width: rect.width, height: rect.height });
        if (hasFittedMapRef.current !== activeMap.id) {
          fitMapToViewport(renderedNodes);
          if (nodes.length > 0) {
            hasFittedMapRef.current = activeMap.id;
          }
        }
      }
    };

    const raf = window.requestAnimationFrame(updateSizeAndFit);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSizeAndFit) : null;
    observer?.observe(viewport);

    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [activeMap.id, nodes.length, renderedNodes, fitMapToViewport]);

  const lastSpotlightKeyRef = useRef<string>('');
  useEffect(() => {
    const key = highlightedNodeIds ? highlightedNodeIds.join('|') : '';
    if (!key) {
      lastSpotlightKeyRef.current = '';
      return;
    }
    if (viewMode !== 'canvas' || key === lastSpotlightKeyRef.current) return;
    const spotlightNodes = nodes.filter((n) => highlightedNodeIds?.includes(n.id));
    if (spotlightNodes.length === 0) return;
    lastSpotlightKeyRef.current = key;
    const raf = window.requestAnimationFrame(() => {
      fitMapToViewport(spotlightNodes);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [highlightedNodeIds, viewMode, nodes, fitMapToViewport]);

  const unrevealedNodes = useMemo(() => {
    const rank: Record<PriorityTier, number> = { next: 0, now: 1, none: 2, later: 3 };
    return nodes
      .filter((n) => !effectiveRevealedIds.has(n.id))
      .sort((a, b) => rank[a.priorityTier] - rank[b.priorityTier] || a.priorityOrder - b.priorityOrder);
  }, [nodes, effectiveRevealedIds]);

  const neighborIdsByNode = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
      if (!nodesById.has(edge.fromId) || !nodesById.has(edge.toId)) continue;
      const fromList = map.get(edge.fromId) || [];
      if (!fromList.includes(edge.toId)) fromList.push(edge.toId);
      map.set(edge.fromId, fromList);

      const toList = map.get(edge.toId) || [];
      if (!toList.includes(edge.fromId)) toList.push(edge.fromId);
      map.set(edge.toId, toList);
    }
    return map;
  }, [edges, nodesById]);

  const revealNodeIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRevealedNodeIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const hideNodeIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRevealedNodeIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const toggleCardExpanded = useCallback((nodeId: string) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodesById.get(selectedNodeId) || null : null),
    [nodesById, selectedNodeId]
  );

  const connectedThreads = useMemo(() => {
    if (!selectedNodeId) return [];
    const threads: Array<{ edge: MapEdge; peerNode: MapNode }> = [];
    for (const edge of edges) {
      if (edge.fromId === selectedNodeId) {
        const peer = nodesById.get(edge.toId);
        if (peer) threads.push({ edge, peerNode: peer });
      } else if (edge.toId === selectedNodeId) {
        const peer = nodesById.get(edge.fromId);
        if (peer) threads.push({ edge, peerNode: peer });
      }
    }
    return threads;
  }, [selectedNodeId, edges, nodesById]);

  const availableTargetsForSelected = useMemo(() => {
    if (!selectedNodeId) return [];
    const linkedIds = new Set(connectedThreads.map((t) => t.peerNode.id));
    linkedIds.add(selectedNodeId);
    return nodes.filter((n) => !linkedIds.has(n.id));
  }, [selectedNodeId, connectedThreads, nodes]);

  const threadsByNode = useMemo(() => {
    const map = new Map<string, Array<{ edge: MapEdge; peerNode: MapNode }>>();
    for (const edge of edges) {
      const fromNode = nodesById.get(edge.fromId);
      const toNode = nodesById.get(edge.toId);
      if (!fromNode || !toNode) continue;

      const fromThreads = map.get(edge.fromId) || [];
      fromThreads.push({ edge, peerNode: toNode });
      map.set(edge.fromId, fromThreads);

      const toThreads = map.get(edge.toId) || [];
      toThreads.push({ edge, peerNode: fromNode });
      map.set(edge.toId, toThreads);
    }
    return map;
  }, [edges, nodesById]);

  const isPointInsideHearth = (x: number, y: number) => {
    const activeH = hearthCollapsed ? 52 : HEARTH_BOUNDS.height;
    const cx = x + NODE_WIDTH / 2;
    const cy = y + NODE_HEIGHT / 2;
    return (
      cx >= HEARTH_BOUNDS.x &&
      cx <= HEARTH_BOUNDS.x + HEARTH_BOUNDS.width &&
      cy >= HEARTH_BOUNDS.y &&
      cy <= HEARTH_BOUNDS.y + activeH
    );
  };

  const startPinchIfReady = () => {
    if (activeTouchPointersRef.current.size !== 2) return;
    const pts = Array.from(activeTouchPointersRef.current.values());
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const startDist = Math.hypot(dx, dy);
    if (startDist < 8) return;

    dragStateRef.current = null;
    pinchStateRef.current = {
      startDist,
      startZoom: zoomRef.current,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
      startMidX: (pts[0].x + pts[1].x) / 2 - rect.left,
      startMidY: (pts[0].y + pts[1].y) / 2 - rect.top,
    };
  };

  const handleViewportPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return;
    activeTouchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activeTouchPointersRef.current.size === 2) {
      startPinchIfReady();
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTouchPointersRef.current.size >= 2) {
      return;
    }
    if ((e.target as HTMLElement).closest('[data-canvas-interactive="true"]')) {
      return;
    }
    setEditingEdge(null);
    dragStateRef.current = {
      type: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: panRef.current.x,
      origY: panRef.current.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleNodePointerDown = (e: React.PointerEvent<HTMLDivElement>, node: MapNode) => {
    if (activeTouchPointersRef.current.size >= 2) return;
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;
    e.stopPropagation();
    setEditingEdge(null);

    if (connectMode) {
      if (!connectSourceId) {
        setConnectSourceId(node.id);
      } else if (connectSourceId === node.id) {
        setConnectSourceId(null);
      } else {
        void onCreateEdge(connectSourceId, node.id, pendingLinkLabel);
        setConnectSourceId(null);
        setConnectMode(false);
      }
      return;
    }

    const pos = getNodeCoords(node);
    dragStateRef.current = {
      type: 'node',
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && activeTouchPointersRef.current.has(e.pointerId)) {
      activeTouchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinchStateRef.current && activeTouchPointersRef.current.size >= 2) {
      const pts = Array.from(activeTouchPointersRef.current.values());
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const pinch = pinchStateRef.current;
        if (dist >= 8 && pinch.startDist >= 8) {
          const nextZoom = clampZoom(pinch.startZoom * (dist / pinch.startDist));
          const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
          const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
          const worldX = (pinch.startMidX - pinch.startPanX) / pinch.startZoom;
          const worldY = (pinch.startMidY - pinch.startPanY) / pinch.startZoom;
          const nextPan = {
            x: Math.round(midX - worldX * nextZoom),
            y: Math.round(midY - worldY * nextZoom),
          };
          zoomRef.current = nextZoom;
          panRef.current = nextPan;
          setZoom(nextZoom);
          setPan(nextPan);
        }
      }
      return;
    }

    const drag = dragStateRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
    }

    if (drag.type === 'pan') {
      const nextX = Math.round(drag.origX + dx * PAN_SPEED);
      const nextY = Math.round(drag.origY + dy * PAN_SPEED);
      panRef.current = { x: nextX, y: nextY };

      if (panRafRef.current === null) {
        panRafRef.current = window.requestAnimationFrame(() => {
          panRafRef.current = null;
          const p = panRef.current;
          const z = zoomRef.current;
          if (worldRef.current) {
            worldRef.current.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${z})`;
          }
          if (minimapViewportRef.current) {
            const m = minimapModelRef.current;
            minimapViewportRef.current.setAttribute('x', String(((-p.x / z) - m.minX) * m.scale));
            minimapViewportRef.current.setAttribute('y', String(((-p.y / z) - m.minY) * m.scale));
          }
        });
      }
    } else if (drag.type === 'node' && drag.nodeId) {
      const nodeId = drag.nodeId;
      const nextX = Math.round(drag.origX + dx / zoomRef.current);
      const nextY = Math.round(drag.origY + dy / zoomRef.current);
      latestNodeDragPosRef.current[nodeId] = { x: nextX, y: nextY };
      pendingNodeDragRef.current = { nodeId, x: nextX, y: nextY };

      if (nodeDragRafRef.current === null) {
        nodeDragRafRef.current = window.requestAnimationFrame(() => {
          nodeDragRafRef.current = null;
          const pending = pendingNodeDragRef.current;
          if (!pending) return;
          setDragPositions((prev) => ({
            ...prev,
            [pending.nodeId]: { x: pending.x, y: pending.y },
          }));
          const inside = isPointInsideHearth(pending.x, pending.y);
          setHoveringHearth((prev) => (prev === inside ? prev : inside));
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      activeTouchPointersRef.current.delete(e.pointerId);
      if (activeTouchPointersRef.current.size < 2) {
        pinchStateRef.current = null;
      }
    }

    const drag = dragStateRef.current;
    if (!drag) return;
    dragStateRef.current = null;
    setHoveringHearth(false);

    if (drag.type === 'pan') {
      if (panRafRef.current !== null) {
        window.cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      if (drag.moved) {
        if (worldRef.current) {
          worldRef.current.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoomRef.current})`;
        }
        setPan({ ...panRef.current });
      } else {
        setSelectedNodeId(null);
      }
    } else if (drag.type === 'node' && drag.nodeId) {
      if (nodeDragRafRef.current !== null) {
        window.cancelAnimationFrame(nodeDragRafRef.current);
        nodeDragRafRef.current = null;
      }
      pendingNodeDragRef.current = null;
      const finalPos = latestNodeDragPosRef.current[drag.nodeId] || dragPositions[drag.nodeId];
      delete latestNodeDragPosRef.current[drag.nodeId];

      if (drag.moved && finalPos) {
        const droppedInHearth = isPointInsideHearth(finalPos.x, finalPos.y);
        const node = nodesById.get(drag.nodeId);
        const savedPos = droppedInHearth
          ? {
              x:
                finalPos.x < HEARTH_BOUNDS.x + HEARTH_BOUNDS.width / 2
                  ? HEARTH_BOUNDS.x - 255
                  : HEARTH_BOUNDS.x + HEARTH_BOUNDS.width + 25,
              y: Math.max(100, finalPos.y),
            }
          : finalPos;

        setDragPositions((prev) => {
          const copy = { ...prev };
          delete copy[drag.nodeId!];
          return copy;
        });

        if (droppedInHearth && node && node.priorityTier !== 'now') {
          void onUpdateNode(drag.nodeId, {
            x: savedPos.x,
            y: savedPos.y,
            priorityTier: 'now',
            priorityOrder: priorityGroups.now.length + 1,
          });
        } else {
          void onUpdateNode(drag.nodeId, { x: savedPos.x, y: savedPos.y });
        }
      } else {
        setDragPositions((prev) => {
          const copy = { ...prev };
          delete copy[drag.nodeId!];
          return copy;
        });
        if (!drag.moved) {
          setSelectedNodeId(drag.nodeId);
        }
      }
    }

    try {
      if ((e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture release errors
    }
  };

  const openQuickAddAt = useCallback(
    (x: number, y: number) => {
      let safeX = x;
      let safeY = y;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect && viewMode === 'canvas') {
        const currentPan = panRef.current;
        const currentZoom = zoomRef.current;
        const popW = 308;
        const popH = nodes.length > 0 ? 445 : 385;
        const minWorldX = (12 - currentPan.x) / currentZoom;
        const maxWorldX = Math.max(minWorldX, (rect.width - popW * currentZoom - 12 - currentPan.x) / currentZoom);
        const minWorldY = (12 - currentPan.y) / currentZoom;
        const maxWorldY = Math.max(minWorldY, (rect.height - popH * currentZoom - 12 - currentPan.y) / currentZoom);
        safeX = Math.round(Math.max(minWorldX, Math.min(maxWorldX, x)));
        safeY = Math.round(Math.max(minWorldY, Math.min(maxWorldY, y)));
      }
      setAddingAt({ x: safeX, y: safeY });
      setNewNodeText('');
      setNewNodeNote('');
      setNewNodeKind('thought');
      setNewNodeTier('none');
      setNewNodeConnectTo(selectedNodeId || '');
    },
    [selectedNodeId, viewMode, nodes.length]
  );

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-canvas-interactive="true"]')) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = Math.round((e.clientX - rect.left - pan.x) / zoom - NODE_WIDTH / 2);
    const canvasY = Math.round((e.clientY - rect.top - pan.y) / zoom - 40);
    openQuickAddAt(canvasX, canvasY);
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-canvas-no-zoom="true"]') || target.closest('textarea, input, select')) {
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const delta = -e.deltaY * (e.ctrlKey ? 0.012 : 0.0022);
    if (Math.abs(delta) < 0.002) return;

    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    applyZoom(zoomRef.current + delta, pointerX, pointerY);
  };

  const focusNodeOnCanvas = (node: MapNode) => {
    revealNodeIds([node.id]);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) {
      const targetPanX = Math.round(rect.width / 2 - (node.x + NODE_WIDTH / 2) * zoom);
      const targetPanY = Math.round(rect.height / 2 - (node.y + NODE_HEIGHT / 2) * zoom);
      setPan({ x: targetPanX, y: targetPanY });
    }
    setSelectedNodeId(node.id);
  };

  const handleSaveMapHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleDraft.trim()) return;
    await onUpdateMapDetails({
      title: titleDraft.trim(),
      intention: intentionDraft.trim(),
    });
    setEditingTitle(false);
  };

  const submitQuickNode = async () => {
    if (!newNodeText.trim() || !addingAt) return;
    await onCreateNode({
      text: newNodeText.trim(),
      note: newNodeNote.trim() || undefined,
      x: addingAt.x,
      y: addingAt.y,
      kind: newNodeKind,
      priorityTier: newNodeTier,
      connectToNodeId: newNodeConnectTo || undefined,
    });
    setAddingAt(null);
    setNewNodeText('');
    setNewNodeNote('');
    setNewNodeKind('thought');
    setNewNodeTier('none');
    setNewNodeConnectTo('');
  };

  const handleCreateQuickNode = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitQuickNode();
  };

  const handleQuickBranch = async (node: MapNode) => {
    if (branchingNodeId) return;
    setBranchingNodeId(node.id);
    try {
      const createdId = await onBranchNode(node);
      if (createdId) {
        revealNodeIds([node.id, createdId]);
        setExpandedCardIds((prev) => new Set(prev).add(createdId));
        setSelectedNodeId(createdId);
      }
    } finally {
      setBranchingNodeId(null);
    }
  };

  const cyclePriorityTier = async (node: MapNode) => {
    const order: PriorityTier[] = ['now', 'next', 'later', 'none'];
    const nextTier = order[(order.indexOf(node.priorityTier) + 1) % order.length];
    await onUpdateNode(node.id, {
      priorityTier: nextTier,
      priorityOrder: nextTier === 'now' ? priorityGroups.now.length + 1 : node.priorityOrder,
    });
  };

  const handleReorderToday = async (index: number, direction: 'up' | 'down') => {
    const items = priorityGroups.now;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= items.length) return;

    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(swapIndex, 0, moved);

    await Promise.all(
      reordered.map((item, idx) => {
        const nextOrder = idx + 1;
        if (item.priorityOrder === nextOrder) return Promise.resolve();
        return onUpdateNode(item.id, { priorityOrder: nextOrder });
      })
    );
  };

  // Minimap coordinate bounds
  const minimapModel = useMemo(() => {
    let minX = HEARTH_BOUNDS.x;
    let minY = HEARTH_BOUNDS.y;
    let maxX = HEARTH_BOUNDS.x + HEARTH_BOUNDS.width;
    let maxY = HEARTH_BOUNDS.y + HEARTH_BOUNDS.height;

    for (const n of renderedNodes) {
      const pos = dragPositions[n.id] || { x: n.x, y: n.y };
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + NODE_WIDTH);
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
    }

    minX -= 120;
    minY -= 90;
    maxX += 120;
    maxY += 90;

    const worldW = Math.max(800, maxX - minX);
    const worldH = Math.max(600, maxY - minY);
    const boxW = 164;
    const boxH = 104;
    const scale = Math.min(boxW / worldW, boxH / worldH);

    return {
      minX,
      minY,
      worldW,
      worldH,
      boxW,
      boxH,
      scale,
      viewRect: {
        x: ((-pan.x / zoom) - minX) * scale,
        y: ((-pan.y / zoom) - minY) * scale,
        w: (viewportSize.width / zoom) * scale,
        h: (viewportSize.height / zoom) * scale,
      },
    };
  }, [renderedNodes, dragPositions, pan, zoom, viewportSize]);

  const minimapModelRef = useRef(minimapModel);
  minimapModelRef.current = minimapModel;

  const handleMinimapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const worldX = clickX / minimapModel.scale + minimapModel.minX;
    const worldY = clickY / minimapModel.scale + minimapModel.minY;
    setPan({
      x: Math.round(viewportSize.width / 2 - worldX * zoom),
      y: Math.round(viewportSize.height / 2 - worldY * zoom),
    });
  };

  const hearthCenterX = HEARTH_BOUNDS.x + HEARTH_BOUNDS.width / 2;
  const hearthCenterY = HEARTH_BOUNDS.y + (hearthCollapsed ? 28 : HEARTH_BOUNDS.height / 2);

  return (
    <section
      aria-label="Mind Map and Integrated Priorities"
      className="flex-1 flex flex-col min-w-0 h-full bg-[#F4ECE0] relative overflow-hidden"
    >
      {/* Compact Workspace Toolbar */}
      <div className="shrink-0 bg-[#FBF6EC] border-b border-[#DDD1BD] px-4 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 z-20">
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[200px] flex items-center gap-2">
          {editingTitle ? (
            <form onSubmit={handleSaveMapHeader} className="flex flex-wrap items-center gap-2 flex-1">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                maxLength={110}
                className="px-2.5 py-1 text-xs font-medium border border-[#5F735D] rounded bg-[#FBF6EC] text-[#2B2118] focus:outline-none"
                placeholder="Sanctuary title"
              />
              <input
                type="text"
                value={intentionDraft}
                onChange={(e) => setIntentionDraft(e.target.value)}
                maxLength={350}
                className="px-2.5 py-1 text-xs border border-[#DDD1BD] rounded bg-[#FBF6EC] text-[#635345] w-56 focus:outline-none focus:border-[#5F735D]"
                placeholder="Grounding intention..."
              />
              <button
                type="submit"
                className="px-2.5 py-1 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                className="px-2 py-1 text-xs text-[#635345] hover:text-[#2B2118]"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="text-left group min-w-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 focus-visible:outline-2 focus-visible:outline-[#5F735D]"
              >
                <h1 className="font-display text-base font-medium text-[#2B2118] leading-snug break-words">
                  {activeMap.title}
                </h1>
                <span className="hidden lg:inline text-[11px] text-[#8C7A68] truncate max-w-xs">
                  {activeMap.intention || 'Set intention'}
                </span>
                <Pencil className="w-3 h-3 text-[#8C7A68] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => setMapGuideOpen((v) => !v)}
                aria-expanded={mapGuideOpen}
                aria-label="How to use Mind Map"
                title="How to use Mind Map"
                className={`p-1 rounded-md border transition-colors shrink-0 ${
                  mapGuideOpen
                    ? 'bg-[#EFE8DA] border-[#5F735D]/50 text-[#5F735D]'
                    : 'bg-transparent border-transparent text-[#8C7A68] hover:text-[#2B2118] hover:bg-[#EFE8DA]'
                }`}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Rich Canvas Filter, Search & Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative hidden sm:block">
            <Search className="w-3 h-3 text-[#8C7A68] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter thoughts..."
              aria-label="Filter thoughts on map"
              className="pl-7 pr-6 py-1 w-32 focus:w-44 transition-all text-[11px] rounded-md border border-[#DDD1BD] bg-[#F4ECE0]/60 text-[#2B2118] placeholder:text-[#8C7A68] focus:bg-[#FBF6EC] focus:border-[#5F735D] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#8C7A68] hover:text-[#2B2118]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {availableThemes.length > 0 && (
            <select
              value={themeFilter}
              onChange={(e) => setThemeFilter(e.target.value)}
              aria-label="Filter by theme cluster"
              className="px-2 py-1 text-[11px] font-medium rounded-md border border-[#DDD1BD] bg-[#FBF6EC] text-[#635345] focus:border-[#5F735D] focus:outline-none max-w-[130px]"
            >
              <option value="all">All Themes</option>
              {availableThemes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}

          {/* Canvas vs List Mode Toggle */}
          <div className="flex items-center p-0.5 bg-[#E4DAC7] rounded-md border border-[#D4C6B0]">
            <button
              type="button"
              onClick={() => {
                hasFittedMapRef.current = null;
                setViewMode('canvas');
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'canvas'
                  ? 'bg-[#FBF6EC] text-[#2B2118] shadow-2xs'
                  : 'text-[#635345] hover:text-[#2B2118]'
              }`}
              title="Visual spatial mind map"
            >
              <LayoutGrid className="w-3 h-3" />
              <span>Canvas</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setConnectMode(false);
                setConnectSourceId(null);
                setViewMode('list');
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'list'
                  ? 'bg-[#FBF6EC] text-[#2B2118] shadow-2xs'
                  : 'text-[#635345] hover:text-[#2B2118]'
              }`}
              title="Calm linear card list (great on mobile)"
            >
              <List className="w-3 h-3" />
              <span>List</span>
            </button>
          </div>

          {viewMode === 'canvas' && (
            <div className="flex items-center p-0.5 bg-[#E4DAC7] rounded-md border border-[#D4C6B0]">
              <button
                type="button"
                onClick={() => {
                  setProgressiveMode(true);
                  setRevealedNodeIds(new Set());
                  setExpandedCardIds(new Set());
                }}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  progressiveMode
                    ? 'bg-[#FBF6EC] text-[#2B2118] shadow-2xs'
                    : 'text-[#635345] hover:text-[#2B2118]'
                }`}
                title="Show core focus and open branches one step at a time"
              >
                Step View
              </button>
              <button
                type="button"
                onClick={() => setProgressiveMode(false)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  !progressiveMode
                    ? 'bg-[#FBF6EC] text-[#2B2118] shadow-2xs'
                    : 'text-[#635345] hover:text-[#2B2118]'
                }`}
                title="Expand all thoughts and notes on the map"
              >
                Show All ({nodes.length})
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              const rect = viewportRef.current?.getBoundingClientRect();
              const targetX = rect
                ? Math.round((rect.width * 0.22 - pan.x) / zoom)
                : 80;
              const targetY = rect
                ? Math.round((Math.max(16, Math.min(rect.height * 0.14, rect.height - 445 * zoom)) - pan.y) / zoom)
                : 120;
              openQuickAddAt(targetX, targetY);
            }}
            title="Place a structured card directly onto the map"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#FBF6EC] bg-[#5F735D] rounded-md hover:bg-[#4E604C] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Card</span>
          </button>

          {viewMode === 'canvas' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setConnectMode((v) => !v);
                  setConnectSourceId(null);
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  connectMode
                    ? 'bg-[#F6EBDC] border-[#C48A47] text-[#94622A]'
                    : 'bg-[#FBF6EC] border-[#DDD1BD] text-[#635345] hover:bg-[#EFE8DA] hover:text-[#2B2118]'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>{connectMode ? 'Cancel Link' : 'Connect'}</span>
              </button>

              <button
                type="button"
                onClick={onAutoArrange}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#FBF6EC] border border-[#DDD1BD] text-[#635345] rounded-md hover:bg-[#EFE8DA] hover:text-[#2B2118] transition-colors whitespace-nowrap shrink-0"
                title="Gently arrange nodes around the Priority Hearth"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Arrange</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Contextual Banners: Connect Mode or Pattern Spotlight */}
      {(connectMode || activePatternTitle) && (
        <div className="shrink-0 px-4 py-1.5 bg-[#FBF6EC] border-b border-[#DDD1BD] flex flex-wrap items-center justify-between gap-3 text-xs z-20">
          {connectMode ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-[#94622A]">
                {connectSourceId
                  ? 'Now click a second thought card to weave a thread.'
                  : 'Click the first thought card to start a connection.'}
              </span>
              <div className="flex items-center gap-1.5 text-[#635345]">
                <span>Label:</span>
                {EDGE_LABELS.map((lbl) => (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => setPendingLinkLabel(lbl)}
                    className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                      pendingLinkLabel === lbl
                        ? 'bg-[#5F735D] text-[#FBF6EC] border-[#5F735D]'
                        : 'bg-[#FBF6EC] border-[#DDD1BD] text-[#635345] hover:bg-[#EFE8DA]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[#5F735D]">
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span>
                Spotlighting pattern: <strong className="font-semibold text-[#2B2118]">{activePatternTitle}</strong>
              </span>
            </div>
          )}

          {activePatternTitle && !connectMode && (
            <button
              type="button"
              onClick={onClearPatternSpotlight}
              className="text-xs font-medium text-[#635345] hover:text-[#2B2118] underline underline-offset-2"
            >
              Clear spotlight
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 relative flex flex-col">
        {/* Scrollable How to use Mind Map Guide (bounded to visible workspace height) */}
        {mapGuideOpen && (
          <div
            role="region"
            aria-label="How to use Mind Map"
            className="absolute inset-x-0 top-0 max-h-full overflow-y-auto calm-scroll overscroll-contain touch-pan-y px-4 py-3.5 bg-[#FBF6EC] border-b border-[#DDD1BD] shadow-md z-30"
          >
            <div className="max-w-5xl mx-auto flex flex-col gap-2.5 pb-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-sm font-medium text-[#2B2118]">
                  How to use Mind Map
                </p>
                <button
                  type="button"
                  onClick={() => setMapGuideOpen(false)}
                  aria-label="Close Mind Map guide"
                  className="p-1.5 text-[#8C7A68] hover:text-[#2B2118] rounded hover:bg-[#EFE8DA]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px] leading-relaxed text-[#635345]">
                <div className="rounded-md bg-[#F4ECE0]/70 border border-[#DDD1BD] px-3 py-2">
                  <p className="font-medium text-[#2B2118]">Add &amp; Edit Cards</p>
                  <p>Click <strong className="font-medium">Add Card</strong> or double-click empty paper to capture a thought. Click any card to edit or branch.</p>
                </div>
                <div className="rounded-md bg-[#F4ECE0]/70 border border-[#DDD1BD] px-3 py-2">
                  <p className="font-medium text-[#2B2118]">Move &amp; Zoom</p>
                  <p>Drag cards anywhere, drag empty space to pan, scroll or pinch to zoom, or use Arrow keys on a selected card.</p>
                </div>
                <div className="rounded-md bg-[#F4ECE0]/70 border border-[#DDD1BD] px-3 py-2">
                  <p className="font-medium text-[#2B2118]">Connect Threads</p>
                  <p>Click <strong className="font-medium">Connect</strong> (or press <span className="font-mono-tabular">C</span> on a card) and pick a second card to link related ideas.</p>
                </div>
                <div className="rounded-md bg-[#F4ECE0]/70 border border-[#DDD1BD] px-3 py-2">
                  <p className="font-medium text-[#2B2118]">Priority Hearth</p>
                  <p>Drop a card onto <strong className="font-medium">Priority Hearth</strong> (or set Today / Up Next / Later) to keep focus calm.</p>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* List View Fallback (Mobile-Default & Optional Linear View) */}
      {viewMode === 'list' ? (
        <div className="flex-1 min-h-0 overflow-y-auto calm-scroll bg-[#F4ECE0] px-4 py-5 sm:px-6 relative">
          <div className="max-w-3xl mx-auto space-y-5 pb-16">
            {/* Search bar for mobile viewports */}
            <div className="relative sm:hidden">
              <Search className="w-3.5 h-3.5 text-[#8C7A68] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cards..."
                aria-label="Search cards"
                className="w-full pl-8 pr-8 py-2 text-xs rounded-md border border-[#DDD1BD] bg-[#FBF6EC] text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:outline-none"
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

            {/* Linear Priority Hearth */}
            <div className="rounded-lg border border-[#CFC0A8] bg-[#FBF6EC] shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 bg-[#EFE8DA]/75 border-b border-[#DDD1BD] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Anchor className="w-4 h-4 text-[#C48A47]" />
                  <h2 className="font-display text-sm font-medium text-[#2B2118]">
                    Priority Hearth
                  </h2>
                </div>
                <span className="font-mono-tabular text-[11px] text-[#635345]">
                  {priorityGroups.now.filter((n) => !n.completed).length} active
                </span>
              </div>

              <div className="p-3.5 space-y-3 text-xs">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-[#94622A]">
                    <span>Today</span>
                    <span className="font-mono-tabular font-normal text-[#8C7A68]">
                      {priorityGroups.now.length}
                    </span>
                  </div>
                  {priorityGroups.now.length === 0 ? (
                    <p className="text-[11px] text-[#8C7A68] py-1 italic">
                      Tap any card&apos;s priority pill below and set it to Today to pin your focus.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {priorityGroups.now.map((node, idx) => (
                        <div
                          key={`list-now-${node.id}`}
                          className={`flex items-start gap-2.5 p-2.5 rounded border ${
                            node.completed
                              ? 'bg-[#EFE8DA] border-[#DDD1BD] opacity-75'
                              : 'bg-[#F6EBDC]/75 border-[#DEC29D]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void onToggleComplete(node)}
                            aria-label={node.completed ? 'Mark incomplete' : 'Mark complete'}
                            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              node.completed
                                ? 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]'
                                : 'border-[#C48A47] bg-[#FBF6EC]'
                            }`}
                          >
                            {node.completed && <Check className="w-3 h-3" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedNodeId(node.id)}
                            className={`flex-1 text-left leading-snug ${
                              node.completed ? 'line-through text-[#8C7A68]' : 'text-[#2B2118] font-medium'
                            }`}
                          >
                            <span className="font-mono-tabular text-[10px] text-[#94622A] mr-1.5">
                              #{String(idx + 1).padStart(2, '0')}
                            </span>
                            {node.text}
                          </button>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {priorityGroups.now.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => void handleReorderToday(idx, 'up')}
                                  aria-label={`Move ${node.text} up in Today`}
                                  title="Move up"
                                  className="p-0.5 text-[#8C7A68] hover:text-[#2B2118] disabled:opacity-25 rounded hover:bg-[#EFE8DA]"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === priorityGroups.now.length - 1}
                                  onClick={() => void handleReorderToday(idx, 'down')}
                                  aria-label={`Move ${node.text} down in Today`}
                                  title="Move down"
                                  className="p-0.5 text-[#8C7A68] hover:text-[#2B2118] disabled:opacity-25 rounded hover:bg-[#EFE8DA]"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => void onUpdateNode(node.id, { priorityTier: 'next' })}
                              className="text-[11px] text-[#635345] hover:text-[#2B2118] px-1.5 py-0.5 rounded hover:bg-[#EFE8DA] shrink-0"
                            >
                              Up Next
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Up Next (Collapsible) */}
                <div className="pt-2 border-t border-[#DDD1BD]">
                  <button
                    type="button"
                    onClick={() => setHearthNextOpen((v) => !v)}
                    className="w-full flex items-center justify-between text-[11px] font-semibold text-[#5F735D] py-1"
                  >
                    <span>Up Next</span>
                    <span className="inline-flex items-center gap-1 font-mono-tabular font-normal text-[#8C7A68]">
                      <span>{priorityGroups.next.length}</span>
                      {hearthNextOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                  {hearthNextOpen && (
                    <div className="mt-1.5 space-y-1">
                      {priorityGroups.next.length === 0 ? (
                        <p className="text-[11px] text-[#8C7A68]">No queued steps yet.</p>
                      ) : (
                        priorityGroups.next.map((node) => (
                          <div
                            key={`list-next-${node.id}`}
                            className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-[#EFE8DA]/70"
                          >
                            <button
                              type="button"
                              onClick={() => void onToggleComplete(node)}
                              aria-label={node.completed ? 'Mark incomplete' : 'Mark complete'}
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                node.completed
                                  ? 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]'
                                  : 'border-[#635345] bg-[#FBF6EC]'
                              }`}
                            >
                              {node.completed && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`flex-1 text-left leading-snug ${
                                node.completed ? 'line-through text-[#8C7A68]' : 'text-[#2B2118]'
                              }`}
                            >
                              {node.text}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateNode(node.id, {
                                  priorityTier: 'now',
                                  priorityOrder: priorityGroups.now.length + 1,
                                })
                              }
                              title="Move to Today"
                              className="p-1 text-[#635345] hover:text-[#C48A47] shrink-0"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Later (Collapsible) */}
                {priorityGroups.later.length > 0 && (
                  <div className="pt-2 border-t border-[#DDD1BD]">
                    <button
                      type="button"
                      onClick={() => setHearthLaterOpen((v) => !v)}
                      className="w-full flex items-center justify-between text-[11px] font-medium text-[#B86B4B] py-1"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Moon className="w-3 h-3" />
                        Later
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono-tabular text-[#8C7A68]">
                        <span>{priorityGroups.later.length}</span>
                        {hearthLaterOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                    {hearthLaterOpen && (
                      <div className="mt-1.5 space-y-1">
                        {priorityGroups.later.map((node) => (
                          <div
                            key={`list-later-${node.id}`}
                            className="flex items-center justify-between gap-2 py-1 text-[#635345]"
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`text-left flex-1 ${
                                node.completed ? 'line-through text-[#8C7A68]' : ''
                              }`}
                            >
                              {node.text}
                            </button>
                            <button
                              type="button"
                              onClick={() => void onUpdateNode(node.id, { priorityTier: 'next' })}
                              className="text-[11px] text-[#5F735D] hover:underline shrink-0"
                            >
                              Wake
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* All Cards */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-medium text-[#2B2118]">
                  Map Cards ({nodes.filter((n) => !visibleNodeIds || visibleNodeIds.has(n.id)).length})
                </h2>
                <button
                  type="button"
                  onClick={() => openQuickAddAt(140, 240)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#5F735D] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Card</span>
                </button>
              </div>

              {nodes.filter((n) => !visibleNodeIds || visibleNodeIds.has(n.id)).length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#DDD1BD] bg-[#FBF6EC]/70 p-6 text-center space-y-2">
                  <p className="text-sm text-[#635345]">No matching cards here.</p>
                  <p className="text-xs text-[#8C7A68]">
                    Tap Add Card or write thoughts in your Journal.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {nodes
                    .filter((n) => !visibleNodeIds || visibleNodeIds.has(n.id))
                    .map((node) => {
                      const meta = KIND_META[node.kind] || KIND_META.thought;
                      const KindIcon = meta.Icon;
                      const isDimmedByPattern =
                        highlightedNodeIds !== null && !highlightedNodeIds.includes(node.id);
                      const cardThreads = threadsByNode.get(node.id) || [];

                      return (
                        <div
                          key={`list-card-${node.id}`}
                          className={`rounded-lg border bg-[#FBF6EC] p-3.5 space-y-2 ${
                            node.priorityTier === 'now' ? 'border-[#DEC29D]' : 'border-[#DDD1BD]'
                          } ${isDimmedByPattern ? 'opacity-40' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-[#8C7A68]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <KindIcon
                                className={`w-3 h-3 shrink-0 ${
                                  node.kind === 'feeling'
                                    ? 'text-[#B86B4B]'
                                    : node.kind === 'anchor'
                                      ? 'text-[#C48A47]'
                                      : 'text-[#5F735D]'
                                }`}
                              />
                              <span className="font-medium text-[#635345]">{meta.label}</span>
                              {node.theme && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="truncate">{node.theme}</span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => setSelectedNodeId(node.id)}
                                aria-label="Edit card"
                                className="p-1 text-[#8C7A68] hover:text-[#2B2118]"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void onDeleteNode(node.id)}
                                aria-label="Remove card"
                                className="p-1 text-[#8C7A68] hover:text-[#B86B4B]"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-start gap-2.5">
                            {node.priorityTier !== 'none' && (
                              <button
                                type="button"
                                onClick={() => void onToggleComplete(node)}
                                aria-label={node.completed ? 'Mark incomplete' : 'Mark complete'}
                                className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  node.completed
                                    ? 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]'
                                    : 'border-[#8C7A68] bg-[#FBF6EC]'
                                }`}
                              >
                                {node.completed && <Check className="w-2.5 h-2.5" />}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`flex-1 text-left text-sm font-medium leading-snug ${
                                node.completed ? 'line-through text-[#8C7A68]' : 'text-[#2B2118]'
                              }`}
                            >
                              {node.text}
                            </button>
                          </div>

                          {node.note && (
                            <p className="text-xs text-[#635345] leading-relaxed">{node.note}</p>
                          )}

                          {cardThreads.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {cardThreads.map(({ edge, peerNode }) => (
                                <button
                                  key={`list-thread-${node.id}-${edge.id}`}
                                  type="button"
                                  onClick={() => setSelectedNodeId(node.id)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#F4ECE0] border border-[#DDD1BD] text-[10px] text-[#635345] hover:border-[#5F735D] max-w-full"
                                >
                                  <Link2 className="w-2.5 h-2.5 text-[#5F735D] shrink-0" />
                                  <span className="text-[#8C7A68] shrink-0">
                                    {edge.label || 'connects to'}:
                                  </span>
                                  <span className="text-[#2B2118] truncate max-w-[160px]">
                                    {peerNode.text}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="pt-2 border-t border-[#EFE8DA] flex items-center justify-between gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => void cyclePriorityTier(node)}
                              className={`font-medium hover:underline ${
                                node.priorityTier === 'now'
                                  ? 'text-[#94622A]'
                                  : node.priorityTier === 'next'
                                    ? 'text-[#5F735D]'
                                    : node.priorityTier === 'later'
                                      ? 'text-[#B86B4B]'
                                      : 'text-[#8C7A68]'
                              }`}
                            >
                              Priority: {TIER_LABEL[node.priorityTier]}
                            </button>

                            <button
                              type="button"
                              onClick={() => setSelectedNodeId(node.id)}
                              className="inline-flex items-center gap-1 text-[#5F735D] hover:underline font-medium"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>
                                {cardThreads.length > 0
                                  ? `${cardThreads.length} ${cardThreads.length === 1 ? 'thread' : 'threads'}`
                                  : 'Connect'}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Modal Add-Card Dialog when in List View */}
          {addingAt && (
            <div
              onClick={(e) => {
                if (e.target === e.currentTarget) setAddingAt(null);
              }}
              className="fixed inset-0 z-40 bg-[#2B2118]/35 flex items-center justify-center p-4"
            >
              <form
                onSubmit={handleCreateQuickNode}
                className="w-full max-w-sm bg-[#FBF6EC] border border-[#5F735D] rounded-lg p-4 shadow-xl space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#2B2118]">Place a card on the map</p>
                    <p className="text-[11px] text-[#8C7A68] leading-snug mt-0.5">
                      Add a specific step, anchor, or link directly to your Sanctuary.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddingAt(null)}
                    aria-label="Close add card dialog"
                    className="text-[#8C7A68] hover:text-[#2B2118] p-0.5"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <textarea
                    autoFocus
                    rows={2}
                    value={newNodeText}
                    onChange={(e) => setNewNodeText(e.target.value)}
                    maxLength={500}
                    placeholder="Card title or concrete step..."
                    className="w-full rounded border border-[#DDD1BD] bg-[#F4ECE0]/60 px-2.5 py-1.5 text-xs text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none resize-none"
                  />
                  <input
                    type="text"
                    value={newNodeNote}
                    onChange={(e) => setNewNodeNote(e.target.value)}
                    maxLength={500}
                    placeholder="Optional detail or context note..."
                    className="w-full rounded border border-[#DDD1BD] bg-[#F4ECE0]/40 px-2.5 py-1.5 text-xs text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-[#635345]">Card type</p>
                  <div className="grid grid-cols-4 gap-1 text-[11px]">
                    {(['thought', 'anchor', 'feeling', 'question'] as NodeKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setNewNodeKind(k)}
                        className={`px-1.5 py-1.5 rounded border text-center transition-colors ${
                          newNodeKind === k
                            ? 'bg-[#EFE8DA] text-[#2B2118] border-[#C48A47] font-medium'
                            : 'bg-[#FBF6EC] text-[#635345] border-[#DDD1BD]'
                        }`}
                      >
                        {KIND_META[k].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-[#635345]">Where should this sit?</p>
                  <div className="grid grid-cols-4 gap-1 text-[11px]">
                    {(['now', 'next', 'later', 'none'] as PriorityTier[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setNewNodeTier(t)}
                        className={`px-1.5 py-1.5 rounded border text-center transition-colors whitespace-nowrap ${
                          newNodeTier === t
                            ? 'bg-[#5F735D] text-[#FBF6EC] border-[#5F735D] font-medium'
                            : 'bg-[#FBF6EC] text-[#635345] border-[#DDD1BD]'
                        }`}
                      >
                        {TIER_META[t].label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#8C7A68] leading-snug pt-0.5">
                    {TIER_META[newNodeTier].hint}
                  </p>
                </div>

                {nodes.length > 0 && (
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-[#635345]">
                      Connect to existing card (optional)
                    </label>
                    <select
                      value={newNodeConnectTo}
                      onChange={(e) => setNewNodeConnectTo(e.target.value)}
                      className="w-full rounded border border-[#DDD1BD] bg-[#FBF6EC] px-2 py-1.5 text-xs text-[#2B2118] focus:border-[#5F735D] focus:outline-none"
                    >
                      <option value="">Standalone card (no link yet)</option>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.text.length > 42 ? `${n.text.slice(0, 42)}…` : n.text}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setAddingAt(null)}
                    className="px-3 py-1.5 text-xs text-[#635345] hover:text-[#2B2118]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newNodeText.trim()}
                    className="px-3.5 py-1.5 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C] disabled:opacity-50"
                  >
                    Add Card
                  </button>
                </div>
              </form>
            </div>
          )}

          {selectedNode && (
            <NodeInspectorPanel
              node={selectedNode}
              connectedThreads={connectedThreads}
              availableTargets={availableTargetsForSelected}
              onSave={async (id, updates) => {
                await onUpdateNode(id, updates);
              }}
              onDelete={async (id) => {
                await onDeleteNode(id);
                setSelectedNodeId(null);
              }}
              onCreateEdge={onCreateEdge}
              onUpdateEdge={onUpdateEdge}
              onDeleteEdge={onDeleteEdge}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </div>
      ) : (
      /* Full-Viewport Spatial Canvas */
      <div
        ref={viewportRef}
        onPointerDownCapture={handleViewportPointerDownCapture}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleCanvasDoubleClick}
        onWheel={handleCanvasWheel}
        className="flex-1 min-h-0 relative paper-grid overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <div className="pointer-events-none absolute bottom-3 left-4 z-10 text-[11px] text-[#8C7A68] bg-[#F4ECE0]/95 px-2.5 py-1 rounded border border-[#DDD1BD] hidden sm:block">
          Drag to pan · Scroll or pinch to zoom · Drag card into Hearth to focus · Double-click to add
        </div>

        {hasActiveFilter && visibleNodeIds && visibleNodeIds.size === 0 && nodes.length > 0 && (
          <div
            data-canvas-interactive="true"
            role="status"
            className="absolute top-5 left-1/2 -translate-x-1/2 z-20 bg-[#FBF6EC]/95 border border-[#DDD1BD] rounded-lg px-4 py-2.5 shadow-sm flex items-center gap-3 text-xs text-[#635345]"
          >
            <span>No thoughts match your current filter.</span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setThemeFilter('all');
              }}
              className="px-2.5 py-1 rounded bg-[#EFE8DA] hover:bg-[#E4DAC7] text-[#2B2118] font-medium transition-colors whitespace-nowrap"
            >
              Clear filter
            </button>
          </div>
        )}

        {/* Floating Bottom-Right Minimap & Zoom Controls */}
        <div
          data-canvas-interactive="true"
          data-canvas-no-zoom="true"
          className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2"
        >
          {minimapOpen && (
            <div className="bg-[#FBF6EC]/95 border border-[#DDD1BD] rounded-lg p-1.5 shadow-sm">
              <svg
                width={minimapModel.boxW}
                height={minimapModel.boxH}
                onClick={handleMinimapClick}
                className="cursor-pointer block rounded bg-[#F4ECE0]/70"
                role="img"
                aria-label="Mind map overview minimap"
              >
                {/* Minimap Hearth */}
                <rect
                  x={(HEARTH_BOUNDS.x - minimapModel.minX) * minimapModel.scale}
                  y={(HEARTH_BOUNDS.y - minimapModel.minY) * minimapModel.scale}
                  width={HEARTH_BOUNDS.width * minimapModel.scale}
                  height={(hearthCollapsed ? 52 : HEARTH_BOUNDS.height) * minimapModel.scale}
                  rx={2}
                  fill="#EFE8DA"
                  stroke="#C48A47"
                  strokeWidth={1}
                />
                {/* Minimap Nodes */}
                {renderedNodes.map((n) => {
                  const pos = getNodeCoords(n);
                  return (
                    <rect
                      key={`mini-${n.id}`}
                      x={(pos.x - minimapModel.minX) * minimapModel.scale}
                      y={(pos.y - minimapModel.minY) * minimapModel.scale}
                      width={Math.max(4, NODE_WIDTH * minimapModel.scale)}
                      height={Math.max(3, NODE_HEIGHT * minimapModel.scale)}
                      rx={1.5}
                      fill={
                        n.priorityTier === 'now'
                          ? '#C48A47'
                          : n.completed
                            ? '#8C7A68'
                            : '#5F735D'
                      }
                      opacity={0.8}
                    />
                  );
                })}
                {/* Current Viewport Indicator */}
                <rect
                  ref={minimapViewportRef}
                  x={minimapModel.viewRect.x}
                  y={minimapModel.viewRect.y}
                  width={Math.max(8, minimapModel.viewRect.w)}
                  height={Math.max(8, minimapModel.viewRect.h)}
                  fill="none"
                  stroke="#2B2118"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
              </svg>
            </div>
          )}

          <div className="flex items-center border border-[#DDD1BD] bg-[#FBF6EC]/95 rounded-md shadow-xs">
            <button
              type="button"
              onClick={() => setMinimapOpen((v) => !v)}
              aria-label={minimapOpen ? 'Hide minimap' : 'Show minimap'}
              title={minimapOpen ? 'Hide minimap' : 'Show minimap'}
              className={`p-1.5 border-r border-[#DDD1BD] transition-colors ${
                minimapOpen ? 'text-[#5F735D]' : 'text-[#8C7A68] hover:text-[#2B2118]'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyZoom(zoomRef.current - ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM + 0.005}
              aria-label="Zoom out"
              title="Zoom out (-)"
              className="p-2 text-[#635345] hover:text-[#2B2118] hover:bg-[#EFE8DA] disabled:opacity-40 transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyZoom(1)}
              aria-label="Reset zoom to 100%"
              title="Reset zoom to 100% (0)"
              className="px-2 py-1 font-mono-tabular text-[11px] text-[#635345] hover:text-[#2B2118] hover:bg-[#EFE8DA] transition-colors select-none min-w-[46px]"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => applyZoom(zoomRef.current + ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM - 0.005}
              aria-label="Zoom in"
              title="Zoom in (+)"
              className="p-2 text-[#635345] hover:text-[#2B2118] hover:bg-[#EFE8DA] disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => fitMapToViewport(renderedNodes)}
              aria-label="Fit map to screen"
              title="Fit open thoughts in view"
              className="p-2 border-l border-[#DDD1BD] text-[#635345] hover:text-[#2B2118] hover:bg-[#EFE8DA] transition-colors"
            >
              <LocateFixed className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Transformed Canvas World */}
        <div
          ref={worldRef}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
          className="absolute left-0 top-0 w-0 h-0 overflow-visible pointer-events-none will-change-transform"
        >
          {/* SVG Threads Layer */}
          <svg
            width="4000"
            height="3000"
            className="absolute -left-[1000px] -top-[1000px] pointer-events-none overflow-visible"
          >
            <g transform="translate(1000, 1000)">
              {/* Priority Hearth threads */}
              {renderedNodes
                .filter((n) => n.priorityTier !== 'none')
                .map((n) => {
                  const pos = getNodeCoords(n);
                  const nx = pos.x + NODE_WIDTH / 2;
                  const ny = pos.y + NODE_HEIGHT / 2;
                  const dimmed =
                    (highlightedNodeIds && !highlightedNodeIds.includes(n.id)) ||
                    (visibleNodeIds && !visibleNodeIds.has(n.id));

                  const stroke =
                    n.priorityTier === 'now'
                      ? '#C48A47'
                      : n.priorityTier === 'next'
                        ? '#5F735D'
                        : '#B86B4B';

                  const ctrlX = (hearthCenterX + nx) / 2;
                  const ctrlY = Math.min(hearthCenterY, ny) - 45;

                  return (
                    <path
                      key={`prio-thread-${n.id}`}
                      d={`M ${hearthCenterX} ${hearthCenterY} Q ${ctrlX} ${ctrlY} ${nx} ${ny}`}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={n.priorityTier === 'now' ? 2 : 1.5}
                      strokeDasharray="5 5"
                      opacity={dimmed ? 0.14 : n.completed ? 0.25 : 0.6}
                    />
                  );
                })}

              {/* Associative mind map edges */}
              {edges.map((edge) => {
                if (!effectiveRevealedIds.has(edge.fromId) || !effectiveRevealedIds.has(edge.toId)) {
                  return null;
                }
                const fromNode = nodesById.get(edge.fromId);
                const toNode = nodesById.get(edge.toId);
                if (!fromNode || !toNode) return null;

                const fromPos = getNodeCoords(fromNode);
                const toPos = getNodeCoords(toNode);
                const x1 = fromPos.x + NODE_WIDTH / 2;
                const y1 = fromPos.y + NODE_HEIGHT / 2;
                const x2 = toPos.x + NODE_WIDTH / 2;
                const y2 = toPos.y + NODE_HEIGHT / 2;

                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2 - 28;
                const labelX = (x1 + 2 * midX + x2) / 4;
                const labelY = (y1 + 2 * midY + y2) / 4;

                const dimmed =
                  (highlightedNodeIds &&
                    (!highlightedNodeIds.includes(edge.fromId) ||
                      !highlightedNodeIds.includes(edge.toId))) ||
                  (visibleNodeIds &&
                    (!visibleNodeIds.has(edge.fromId) || !visibleNodeIds.has(edge.toId)));

                return (
                  <g key={edge.id} opacity={dimmed ? 0.18 : 0.88}>
                    <path
                      d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
                      fill="none"
                      stroke="#8C7A68"
                      strokeWidth={1.6}
                    />
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`Edit connection: ${edge.label || 'connects to'}`}
                      transform={`translate(${labelX}, ${labelY})`}
                      className="pointer-events-auto cursor-pointer group/edge"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setEditingEdge({
                          edge,
                          x: labelX,
                          y: labelY,
                          labelDraft: edge.label || 'supports',
                        });
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          ev.stopPropagation();
                          setEditingEdge({
                            edge,
                            x: labelX,
                            y: labelY,
                            labelDraft: edge.label || 'supports',
                          });
                        }
                      }}
                    >
                      <title>Click to rename or remove thread</title>
                      <rect
                        x={-48}
                        y={-11}
                        width={96}
                        height={22}
                        rx={4}
                        fill="#FBF6EC"
                        stroke="#DDD1BD"
                        className="group-hover/edge:stroke-[#5F735D] transition-colors"
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize="10"
                        fill="#635345"
                        className="font-sans group-hover/edge:fill-[#2B2118] transition-colors"
                      >
                        {(edge.label || 'thread').slice(0, 14)}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* INTEGRATED PRIORITY HEARTH (Collapsible) */}
          <div
            data-canvas-interactive="true"
            style={{
              left: HEARTH_BOUNDS.x,
              top: HEARTH_BOUNDS.y,
              width: HEARTH_BOUNDS.width,
            }}
            className={`pointer-events-auto absolute rounded-lg border bg-[#FBF6EC] transition-colors shadow-sm flex flex-col ${
              hoveringHearth
                ? 'border-[#C48A47] ring-2 ring-[#C48A47]/30 bg-[#F6EBDC]'
                : 'border-[#CFC0A8]'
            }`}
          >
            <div
              className={`px-4 py-2.5 flex items-center justify-between gap-2 bg-[#EFE8DA]/75 ${
                hearthCollapsed ? 'rounded-lg' : 'border-b border-[#DDD1BD] rounded-t-lg'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Anchor className="w-4 h-4 text-[#C48A47] shrink-0" />
                <h2 className="font-display text-sm font-medium text-[#2B2118] truncate">
                  Priority Hearth
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono-tabular text-[11px] text-[#635345]">
                  {priorityGroups.now.filter((n) => !n.completed).length} active
                </span>
                <button
                  type="button"
                  onClick={() => setHearthCollapsed((v) => !v)}
                  aria-label={hearthCollapsed ? 'Expand Priority Hearth' : 'Collapse Priority Hearth'}
                  title={hearthCollapsed ? 'Expand Priority Hearth' : 'Collapse Priority Hearth'}
                  className="p-0.5 text-[#635345] hover:text-[#2B2118] rounded hover:bg-[#E4DAC7] transition-colors"
                >
                  {hearthCollapsed ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {!hearthCollapsed && (
              <div className="p-3.5 space-y-3 text-xs">
                {/* Today (Now) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-[#94622A]">
                    <span>Today</span>
                    <span className="font-mono-tabular font-normal text-[#8C7A68]">
                      {priorityGroups.now.length}
                    </span>
                  </div>
                  {priorityGroups.now.length === 0 ? (
                    <p className="text-[11px] text-[#8C7A68] py-1 italic">
                      Drag any card here or mark it as Today to pin your focus.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {priorityGroups.now.map((node, idx) => (
                        <div
                          key={node.id}
                          className={`flex items-start gap-2 p-2 rounded border transition-colors ${
                            node.completed
                              ? 'bg-[#EFE8DA] border-[#DDD1BD] opacity-70'
                              : 'bg-[#F6EBDC]/75 border-[#DEC29D]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void onToggleComplete(node)}
                            aria-label={node.completed ? 'Mark incomplete' : 'Mark complete'}
                            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              node.completed
                                ? 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]'
                                : 'border-[#C48A47] bg-[#FBF6EC] hover:bg-[#F6EBDC]'
                            }`}
                          >
                            {node.completed && <Check className="w-3 h-3" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => focusNodeOnCanvas(node)}
                            className={`flex-1 text-left leading-snug ${
                              node.completed ? 'line-through text-[#8C7A68]' : 'text-[#2B2118] font-medium'
                            }`}
                          >
                            <span className="font-mono-tabular text-[10px] text-[#94622A] mr-1.5">
                              #{String(idx + 1).padStart(2, '0')}
                            </span>
                            {node.text}
                          </button>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {priorityGroups.now.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => void handleReorderToday(idx, 'up')}
                                  aria-label={`Move ${node.text} up in Today`}
                                  title="Move up"
                                  className="p-0.5 text-[#8C7A68] hover:text-[#2B2118] disabled:opacity-25 rounded hover:bg-[#EFE8DA]"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === priorityGroups.now.length - 1}
                                  onClick={() => void handleReorderToday(idx, 'down')}
                                  aria-label={`Move ${node.text} down in Today`}
                                  title="Move down"
                                  className="p-0.5 text-[#8C7A68] hover:text-[#2B2118] disabled:opacity-25 rounded hover:bg-[#EFE8DA]"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => void onUpdateNode(node.id, { priorityTier: 'next' })}
                              title="Move to Up Next"
                              className="text-[10px] text-[#8C7A68] hover:text-[#2B2118] px-1 py-0.5 shrink-0"
                            >
                              Up Next
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Up Next (Collapsible) */}
                <div className="pt-2 border-t border-[#DDD1BD]">
                  <button
                    type="button"
                    onClick={() => setHearthNextOpen((v) => !v)}
                    className="w-full flex items-center justify-between text-[11px] font-semibold text-[#5F735D] hover:text-[#2B2118] py-0.5"
                  >
                    <span>Up Next</span>
                    <span className="inline-flex items-center gap-1 font-mono-tabular font-normal text-[#8C7A68]">
                      <span>{priorityGroups.next.length}</span>
                      {hearthNextOpen ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </button>
                  {hearthNextOpen && (
                    <div className="mt-1.5 space-y-1">
                      {priorityGroups.next.length === 0 ? (
                        <p className="text-[11px] text-[#8C7A68]">No queued steps yet.</p>
                      ) : (
                        priorityGroups.next.map((node) => (
                          <div
                            key={node.id}
                            className="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-[#EFE8DA]/70 transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => void onToggleComplete(node)}
                              aria-label={node.completed ? 'Mark incomplete' : 'Mark complete'}
                              className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                node.completed
                                  ? 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]'
                                  : 'border-[#635345] bg-[#FBF6EC]'
                              }`}
                            >
                              {node.completed && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => focusNodeOnCanvas(node)}
                              className={`flex-1 text-left leading-snug ${
                                node.completed ? 'line-through text-[#8C7A68]' : 'text-[#2B2118]'
                              }`}
                            >
                              {node.text}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void onUpdateNode(node.id, {
                                  priorityTier: 'now',
                                  priorityOrder: priorityGroups.now.length + 1,
                                })
                              }
                              title="Move to Today"
                              className="p-0.5 text-[#635345] hover:text-[#C48A47] shrink-0"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Later (Collapsible) */}
                {priorityGroups.later.length > 0 && (
                  <div className="pt-2 border-t border-[#DDD1BD]">
                    <button
                      type="button"
                      onClick={() => setHearthLaterOpen((v) => !v)}
                      className="w-full flex items-center justify-between text-[11px] font-medium text-[#B86B4B] hover:text-[#2B2118] py-0.5"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Moon className="w-3 h-3" />
                        Later
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono-tabular text-[#8C7A68]">
                        <span>{priorityGroups.later.length}</span>
                        {hearthLaterOpen ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </span>
                    </button>
                    {hearthLaterOpen && (
                      <div className="mt-1.5 space-y-1">
                        {priorityGroups.later.map((node) => (
                          <div key={node.id} className="flex items-center justify-between gap-2 py-0.5 text-[#635345]">
                            <button
                              type="button"
                              onClick={() => focusNodeOnCanvas(node)}
                              className={`text-left truncate flex-1 hover:text-[#2B2118] ${
                                node.completed ? 'line-through text-[#8C7A68]' : ''
                              }`}
                            >
                              {node.text}
                            </button>
                            <button
                              type="button"
                              onClick={() => void onUpdateNode(node.id, { priorityTier: 'next' })}
                              className="text-[10px] text-[#5F735D] hover:underline shrink-0"
                            >
                              Wake
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Step-by-Step Reveal Control inside Hearth */}
                {progressiveMode && unrevealedNodes.length > 0 && (
                  <div className="pt-2 border-t border-[#DDD1BD] flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => revealNodeIds([unrevealedNodes[0].id])}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5F735D] hover:text-[#2B2118] transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Reveal next step ({unrevealedNodes.length} tucked)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProgressiveMode(false)}
                      className="text-[10px] text-[#8C7A68] hover:text-[#2B2118] underline underline-offset-2"
                    >
                      Show all
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Floating Mind Map Thought Cards */}
          {renderedNodes.map((node) => {
            const pos = getNodeCoords(node);
            const meta = KIND_META[node.kind] || KIND_META.thought;
            const KindIcon = meta.Icon;

            const isSelected = selectedNodeId === node.id;
            const isConnectSource = connectSourceId === node.id;
            const isDimmedByPattern =
              highlightedNodeIds !== null && !highlightedNodeIds.includes(node.id);
            const isDimmedByFilter =
              visibleNodeIds !== null && !visibleNodeIds.has(node.id);
            const isDimmed = isDimmedByPattern || isDimmedByFilter;

            const neighbors = neighborIdsByNode.get(node.id) || [];
            const hiddenNeighbors = progressiveMode
              ? neighbors.filter((id) => !effectiveRevealedIds.has(id))
              : [];
            const tuckableNeighbors = progressiveMode
              ? neighbors.filter((id) => !baseAnchorIds.has(id) && revealedNodeIds.has(id))
              : [];

            const isCardExpanded = !progressiveMode || expandedCardIds.has(node.id) || isSelected;

            const borderStyle = isConnectSource
              ? 'border-[#C48A47] ring-2 ring-[#C48A47]/30'
              : isSelected
                ? 'border-[#5F735D] ring-2 ring-[#5F735D]/25'
                : node.priorityTier === 'now'
                  ? 'border-[#DEC29D]'
                  : 'border-[#DDD1BD]';

            return (
              <div
                key={node.id}
                tabIndex={0}
                aria-label={`${meta.label}: ${node.text}`}
                data-canvas-interactive="true"
                onFocus={() => {
                  if (!connectMode) {
                    setSelectedNodeId(node.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (connectMode) {
                      if (!connectSourceId) {
                        setConnectSourceId(node.id);
                      } else if (connectSourceId === node.id) {
                        setConnectSourceId(null);
                      } else {
                        void onCreateEdge(connectSourceId, node.id, pendingLinkLabel);
                        setConnectSourceId(null);
                        setConnectMode(false);
                      }
                    } else {
                      setSelectedNodeId(node.id);
                    }
                  }
                }}
                onPointerDown={(e) => handleNodePointerDown(e, node)}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: NODE_WIDTH,
                }}
                className={`group pointer-events-auto absolute rounded-lg border bg-[#FBF6EC] p-3.5 shadow-xs cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F735D] transition-opacity ${borderStyle} ${
                  isDimmed ? 'opacity-30' : 'opacity-100'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#8C7A68] mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <KindIcon
                      className={`w-3 h-3 shrink-0 ${
                        node.kind === 'feeling'
                          ? 'text-[#B86B4B]'
                          : node.kind === 'anchor'
                            ? 'text-[#C48A47]'
                            : 'text-[#5F735D]'
                      }`}
                    />
                    <span className="font-medium text-[#635345]">{meta.label}</span>
                    {node.theme && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{node.theme}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {progressiveMode && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCardExpanded(node.id);
                        }}
                        aria-label={isCardExpanded ? 'Collapse card details' : 'Expand card details'}
                        title={isCardExpanded ? 'Collapse details' : 'Expand details'}
                        className="p-0.5 text-[#8C7A68] hover:text-[#2B2118] transition-colors"
                      >
                        {isCardExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteNode(node.id);
                      }}
                      aria-label="Remove thought"
                      className="opacity-65 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 p-0.5 text-[#8C7A68] hover:text-[#B86B4B] transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <p
                  className={`text-sm leading-snug font-medium break-words ${
                    node.completed ? 'line-through text-[#8C7A68]' : 'text-[#2B2118]'
                  }`}
                >
                  {node.text}
                </p>

                {isCardExpanded && node.note && (
                  <p className="mt-1.5 text-xs leading-relaxed text-[#635345] line-clamp-2">
                    {node.note}
                  </p>
                )}

                <div className="mt-2.5 pt-2 border-t border-[#EFE8DA] flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {node.priorityTier !== 'none' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onToggleComplete(node);
                        }}
                        aria-label={node.completed ? 'Mark incomplete' : 'Mark complete'}
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          node.completed
                            ? 'bg-[#5F735D] border-[#5F735D] text-[#FBF6EC]'
                            : 'border-[#8C7A68] bg-[#FBF6EC]'
                        }`}
                      >
                        {node.completed && <Check className="w-2.5 h-2.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void cyclePriorityTier(node);
                      }}
                      className={`font-medium truncate hover:underline ${
                        node.priorityTier === 'now'
                          ? 'text-[#94622A]'
                          : node.priorityTier === 'next'
                            ? 'text-[#5F735D]'
                            : node.priorityTier === 'later'
                              ? 'text-[#B86B4B]'
                              : 'text-[#8C7A68]'
                      }`}
                      title="Click to cycle priority: Today → Up Next → Later → Map Only"
                    >
                      {node.priorityTier === 'none' ? 'Map Only' : TIER_LABEL[node.priorityTier]}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-[#8C7A68]">
                    {hiddenNeighbors.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          revealNodeIds(hiddenNeighbors);
                        }}
                        title="Open connected thoughts one step further"
                        className="px-1.5 py-0.5 rounded bg-[#EFE8DA] text-[#5F735D] hover:bg-[#E4DAC7] hover:text-[#2B2118] font-medium transition-colors"
                      >
                        +{hiddenNeighbors.length} {hiddenNeighbors.length === 1 ? 'step' : 'steps'}
                      </button>
                    )}
                    {hiddenNeighbors.length === 0 && tuckableNeighbors.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          hideNodeIds(tuckableNeighbors);
                        }}
                        title="Collapse connected branch back away"
                        className="px-1.5 py-0.5 rounded text-[#8C7A68] hover:bg-[#EFE8DA] hover:text-[#2B2118] transition-colors"
                      >
                        − Tuck
                      </button>
                    )}

                    {isCardExpanded && (
                      <>
                        <button
                          type="button"
                          disabled={branchingNodeId === node.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleQuickBranch(node);
                          }}
                          title="Branch a connected child thought"
                          className="hover:text-[#5F735D] disabled:opacity-40 transition-colors"
                        >
                          <GitBranch className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnectMode(true);
                            setConnectSourceId(node.id);
                          }}
                          title="Connect to another thought"
                          className="hover:text-[#5F735D] transition-colors"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNodeId(node.id);
                          }}
                          title="Edit thought"
                          className="hover:text-[#2B2118] transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Edge Label Editor Popover */}
          {editingEdge && (
            <form
              data-canvas-interactive="true"
              onSubmit={(e) => {
                e.preventDefault();
                void onUpdateEdge(editingEdge.edge.id, editingEdge.labelDraft).then(() => {
                  setEditingEdge(null);
                });
              }}
              style={{ left: editingEdge.x - 110, top: editingEdge.y - 68, width: 224 }}
              className="pointer-events-auto absolute z-30 bg-[#FBF6EC] border border-[#5F735D] rounded-lg p-3 shadow-md space-y-2"
            >
              <div className="flex items-center justify-between text-[11px] font-medium text-[#2B2118]">
                <span>Thread relationship</span>
                <button
                  type="button"
                  onClick={() => setEditingEdge(null)}
                  className="text-[#8C7A68] hover:text-[#2B2118]"
                  aria-label="Close thread editor"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                autoFocus
                value={editingEdge.labelDraft}
                onChange={(e) =>
                  setEditingEdge((prev) =>
                    prev ? { ...prev, labelDraft: e.target.value } : null
                  )
                }
                maxLength={70}
                className="w-full rounded border border-[#DDD1BD] bg-[#F4ECE0]/60 px-2 py-1 text-xs text-[#2B2118] focus:border-[#5F735D] focus:outline-none"
              />
              <div className="flex flex-wrap gap-1">
                {EDGE_LABELS.map((lbl) => (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() =>
                      setEditingEdge((prev) => (prev ? { ...prev, labelDraft: lbl } : null))
                    }
                    className="px-1.5 py-0.5 text-[10px] rounded bg-[#EFE8DA] text-[#635345] hover:text-[#2B2118]"
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    void onDeleteEdge(editingEdge.edge.id).then(() => {
                      setEditingEdge(null);
                    });
                  }}
                  className="text-[11px] text-[#B86B4B] hover:underline"
                >
                  Remove thread
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-1 text-[11px] font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C]"
                >
                  Save
                </button>
              </div>
            </form>
          )}

          {/* Inline Quick-Add Card Popover on Canvas */}
          {addingAt && (
            <form
              data-canvas-interactive="true"
              data-canvas-no-zoom="true"
              onSubmit={handleCreateQuickNode}
              style={{ left: addingAt.x, top: addingAt.y, width: 300 }}
              className="pointer-events-auto absolute z-30 bg-[#FBF6EC] border border-[#5F735D] rounded-lg p-3.5 shadow-md space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-[#2B2118]">Place a card on the map</p>
                  <p className="text-[10px] text-[#8C7A68] leading-snug mt-0.5">
                    Add a specific step, anchor, or link directly onto the canvas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAddingAt(null)}
                  aria-label="Close add card dialog"
                  className="text-[#8C7A68] hover:text-[#2B2118] p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-2">
                <textarea
                  autoFocus
                  rows={2}
                  value={newNodeText}
                  onChange={(e) => setNewNodeText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && newNodeText.trim() && addingAt) {
                      e.preventDefault();
                      void submitQuickNode();
                    }
                  }}
                  maxLength={500}
                  placeholder="Card title or concrete step..."
                  className="w-full rounded border border-[#DDD1BD] bg-[#F4ECE0]/60 px-2.5 py-1.5 text-xs text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none resize-none"
                />

                <input
                  type="text"
                  value={newNodeNote}
                  onChange={(e) => setNewNodeNote(e.target.value)}
                  maxLength={500}
                  placeholder="Optional detail or context note..."
                  className="w-full rounded border border-[#DDD1BD] bg-[#F4ECE0]/40 px-2.5 py-1 text-[11px] text-[#2B2118] placeholder:text-[#8C7A68] focus:border-[#5F735D] focus:bg-[#FBF6EC] focus:outline-none"
                />
              </div>

              {/* Card Type */}
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-[#635345]">Card type</p>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  {(['thought', 'anchor', 'feeling', 'question'] as NodeKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setNewNodeKind(k)}
                      className={`px-1.5 py-1 rounded border text-center transition-colors ${
                        newNodeKind === k
                          ? 'bg-[#EFE8DA] text-[#2B2118] border-[#C48A47] font-medium'
                          : 'bg-[#FBF6EC] text-[#635345] border-[#DDD1BD] hover:bg-[#F4ECE0]'
                      }`}
                    >
                      {KIND_META[k].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority in Hearth */}
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-[#635345]">Where should this sit?</p>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  {(['now', 'next', 'later', 'none'] as PriorityTier[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewNodeTier(t)}
                      className={`px-1.5 py-1 rounded border text-center transition-colors whitespace-nowrap ${
                        newNodeTier === t
                          ? 'bg-[#5F735D] text-[#FBF6EC] border-[#5F735D] font-medium'
                          : 'bg-[#FBF6EC] text-[#635345] border-[#DDD1BD] hover:bg-[#F4ECE0]'
                      }`}
                    >
                      {TIER_META[t].label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#8C7A68] leading-snug pt-0.5">
                  {TIER_META[newNodeTier].hint}
                </p>
              </div>

              {/* Optional Thread Connection */}
              {nodes.length > 0 && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-medium text-[#635345]">
                    Connect to existing card (optional)
                  </label>
                  <select
                    value={newNodeConnectTo}
                    onChange={(e) => setNewNodeConnectTo(e.target.value)}
                    className="w-full rounded border border-[#DDD1BD] bg-[#FBF6EC] px-2 py-1 text-[11px] text-[#2B2118] focus:border-[#5F735D] focus:outline-none"
                  >
                    <option value="">Standalone card (no link yet)</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.text.length > 42 ? `${n.text.slice(0, 42)}…` : n.text}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAddingAt(null)}
                  className="px-2.5 py-1 text-xs text-[#635345] hover:text-[#2B2118]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newNodeText.trim()}
                  className="px-3 py-1 text-xs font-medium text-[#FBF6EC] bg-[#5F735D] rounded hover:bg-[#4E604C] disabled:opacity-50"
                >
                  Add Card
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Node Inspector Drawer */}
        {selectedNode && (
          <NodeInspectorPanel
            node={selectedNode}
            connectedThreads={connectedThreads}
            availableTargets={availableTargetsForSelected}
            onSave={async (id, updates) => {
              await onUpdateNode(id, updates);
            }}
            onDelete={async (id) => {
              await onDeleteNode(id);
              setSelectedNodeId(null);
            }}
            onCreateEdge={onCreateEdge}
            onUpdateEdge={onUpdateEdge}
            onDeleteEdge={onDeleteEdge}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
      )}
      </div>
    </section>
  );
};
