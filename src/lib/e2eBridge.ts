import type { BrainDump, MapEdge, MapNode, MindMap, PatternInsight } from '../types';
import type { ExportableSanctuary } from './exportSanctuary';

export interface TestAuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
}

export interface StillpointTestAdapter {
  onAuthStateChanged: (cb: (user: TestAuthUser | null) => void) => () => void;
  signInWithPopup: () => Promise<void>;
  signOut: () => Promise<void>;
  importGuestSanctuaryBundle: (uid: string, bundle: ExportableSanctuary) => Promise<string>;
  updateActiveMapId: (uid: string, mapId: string) => Promise<void>;
  subscribeMaps: (uid: string, cb: (maps: MindMap[]) => void) => () => void;
  subscribeMapData: (
    uid: string,
    mapId: string,
    cb: (data: {
      nodes: MapNode[];
      edges: MapEdge[];
      dumps: BrainDump[];
      patterns: PatternInsight[];
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    __STILLPOINT_TEST_ADAPTER__?: StillpointTestAdapter;
  }
}

export function getStillpointTestAdapter(): StillpointTestAdapter | null {
  if (typeof window === 'undefined') return null;
  return window.__STILLPOINT_TEST_ADAPTER__ ?? null;
}
