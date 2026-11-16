import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  createMindMap,
  createSafeId,
  db,
  handleFirestoreError,
  OperationType,
  updateActiveMapId,
} from './firebase';
import type { BrainDump, MapEdge, MapNode, MindMap, PatternInsight } from '../types';

export interface SanctuaryBundle {
  map: MindMap;
  nodes: MapNode[];
  edges: MapEdge[];
  dumps: BrainDump[];
  patterns: PatternInsight[];
}

/**
 * Builds the starter "Today's Quiet Clearing" sanctuary bundle so both
 * first-time browser sandboxes and newly seeded cloud accounts share one calm design.
 */
export function buildStarterSanctuaryBundle(
  ownerId: string,
  mapId: string = createSafeId('map')
): SanctuaryBundle {
  const n1 = createSafeId('node');
  const n2 = createSafeId('node');
  const n3 = createSafeId('node');
  const n4 = createSafeId('node');
  const n5 = createSafeId('node');
  const n6 = createSafeId('node');
  const dumpId = createSafeId('dump');

  const map: MindMap = {
    id: mapId,
    ownerId,
    title: "Today's Quiet Clearing",
    intention: 'Move gently toward what truly matters, one honest step at a time.',
    encouragementTitle: 'Begin with one steady anchor',
    encouragementNote:
      'Your mind does not need to solve the whole week in one sitting. Notice how your focus items already live right inside your map—when you are ready, pick just one quiet thread to pull.',
    encouragementStep: 'Open your Today focus card or pour a fresh thought into your Brain Dump.',
    breathCount: 0,
    waterDrops: 0,
    nourishmentOffset: 0,
  };

  const nodes: MapNode[] = [
    {
      id: n1,
      ownerId,
      mapId,
      text: 'Protect 45 quiet minutes for deep creative work',
      note: 'Before checking messages, give my freshest energy to what matters most.',
      kind: 'anchor',
      priorityTier: 'now',
      priorityOrder: 1,
      completed: false,
      theme: 'Creative Focus',
      x: 110,
      y: 390,
      sourceDumpId: dumpId,
    },
    {
      id: n2,
      ownerId,
      mapId,
      text: 'Reply to the two open threads waiting on me',
      note: 'Keep replies brief and kind—done is gentler than perfect.',
      kind: 'thought',
      priorityTier: 'next',
      priorityOrder: 2,
      completed: false,
      theme: 'Clear Loops',
      x: 690,
      y: 350,
      sourceDumpId: dumpId,
    },
    {
      id: n3,
      ownerId,
      mapId,
      text: 'Take a 15-minute walk without my phone',
      note: 'Resetting my nervous system clears mental fog faster than pushing harder.',
      kind: 'anchor',
      priorityTier: 'next',
      priorityOrder: 3,
      completed: false,
      theme: 'Rest & Pacing',
      x: 150,
      y: 575,
      sourceDumpId: dumpId,
    },
    {
      id: n4,
      ownerId,
      mapId,
      text: 'Feeling pulled in five directions before noon',
      note: 'Notice when urgency is habit rather than true emergency.',
      kind: 'feeling',
      priorityTier: 'none',
      priorityOrder: 10,
      completed: false,
      theme: 'Rest & Pacing',
      x: 110,
      y: 210,
      sourceDumpId: dumpId,
    },
    {
      id: n5,
      ownerId,
      mapId,
      text: 'What would feel like enough by tonight?',
      note: 'Defining "enough" ahead of time keeps the evening peaceful.',
      kind: 'question',
      priorityTier: 'none',
      priorityOrder: 11,
      completed: false,
      theme: 'Creative Focus',
      x: 690,
      y: 195,
      sourceDumpId: dumpId,
    },
    {
      id: n6,
      ownerId,
      mapId,
      text: 'Sketch long-term ideas for next season',
      note: 'Safe here in Later so it stops tugging at today.',
      kind: 'thought',
      priorityTier: 'later',
      priorityOrder: 4,
      completed: false,
      theme: 'Future Horizon',
      x: 675,
      y: 560,
      sourceDumpId: dumpId,
    },
  ];

  const edges: MapEdge[] = [
    { id: createSafeId('edge'), ownerId, mapId, fromId: n4, toId: n1, label: 'grounds into' },
    { id: createSafeId('edge'), ownerId, mapId, fromId: n4, toId: n3, label: 'soothed by' },
    { id: createSafeId('edge'), ownerId, mapId, fromId: n5, toId: n1, label: 'clarifies' },
    { id: createSafeId('edge'), ownerId, mapId, fromId: n5, toId: n2, label: 'lightens' },
  ];

  const dumps: BrainDump[] = [
    {
      id: dumpId,
      ownerId,
      mapId,
      rawText:
        'I feel pulled in five directions before noon, and I want to protect 45 quiet minutes for creative work before replying to open threads. Also need a walk without my phone, and to park next-season ideas somewhere safe.',
      mapped: true,
      moodWord: 'seeking steadiness',
    },
  ];

  const patterns: PatternInsight[] = [
    {
      id: createSafeId('pat'),
      ownerId,
      mapId,
      title: 'Protecting quiet attention',
      insight:
        'Your strongest clarity appears when you separate deep morning focus from reactive messaging.',
      tone: 'anchor',
      relatedNodeIds: [n1, n4, n5],
    },
    {
      id: createSafeId('pat'),
      title: 'Pacing over urgency',
      ownerId,
      mapId,
      insight:
        'Stepping away briefly and naming what counts as "enough" directly softens midday scatter.',
      tone: 'rest',
      relatedNodeIds: [n3, n4, n6],
    },
  ];

  return { map, nodes, edges, dumps, patterns };
}

/**
 * Seeds a gentle starter sanctuary for brand-new users so the integrated
 * Mind Map + Priority Hearth, Brain Dump stream, Pattern Finder, and
 * Wise Companion are immediately welcoming and clear.
 */
export async function seedStarterSanctuary(userId: string): Promise<string> {
  const bundle = buildStarterSanctuaryBundle(userId);
  const mapId = bundle.map.id;

  // Create parent MindMap first so ownsParentMap() Master Gate passes cleanly
  await createMindMap(userId, mapId, {
    title: bundle.map.title,
    intention: bundle.map.intention,
    companionNote: {
      title: bundle.map.encouragementTitle || 'Begin with one steady anchor',
      message: bundle.map.encouragementNote || '',
      tinyStep: bundle.map.encouragementStep || '',
    },
  });

  const path = `users/${userId}/maps/${mapId}`;
  try {
    const batch = writeBatch(db);

    for (const n of bundle.nodes) {
      batch.set(doc(db, 'users', userId, 'maps', mapId, 'nodes', n.id), {
        ...n,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const e of bundle.edges) {
      batch.set(doc(db, 'users', userId, 'maps', mapId, 'edges', e.id), {
        ...e,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const d of bundle.dumps) {
      batch.set(doc(db, 'users', userId, 'maps', mapId, 'dumps', d.id), {
        ...d,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const p of bundle.patterns) {
      batch.set(doc(db, 'users', userId, 'maps', mapId, 'patterns', p.id), {
        ...p,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    await updateActiveMapId(userId, mapId);
    return mapId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
