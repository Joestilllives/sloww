import type { BrainDump, MapEdge, MapNode, MindMap, PatternInsight } from '../types';
import { buildStarterSanctuaryBundle } from './starterMap';

const STORAGE_KEY = 'stillpoint_guest_sandbox_v1';

export interface GuestSandboxState {
  activeMapId: string;
  maps: MindMap[];
  nodes: MapNode[];
  edges: MapEdge[];
  dumps: BrainDump[];
  patterns: PatternInsight[];
  hasInteracted: boolean;
}

export function createInitialGuestSandbox(): GuestSandboxState {
  const bundle = buildStarterSanctuaryBundle('guest');
  return {
    activeMapId: bundle.map.id,
    maps: [bundle.map],
    nodes: bundle.nodes,
    edges: bundle.edges,
    dumps: bundle.dumps,
    patterns: bundle.patterns,
    hasInteracted: false,
  };
}

export function loadGuestSandbox(): GuestSandboxState {
  if (typeof window === 'undefined') {
    return createInitialGuestSandbox();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialGuestSandbox();
    const parsed = JSON.parse(raw) as Partial<GuestSandboxState>;
    if (
      !parsed ||
      !Array.isArray(parsed.maps) ||
      parsed.maps.length === 0 ||
      typeof parsed.activeMapId !== 'string'
    ) {
      return createInitialGuestSandbox();
    }
    const validActiveId = parsed.maps.some((m) => m.id === parsed.activeMapId)
      ? parsed.activeMapId
      : parsed.maps[0].id;

    return {
      activeMapId: validActiveId,
      maps: parsed.maps,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      dumps: Array.isArray(parsed.dumps) ? parsed.dumps : [],
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      hasInteracted: Boolean(parsed.hasInteracted),
    };
  } catch {
    return createInitialGuestSandbox();
  }
}

export function saveGuestSandbox(state: GuestSandboxState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export function clearGuestSandbox(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
