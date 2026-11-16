export type NodeKind = 'thought' | 'anchor' | 'feeling' | 'question';
export type PriorityTier = 'now' | 'next' | 'later' | 'none';
export type PatternTone = 'anchor' | 'tension' | 'momentum' | 'rest';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  activeMapId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MindMap {
  id: string;
  ownerId: string;
  title: string;
  intention?: string;
  encouragementTitle?: string;
  encouragementNote?: string;
  encouragementStep?: string;
  breathCount?: number;
  waterDrops?: number;
  nourishmentOffset?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MapNode {
  id: string;
  ownerId: string;
  mapId: string;
  text: string;
  note?: string;
  kind: NodeKind;
  priorityTier: PriorityTier;
  priorityOrder: number;
  completed: boolean;
  theme?: string;
  x: number;
  y: number;
  sourceDumpId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MapEdge {
  id: string;
  ownerId: string;
  mapId: string;
  fromId: string;
  toId: string;
  label?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BrainDump {
  id: string;
  ownerId: string;
  mapId: string;
  rawText: string;
  mapped: boolean;
  moodWord?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PatternInsight {
  id: string;
  ownerId: string;
  mapId: string;
  title: string;
  insight: string;
  tone: PatternTone;
  relatedNodeIds: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CompanionNote {
  title: string;
  message: string;
  tinyStep: string;
}

export interface UnpackDumpResponse {
  moodWord: string;
  extractedNodes: Array<{
    text: string;
    note: string;
    kind: NodeKind;
    suggestedPriority: PriorityTier;
    theme: string;
  }>;
  suggestedLinks: Array<{
    fromIndex: number;
    toIndex?: number;
    toExistingNodeId?: string;
    label: string;
  }>;
  companionNote: CompanionNote;
}

export interface FindPatternsResponse {
  patterns: Array<{
    title: string;
    insight: string;
    tone: PatternTone;
    relatedNodeIds: string[];
  }>;
  companionNote: CompanionNote;
}
