import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  collection,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  increment,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  BrainDump,
  CompanionNote,
  MapEdge,
  MapNode,
  MindMap,
  NodeKind,
  PatternInsight,
  PatternTone,
  PriorityTier,
  UserProfile,
} from '../types';

const app = initializeApp(firebaseConfig);
export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
})();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function createSafeId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  const stamp = Date.now().toString(36);
  return `${prefix}_${stamp}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
}

function clampStr(value: string | undefined, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function clampNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, Math.round(value)));
}

const VALID_KINDS: NodeKind[] = ['thought', 'anchor', 'feeling', 'question'];
const VALID_TIERS: PriorityTier[] = ['now', 'next', 'later', 'none'];
const VALID_TONES: PatternTone[] = ['anchor', 'tension', 'momentum', 'rest'];

export function sanitizeKind(kind?: string): NodeKind {
  return VALID_KINDS.includes(kind as NodeKind) ? (kind as NodeKind) : 'thought';
}

export function sanitizeTier(tier?: string): PriorityTier {
  return VALID_TIERS.includes(tier as PriorityTier) ? (tier as PriorityTier) : 'none';
}

export function sanitizeTone(tone?: string): PatternTone {
  return VALID_TONES.includes(tone as PatternTone) ? (tone as PatternTone) : 'anchor';
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function upsertUserProfile(profile: {
  uid: string;
  displayName: string;
  email: string;
  activeMapId?: string;
}): Promise<void> {
  const path = `users/${profile.uid}`;
  const ref = doc(db, 'users', profile.uid);
  const existing = await getDocFromServer(ref).catch(() => null);

  const updatePayload: Record<string, unknown> = {
    displayName: clampStr(profile.displayName, 120) || 'Quiet Thinker',
    email: clampStr(profile.email, 200) || 'user@example.com',
    updatedAt: serverTimestamp(),
  };
  if (profile.activeMapId && /^[a-zA-Z0-9_\-]+$/.test(profile.activeMapId)) {
    updatePayload.activeMapId = profile.activeMapId.slice(0, 128);
  }

  try {
    if (existing && existing.exists()) {
      await updateDoc(ref, updatePayload);
    } else {
      await setDoc(ref, {
        uid: profile.uid,
        ...updatePayload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, existing?.exists() ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function updateActiveMapId(userId: string, mapId: string): Promise<void> {
  const path = `users/${userId}`;
  try {
    await updateDoc(doc(db, 'users', userId), {
      activeMapId: mapId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

async function commitBatchInChunks(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  chunkSize = 420
): Promise<void> {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = writeBatch(db);
    const slice = ops.slice(i, i + chunkSize);
    for (const apply of slice) {
      apply(batch);
    }
    await batch.commit();
  }
}

export async function createMindMap(
  userId: string,
  mapId: string,
  input: {
    title: string;
    intention?: string;
    companionNote?: CompanionNote;
  }
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}`;
  const payload: Record<string, unknown> = {
    id: mapId,
    ownerId: userId,
    title: clampStr(input.title, 120) || 'Untitled Sanctuary',
    breathCount: 0,
    waterDrops: 0,
    nourishmentOffset: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const intention = clampStr(input.intention, 400);
  if (intention) payload.intention = intention;

  if (input.companionNote) {
    const encTitle = clampStr(input.companionNote.title, 160);
    const encNote = clampStr(input.companionNote.message, 2000);
    const encStep = clampStr(input.companionNote.tinyStep, 400);
    if (encTitle) payload.encouragementTitle = encTitle;
    if (encNote) payload.encouragementNote = encNote;
    if (encStep) payload.encouragementStep = encStep;
  }

  try {
    await setDoc(doc(db, 'users', userId, 'maps', mapId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function importGuestSanctuaryBundle(
  userId: string,
  bundle: {
    map: MindMap;
    nodes: MapNode[];
    edges: MapEdge[];
    dumps: BrainDump[];
    patterns: PatternInsight[];
  }
): Promise<string> {
  const newMapId = createSafeId('map');
  const mapPath = `users/${userId}/maps/${newMapId}`;

  const mapPayload: Record<string, unknown> = {
    id: newMapId,
    ownerId: userId,
    title: clampStr(bundle.map.title, 120) || "Today's Quiet Clearing",
    breathCount: clampNum(bundle.map.breathCount ?? 0, 0, 1000000),
    waterDrops: clampNum(bundle.map.waterDrops ?? 0, 0, 1000000),
    nourishmentOffset: clampNum(bundle.map.nourishmentOffset ?? 0, 0, 1000000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const intention = clampStr(bundle.map.intention, 400);
  if (intention) mapPayload.intention = intention;
  const encTitle = clampStr(bundle.map.encouragementTitle, 160);
  if (encTitle) mapPayload.encouragementTitle = encTitle;
  const encNote = clampStr(bundle.map.encouragementNote, 2000);
  if (encNote) mapPayload.encouragementNote = encNote;
  const encStep = clampStr(bundle.map.encouragementStep, 400);
  if (encStep) mapPayload.encouragementStep = encStep;

  try {
    // Create parent MindMap first so ownsParentMap() passes on child subcollection writes
    await setDoc(doc(db, 'users', userId, 'maps', newMapId), mapPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, mapPath);
  }

  const nodeIdMap = new Map<string, string>();
  for (const n of bundle.nodes) {
    nodeIdMap.set(n.id, createSafeId('node'));
  }
  const dumpIdMap = new Map<string, string>();
  for (const d of bundle.dumps) {
    dumpIdMap.set(d.id, createSafeId('dump'));
  }

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const d of bundle.dumps) {
    const newDumpId = dumpIdMap.get(d.id) || createSafeId('dump');
    const payload: Record<string, unknown> = {
      id: newDumpId,
      ownerId: userId,
      mapId: newMapId,
      rawText: clampStr(d.rawText, 4000) || 'Quiet note',
      mapped: Boolean(d.mapped),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const moodWord = clampStr(d.moodWord, 60);
    if (moodWord) payload.moodWord = moodWord;
    ops.push((batch) =>
      batch.set(doc(db, 'users', userId, 'maps', newMapId, 'dumps', newDumpId), payload)
    );
  }

  for (const n of bundle.nodes) {
    const newNodeId = nodeIdMap.get(n.id) || createSafeId('node');
    const payload: Record<string, unknown> = {
      id: newNodeId,
      ownerId: userId,
      mapId: newMapId,
      text: clampStr(n.text, 600) || 'Quiet thought',
      kind: sanitizeKind(n.kind),
      priorityTier: sanitizeTier(n.priorityTier),
      priorityOrder: clampNum(n.priorityOrder, 0, 1000),
      completed: Boolean(n.completed),
      x: clampNum(n.x, -10000, 10000),
      y: clampNum(n.y, -10000, 10000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const note = clampStr(n.note, 1200);
    if (note) payload.note = note;
    const theme = clampStr(n.theme, 80);
    if (theme) payload.theme = theme;
    if (n.sourceDumpId) {
      const mappedDumpId = dumpIdMap.get(n.sourceDumpId);
      if (mappedDumpId && VALID_ID_RE.test(mappedDumpId)) {
        payload.sourceDumpId = mappedDumpId;
      }
    }
    ops.push((batch) =>
      batch.set(doc(db, 'users', userId, 'maps', newMapId, 'nodes', newNodeId), payload)
    );
  }

  for (const e of bundle.edges) {
    const newFromId = nodeIdMap.get(e.fromId);
    const newToId = nodeIdMap.get(e.toId);
    if (!newFromId || !newToId || newFromId === newToId) continue;
    const newEdgeId = createSafeId('edge');
    const payload: Record<string, unknown> = {
      id: newEdgeId,
      ownerId: userId,
      mapId: newMapId,
      fromId: newFromId,
      toId: newToId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const label = clampStr(e.label, 80);
    if (label) payload.label = label;
    ops.push((batch) =>
      batch.set(doc(db, 'users', userId, 'maps', newMapId, 'edges', newEdgeId), payload)
    );
  }

  for (const p of bundle.patterns.slice(0, 6)) {
    const newPatternId = createSafeId('pat');
    const related = (p.relatedNodeIds || [])
      .map((oldId) => nodeIdMap.get(oldId))
      .filter((id): id is string => Boolean(id))
      .slice(0, 20);
    ops.push((batch) =>
      batch.set(doc(db, 'users', userId, 'maps', newMapId, 'patterns', newPatternId), {
        id: newPatternId,
        ownerId: userId,
        mapId: newMapId,
        title: clampStr(p.title, 140) || 'Emerging Pattern',
        insight: clampStr(p.insight, 800) || 'A quiet thread connects these thoughts.',
        tone: sanitizeTone(p.tone),
        relatedNodeIds: related,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  if (ops.length > 0) {
    try {
      await commitBatchInChunks(ops);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, mapPath);
    }
  }

  return newMapId;
}

export async function updateMindMapDetails(
  userId: string,
  mapId: string,
  updates: {
    title?: string;
    intention?: string;
    companionNote?: CompanionNote;
  }
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof updates.title === 'string') {
    payload.title = clampStr(updates.title, 120) || 'Untitled Sanctuary';
  }
  if (typeof updates.intention === 'string') {
    payload.intention = updates.intention.trim().slice(0, 400);
  }
  if (updates.companionNote) {
    payload.encouragementTitle = (updates.companionNote.title || '').trim().slice(0, 160);
    payload.encouragementNote = (updates.companionNote.message || '').trim().slice(0, 2000);
    payload.encouragementStep = (updates.companionNote.tinyStep || '').trim().slice(0, 400);
  }

  try {
    await updateDoc(doc(db, 'users', userId, 'maps', mapId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function incrementMapNourishment(
  userId: string,
  mapId: string,
  field: 'breathCount' | 'waterDrops'
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'maps', mapId), {
      [field]: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function resetMapNourishment(
  userId: string,
  mapId: string,
  activityOffset: number
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'maps', mapId), {
      breathCount: 0,
      waterDrops: 0,
      nourishmentOffset: clampNum(activityOffset, 0, 1000000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createMapNode(
  userId: string,
  mapId: string,
  node: Omit<MapNode, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/nodes/${node.id}`;
  const payload: Record<string, unknown> = {
    id: node.id,
    ownerId: userId,
    mapId,
    text: clampStr(node.text, 600) || 'Quiet thought',
    kind: sanitizeKind(node.kind),
    priorityTier: sanitizeTier(node.priorityTier),
    priorityOrder: clampNum(node.priorityOrder, 0, 1000),
    completed: Boolean(node.completed),
    x: clampNum(node.x, -10000, 10000),
    y: clampNum(node.y, -10000, 10000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const note = clampStr(node.note, 1200);
  if (note) payload.note = note;
  const theme = clampStr(node.theme, 80);
  if (theme) payload.theme = theme;
  if (node.sourceDumpId && /^[a-zA-Z0-9_\-]+$/.test(node.sourceDumpId)) {
    payload.sourceDumpId = node.sourceDumpId.slice(0, 128);
  }

  try {
    await setDoc(doc(db, 'users', userId, 'maps', mapId, 'nodes', node.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMapNode(
  userId: string,
  mapId: string,
  nodeId: string,
  updates: Partial<
    Pick<MapNode, 'text' | 'note' | 'kind' | 'theme' | 'priorityTier' | 'priorityOrder' | 'completed' | 'x' | 'y'>
  >
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/nodes/${nodeId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof updates.text === 'string') payload.text = clampStr(updates.text, 600) || 'Quiet thought';
  if (typeof updates.note === 'string') payload.note = updates.note.trim().slice(0, 1200);
  if (updates.kind !== undefined) payload.kind = sanitizeKind(updates.kind);
  if (typeof updates.theme === 'string') payload.theme = updates.theme.trim().slice(0, 80);
  if (updates.priorityTier !== undefined) payload.priorityTier = sanitizeTier(updates.priorityTier);
  if (updates.priorityOrder !== undefined) payload.priorityOrder = clampNum(updates.priorityOrder, 0, 1000);
  if (updates.completed !== undefined) payload.completed = Boolean(updates.completed);
  if (updates.x !== undefined) payload.x = clampNum(updates.x, -10000, 10000);
  if (updates.y !== undefined) payload.y = clampNum(updates.y, -10000, 10000);

  try {
    await updateDoc(doc(db, 'users', userId, 'maps', mapId, 'nodes', nodeId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function batchUpdateNodePositions(
  userId: string,
  mapId: string,
  positions: Array<{ id: string; x: number; y: number }>
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/nodes`;
  try {
    await commitBatchInChunks(
      positions.map((pos) => (batch) => {
        batch.update(doc(db, 'users', userId, 'maps', mapId, 'nodes', pos.id), {
          x: clampNum(pos.x, -10000, 10000),
          y: clampNum(pos.y, -10000, 10000),
          updatedAt: serverTimestamp(),
        });
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMapNode(
  userId: string,
  mapId: string,
  nodeId: string,
  connectedEdgeIds: string[],
  patternCascade?: {
    patternUpdates: Array<{ id: string; remainingNodeIds: string[] }>;
    patternDeleteIds: string[];
  }
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/nodes/${nodeId}`;
  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [
      (batch) => batch.delete(doc(db, 'users', userId, 'maps', mapId, 'nodes', nodeId)),
      ...connectedEdgeIds.map(
        (edgeId) => (batch: ReturnType<typeof writeBatch>) =>
          batch.delete(doc(db, 'users', userId, 'maps', mapId, 'edges', edgeId))
      ),
    ];

    if (patternCascade) {
      for (const patId of patternCascade.patternDeleteIds) {
        ops.push((batch) => batch.delete(doc(db, 'users', userId, 'maps', mapId, 'patterns', patId)));
      }
      for (const pat of patternCascade.patternUpdates) {
        ops.push((batch) =>
          batch.update(doc(db, 'users', userId, 'maps', mapId, 'patterns', pat.id), {
            relatedNodeIds: pat.remainingNodeIds.slice(0, 20),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    await commitBatchInChunks(ops);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createMapEdge(
  userId: string,
  mapId: string,
  edge: Omit<MapEdge, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/edges/${edge.id}`;
  const payload: Record<string, unknown> = {
    id: edge.id,
    ownerId: userId,
    mapId,
    fromId: edge.fromId,
    toId: edge.toId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const label = clampStr(edge.label, 80);
  if (label) payload.label = label;

  try {
    await setDoc(doc(db, 'users', userId, 'maps', mapId, 'edges', edge.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMapEdge(
  userId: string,
  mapId: string,
  edgeId: string,
  label: string
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/edges/${edgeId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'maps', mapId, 'edges', edgeId), {
      label: clampStr(label, 80) || 'connects to',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createBranchedNode(
  userId: string,
  mapId: string,
  node: Omit<MapNode, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>,
  edge: Omit<MapEdge, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/nodes/${node.id}`;
  try {
    const batch = writeBatch(db);
    const nodePayload: Record<string, unknown> = {
      id: node.id,
      ownerId: userId,
      mapId,
      text: clampStr(node.text, 600) || 'Quiet thought',
      kind: sanitizeKind(node.kind),
      priorityTier: sanitizeTier(node.priorityTier),
      priorityOrder: clampNum(node.priorityOrder, 0, 1000),
      completed: Boolean(node.completed),
      x: clampNum(node.x, -10000, 10000),
      y: clampNum(node.y, -10000, 10000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const note = clampStr(node.note, 1200);
    if (note) nodePayload.note = note;
    const theme = clampStr(node.theme, 80);
    if (theme) nodePayload.theme = theme;

    const edgePayload: Record<string, unknown> = {
      id: edge.id,
      ownerId: userId,
      mapId,
      fromId: edge.fromId,
      toId: edge.toId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const label = clampStr(edge.label, 80);
    if (label) edgePayload.label = label;

    batch.set(doc(db, 'users', userId, 'maps', mapId, 'nodes', node.id), nodePayload);
    batch.set(doc(db, 'users', userId, 'maps', mapId, 'edges', edge.id), edgePayload);
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMapEdge(userId: string, mapId: string, edgeId: string): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/edges/${edgeId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'maps', mapId, 'edges', edgeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createBrainDump(
  userId: string,
  mapId: string,
  dump: Omit<BrainDump, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/dumps/${dump.id}`;
  const payload: Record<string, unknown> = {
    id: dump.id,
    ownerId: userId,
    mapId,
    rawText: clampStr(dump.rawText, 4000) || 'Quiet note',
    mapped: Boolean(dump.mapped),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const moodWord = clampStr(dump.moodWord, 60);
  if (moodWord) payload.moodWord = moodWord;

  try {
    await setDoc(doc(db, 'users', userId, 'maps', mapId, 'dumps', dump.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBrainDump(
  userId: string,
  mapId: string,
  dumpId: string,
  updates: Partial<Pick<BrainDump, 'mapped' | 'rawText' | 'moodWord'>>
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/dumps/${dumpId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (updates.mapped !== undefined) payload.mapped = Boolean(updates.mapped);
  if (typeof updates.rawText === 'string') payload.rawText = clampStr(updates.rawText, 4000) || 'Quiet note';
  if (typeof updates.moodWord === 'string') payload.moodWord = updates.moodWord.trim().slice(0, 60);

  try {
    await updateDoc(doc(db, 'users', userId, 'maps', mapId, 'dumps', dumpId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

const VALID_ID_RE = /^[a-zA-Z0-9_\-]{1,128}$/;

export async function commitUnpackedDump(
  userId: string,
  mapId: string,
  input: {
    dumpId: string;
    moodWord?: string;
    nodes: Array<Omit<MapNode, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>>;
    edges: Array<Omit<MapEdge, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>>;
    companionNote?: CompanionNote;
  }
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/dumps/${input.dumpId}`;
  try {
    const batch = writeBatch(db);

    for (const node of input.nodes) {
      if (!VALID_ID_RE.test(node.id)) continue;
      const payload: Record<string, unknown> = {
        id: node.id,
        ownerId: userId,
        mapId,
        text: clampStr(node.text, 600) || 'Quiet thought',
        kind: sanitizeKind(node.kind),
        priorityTier: sanitizeTier(node.priorityTier),
        priorityOrder: clampNum(node.priorityOrder, 0, 1000),
        completed: Boolean(node.completed),
        x: clampNum(node.x, -10000, 10000),
        y: clampNum(node.y, -10000, 10000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const note = clampStr(node.note, 1200);
      if (note) payload.note = note;
      const theme = clampStr(node.theme, 80);
      if (theme) payload.theme = theme;
      if (node.sourceDumpId && VALID_ID_RE.test(node.sourceDumpId)) {
        payload.sourceDumpId = node.sourceDumpId;
      }
      batch.set(doc(db, 'users', userId, 'maps', mapId, 'nodes', node.id), payload);
    }

    for (const edge of input.edges) {
      if (!VALID_ID_RE.test(edge.id) || !VALID_ID_RE.test(edge.fromId) || !VALID_ID_RE.test(edge.toId)) {
        continue;
      }
      const payload: Record<string, unknown> = {
        id: edge.id,
        ownerId: userId,
        mapId,
        fromId: edge.fromId,
        toId: edge.toId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const label = clampStr(edge.label, 80);
      if (label) payload.label = label;
      batch.set(doc(db, 'users', userId, 'maps', mapId, 'edges', edge.id), payload);
    }

    const dumpUpdate: Record<string, unknown> = {
      mapped: true,
      updatedAt: serverTimestamp(),
    };
    const dumpMood = clampStr(input.moodWord, 60);
    if (dumpMood) {
      dumpUpdate.moodWord = dumpMood;
    }
    batch.update(doc(db, 'users', userId, 'maps', mapId, 'dumps', input.dumpId), dumpUpdate);

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  if (input.companionNote) {
    await updateMindMapDetails(userId, mapId, { companionNote: input.companionNote });
  }
}

export async function deleteBrainDump(
  userId: string,
  mapId: string,
  dumpId: string,
  cascade?: {
    nodeIds: string[];
    edgeIds: string[];
    patternUpdates: Array<{ id: string; remainingNodeIds: string[] }>;
    patternDeleteIds: string[];
  }
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/dumps/${dumpId}`;
  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [
      (batch) => batch.delete(doc(db, 'users', userId, 'maps', mapId, 'dumps', dumpId)),
    ];
    if (cascade) {
      for (const nodeId of cascade.nodeIds) {
        ops.push((batch) => batch.delete(doc(db, 'users', userId, 'maps', mapId, 'nodes', nodeId)));
      }
      for (const edgeId of cascade.edgeIds) {
        ops.push((batch) => batch.delete(doc(db, 'users', userId, 'maps', mapId, 'edges', edgeId)));
      }
      for (const patId of cascade.patternDeleteIds) {
        ops.push((batch) => batch.delete(doc(db, 'users', userId, 'maps', mapId, 'patterns', patId)));
      }
      for (const pat of cascade.patternUpdates) {
        ops.push((batch) =>
          batch.update(doc(db, 'users', userId, 'maps', mapId, 'patterns', pat.id), {
            relatedNodeIds: pat.remainingNodeIds.slice(0, 20),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }
    await commitBatchInChunks(ops);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function replacePatterns(
  userId: string,
  mapId: string,
  existingPatternIds: string[],
  newPatterns: Array<Omit<PatternInsight, 'ownerId' | 'mapId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}/patterns`;
  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [
      ...existingPatternIds.map(
        (pid) => (batch: ReturnType<typeof writeBatch>) =>
          batch.delete(doc(db, 'users', userId, 'maps', mapId, 'patterns', pid))
      ),
      ...newPatterns.slice(0, 6).map((p) => (batch: ReturnType<typeof writeBatch>) => {
        const ref = doc(db, 'users', userId, 'maps', mapId, 'patterns', p.id);
        batch.set(ref, {
          id: p.id,
          ownerId: userId,
          mapId,
          title: clampStr(p.title, 140) || 'Emerging Pattern',
          insight: clampStr(p.insight, 800) || 'A quiet thread connects these thoughts.',
          tone: sanitizeTone(p.tone),
          relatedNodeIds: (p.relatedNodeIds || [])
            .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)
            .slice(0, 20),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }),
    ];
    await commitBatchInChunks(ops);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteMindMap(
  userId: string,
  mapId: string,
  childIds: { nodeIds: string[]; edgeIds: string[]; dumpIds: string[]; patternIds: string[] }
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}`;
  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [
      ...childIds.nodeIds.map(
        (id) => (batch: ReturnType<typeof writeBatch>) =>
          batch.delete(doc(db, 'users', userId, 'maps', mapId, 'nodes', id))
      ),
      ...childIds.edgeIds.map(
        (id) => (batch: ReturnType<typeof writeBatch>) =>
          batch.delete(doc(db, 'users', userId, 'maps', mapId, 'edges', id))
      ),
      ...childIds.dumpIds.map(
        (id) => (batch: ReturnType<typeof writeBatch>) =>
          batch.delete(doc(db, 'users', userId, 'maps', mapId, 'dumps', id))
      ),
      ...childIds.patternIds.map(
        (id) => (batch: ReturnType<typeof writeBatch>) =>
          batch.delete(doc(db, 'users', userId, 'maps', mapId, 'patterns', id))
      ),
      (batch) => batch.delete(doc(db, 'users', userId, 'maps', mapId)),
    ];
    await commitBatchInChunks(ops);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function restoreDeletedBundle(
  userId: string,
  mapId: string,
  bundle: {
    nodes: MapNode[];
    edges: MapEdge[];
    dumps: BrainDump[];
    createdPatterns: PatternInsight[];
    updatedPatterns: Array<{ id: string; relatedNodeIds: string[] }>;
  }
): Promise<void> {
  const path = `users/${userId}/maps/${mapId}`;
  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    for (const dump of bundle.dumps) {
      if (!VALID_ID_RE.test(dump.id)) continue;
      const payload: Record<string, unknown> = {
        id: dump.id,
        ownerId: userId,
        mapId,
        rawText: clampStr(dump.rawText, 4000) || 'Quiet note',
        mapped: Boolean(dump.mapped),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const moodWord = clampStr(dump.moodWord, 60);
      if (moodWord) payload.moodWord = moodWord;
      ops.push((batch) =>
        batch.set(doc(db, 'users', userId, 'maps', mapId, 'dumps', dump.id), payload)
      );
    }

    for (const node of bundle.nodes) {
      if (!VALID_ID_RE.test(node.id)) continue;
      const payload: Record<string, unknown> = {
        id: node.id,
        ownerId: userId,
        mapId,
        text: clampStr(node.text, 600) || 'Quiet thought',
        kind: sanitizeKind(node.kind),
        priorityTier: sanitizeTier(node.priorityTier),
        priorityOrder: clampNum(node.priorityOrder, 0, 1000),
        completed: Boolean(node.completed),
        x: clampNum(node.x, -10000, 10000),
        y: clampNum(node.y, -10000, 10000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const note = clampStr(node.note, 1200);
      if (note) payload.note = note;
      const theme = clampStr(node.theme, 80);
      if (theme) payload.theme = theme;
      if (node.sourceDumpId && VALID_ID_RE.test(node.sourceDumpId)) {
        payload.sourceDumpId = node.sourceDumpId;
      }
      ops.push((batch) =>
        batch.set(doc(db, 'users', userId, 'maps', mapId, 'nodes', node.id), payload)
      );
    }

    for (const edge of bundle.edges) {
      if (!VALID_ID_RE.test(edge.id) || !VALID_ID_RE.test(edge.fromId) || !VALID_ID_RE.test(edge.toId)) {
        continue;
      }
      const payload: Record<string, unknown> = {
        id: edge.id,
        ownerId: userId,
        mapId,
        fromId: edge.fromId,
        toId: edge.toId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const label = clampStr(edge.label, 80);
      if (label) payload.label = label;
      ops.push((batch) =>
        batch.set(doc(db, 'users', userId, 'maps', mapId, 'edges', edge.id), payload)
      );
    }

    for (const pat of bundle.createdPatterns) {
      if (!VALID_ID_RE.test(pat.id)) continue;
      ops.push((batch) =>
        batch.set(doc(db, 'users', userId, 'maps', mapId, 'patterns', pat.id), {
          id: pat.id,
          ownerId: userId,
          mapId,
          title: clampStr(pat.title, 140) || 'Emerging Pattern',
          insight: clampStr(pat.insight, 800) || 'A quiet thread connects these thoughts.',
          tone: sanitizeTone(pat.tone),
          relatedNodeIds: (pat.relatedNodeIds || [])
            .filter((id) => typeof id === 'string' && VALID_ID_RE.test(id))
            .slice(0, 20),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    for (const pat of bundle.updatedPatterns) {
      if (!VALID_ID_RE.test(pat.id)) continue;
      ops.push((batch) =>
        batch.update(doc(db, 'users', userId, 'maps', mapId, 'patterns', pat.id), {
          relatedNodeIds: pat.relatedNodeIds
            .filter((id) => typeof id === 'string' && VALID_ID_RE.test(id))
            .slice(0, 20),
          updatedAt: serverTimestamp(),
        })
      );
    }

    if (ops.length > 0) {
      await commitBatchInChunks(ops);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function getMapCollections(userId: string, mapId: string) {
  return {
    nodesCol: collection(db, 'users', userId, 'maps', mapId, 'nodes'),
    edgesCol: collection(db, 'users', userId, 'maps', mapId, 'edges'),
    dumpsCol: collection(db, 'users', userId, 'maps', mapId, 'dumps'),
    patternsCol: collection(db, 'users', userId, 'maps', mapId, 'patterns'),
  };
}

export async function fetchAllSanctuarySearchIndex(
  userId: string,
  mapIds: string[]
): Promise<{ nodes: MapNode[]; dumps: BrainDump[] }> {
  const ownerFilter = where('ownerId', '==', userId);
  const perMap = await Promise.all(
    mapIds.slice(0, 30).map(async (mapId) => {
      const { nodesCol, dumpsCol } = getMapCollections(userId, mapId);
      const [nSnap, dSnap] = await Promise.all([
        getDocs(query(nodesCol, ownerFilter)),
        getDocs(query(dumpsCol, ownerFilter)),
      ]);
      return {
        nodes: nSnap.docs.map((d) => d.data() as MapNode),
        dumps: dSnap.docs.map((d) => d.data() as BrainDump),
      };
    })
  );

  return {
    nodes: perMap.flatMap((entry) => entry.nodes),
    dumps: perMap.flatMap((entry) => entry.dumps),
  };
}

export type { UserProfile, MindMap };
