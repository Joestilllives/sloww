import type {
  BrainDump,
  MapEdge,
  MapNode,
  MindMap,
  NodeKind,
  PatternInsight,
  PatternTone,
  PriorityTier,
} from '../types';

export interface ExportableSanctuary {
  map: MindMap;
  nodes: MapNode[];
  edges: MapEdge[];
  dumps: BrainDump[];
  patterns: PatternInsight[];
}

const TIER_HEADINGS: Record<PriorityTier, string> = {
  now: 'Today',
  next: 'Up Next',
  later: 'Later',
  none: 'Map Only',
};

const VALID_KINDS = new Set<NodeKind>(['thought', 'anchor', 'feeling', 'question']);
const VALID_TIERS = new Set<PriorityTier>(['now', 'next', 'later', 'none']);
const VALID_TONES = new Set<PatternTone>(['anchor', 'tension', 'momentum', 'rest']);

function makeImportId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'sloww-sanctuary';
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildSanctuaryMarkdown({
  map,
  nodes,
  edges,
  dumps,
  patterns,
}: ExportableSanctuary): string {
  const lines: string[] = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  lines.push(`# ${map.title}`);
  if (map.intention) {
    lines.push('', `> ${map.intention}`);
  }
  lines.push('', `_Exported from Sloww on ${new Date().toLocaleDateString()}_`);

  // Priority Hearth
  const hearthTiers: PriorityTier[] = ['now', 'next', 'later'];
  const hasHearth = nodes.some((n) => n.priorityTier !== 'none');
  if (hasHearth) {
    lines.push('', '## Priority Hearth');
    for (const tier of hearthTiers) {
      const items = nodes
        .filter((n) => n.priorityTier === tier)
        .sort((a, b) => Number(a.completed) - Number(b.completed) || a.priorityOrder - b.priorityOrder);
      if (items.length === 0) continue;
      lines.push('', `### ${TIER_HEADINGS[tier]}`);
      for (const item of items) {
        const mark = item.completed ? 'x' : ' ';
        const themeTag = item.theme ? ` _(${item.theme})_` : '';
        lines.push(`- [${mark}] **${item.text}**${themeTag}`);
        if (item.note) lines.push(`  - ${item.note}`);
      }
    }
  }

  // All Mind Map Cards
  lines.push('', `## Mind Map Cards (${nodes.length})`);
  if (nodes.length === 0) {
    lines.push('', '_No cards yet._');
  } else {
    for (const n of nodes) {
      const meta = [n.kind, TIER_HEADINGS[n.priorityTier], n.theme].filter(Boolean).join(' · ');
      const donePrefix = n.completed ? '✓ ' : '';
      lines.push('', `- ${donePrefix}**${n.text}** \`[${meta}]\``);
      if (n.note) lines.push(`  ${n.note}`);
    }
  }

  // Connections
  if (edges.length > 0) {
    lines.push('', `## Connected Threads (${edges.length})`);
    for (const e of edges) {
      const fromText = nodeById.get(e.fromId)?.text || e.fromId;
      const toText = nodeById.get(e.toId)?.text || e.toId;
      const label = e.label || 'connects to';
      lines.push(`- "${fromText}" — *${label}* → "${toText}"`);
    }
  }

  // Journal Entries
  if (dumps.length > 0) {
    lines.push('', `## Journal Entries (${dumps.length})`);
    for (const d of dumps) {
      const mood = d.moodWord ? ` (${d.moodWord})` : '';
      lines.push('', `### Entry${mood}`, '', d.rawText);
    }
  }

  // Patterns & Companion
  if (patterns.length > 0 || map.encouragementNote) {
    lines.push('', '## Nourishment & Reflections');
    if (map.encouragementTitle || map.encouragementNote) {
      lines.push('', `### Wise Companion: ${map.encouragementTitle || 'Reflection'}`);
      if (map.encouragementNote) lines.push('', map.encouragementNote);
      if (map.encouragementStep) lines.push('', `**One tiny step:** ${map.encouragementStep}`);
    }
    if (patterns.length > 0) {
      lines.push('', '### Pattern Finder');
      for (const p of patterns) {
        lines.push('', `- **${p.title}** _(${p.tone})_: ${p.insight}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function exportSanctuaryAsMarkdown(bundle: ExportableSanctuary): void {
  const filename = `${slugifyFilename(bundle.map.title)}-sloww.md`;
  const markdown = buildSanctuaryMarkdown(bundle);
  triggerDownload(filename, markdown, 'text/markdown;charset=utf-8');
}

export function exportSanctuaryAsJson(bundle: ExportableSanctuary): void {
  const filename = `${slugifyFilename(bundle.map.title)}-sloww.json`;
  const payload = {
    app: 'Sloww',
    exportedAt: new Date().toISOString(),
    sanctuary: {
      id: bundle.map.id,
      title: bundle.map.title,
      intention: bundle.map.intention || '',
      encouragementTitle: bundle.map.encouragementTitle || '',
      encouragementNote: bundle.map.encouragementNote || '',
      encouragementStep: bundle.map.encouragementStep || '',
      breathCount: bundle.map.breathCount ?? 0,
      waterDrops: bundle.map.waterDrops ?? 0,
      nourishmentOffset: bundle.map.nourishmentOffset ?? 0,
    },
    cards: bundle.nodes.map((n) => ({
      id: n.id,
      text: n.text,
      note: n.note || '',
      kind: n.kind,
      priorityTier: n.priorityTier,
      priorityOrder: n.priorityOrder,
      completed: n.completed,
      theme: n.theme || '',
      x: n.x,
      y: n.y,
      sourceDumpId: n.sourceDumpId || null,
    })),
    threads: bundle.edges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      label: e.label || 'connects to',
    })),
    brainDumps: bundle.dumps.map((d) => ({
      id: d.id,
      rawText: d.rawText,
      moodWord: d.moodWord || '',
      mapped: d.mapped,
    })),
    patterns: bundle.patterns.map((p) => ({
      id: p.id,
      title: p.title,
      insight: p.insight,
      tone: p.tone,
      relatedNodeIds: p.relatedNodeIds,
    })),
  };
  triggerDownload(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
}

function clampString(val: unknown, max: number): string {
  return typeof val === 'string' ? val.trim().slice(0, max) : '';
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function parseImportedSanctuaryJson(
  rawText: string,
  ownerId = 'guest'
): ExportableSanctuary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('This file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Unrecognized Sanctuary backup format.');
  }

  const record = parsed as Record<string, unknown>;
  const rawSanctuary =
    record.sanctuary && typeof record.sanctuary === 'object'
      ? (record.sanctuary as Record<string, unknown>)
      : null;

  if (!rawSanctuary) {
    throw new Error('Missing sanctuary details in JSON file.');
  }

  const mapId = makeImportId('map');
  const title = clampString(rawSanctuary.title, 120) || 'Imported Sanctuary';

  const map: MindMap = {
    id: mapId,
    ownerId,
    title,
    intention: clampString(rawSanctuary.intention, 400),
    encouragementTitle: clampString(rawSanctuary.encouragementTitle, 160),
    encouragementNote: clampString(rawSanctuary.encouragementNote, 2000),
    encouragementStep: clampString(rawSanctuary.encouragementStep, 400),
    breathCount: clampNumber(rawSanctuary.breathCount, 0, 1000000, 0),
    waterDrops: clampNumber(rawSanctuary.waterDrops, 0, 1000000, 0),
    nourishmentOffset: clampNumber(rawSanctuary.nourishmentOffset, 0, 1000000, 0),
  };

  const rawDumps = Array.isArray(record.brainDumps) ? record.brainDumps.slice(0, 100) : [];
  const dumpIdMap = new Map<string, string>();
  const dumps: BrainDump[] = [];
  for (const item of rawDumps) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const rawDumpText = clampString(d.rawText, 4000);
    if (!rawDumpText) continue;
    const newId = makeImportId('dump');
    if (typeof d.id === 'string' && d.id) dumpIdMap.set(d.id, newId);
    dumps.push({
      id: newId,
      ownerId,
      mapId,
      rawText: rawDumpText,
      mapped: Boolean(d.mapped ?? true),
      moodWord: clampString(d.moodWord, 60) || undefined,
    });
  }

  const rawCards = Array.isArray(record.cards) ? record.cards.slice(0, 200) : [];
  const nodeIdMap = new Map<string, string>();
  const nodes: MapNode[] = [];
  for (let i = 0; i < rawCards.length; i++) {
    const item = rawCards[i];
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const text = clampString(c.text, 600);
    if (!text) continue;
    const newId = makeImportId('node');
    if (typeof c.id === 'string' && c.id) nodeIdMap.set(c.id, newId);
    const kind = VALID_KINDS.has(c.kind as NodeKind) ? (c.kind as NodeKind) : 'thought';
    const priorityTier = VALID_TIERS.has(c.priorityTier as PriorityTier)
      ? (c.priorityTier as PriorityTier)
      : 'none';
    const mappedDumpId =
      typeof c.sourceDumpId === 'string' ? dumpIdMap.get(c.sourceDumpId) : undefined;

    nodes.push({
      id: newId,
      ownerId,
      mapId,
      text,
      note: clampString(c.note, 1200) || undefined,
      kind,
      priorityTier,
      priorityOrder: clampNumber(c.priorityOrder, 0, 1000, i + 1),
      completed: Boolean(c.completed),
      theme: clampString(c.theme, 80) || undefined,
      x: clampNumber(c.x, -10000, 10000, 120 + (i % 4) * 240),
      y: clampNumber(c.y, -10000, 10000, 180 + Math.floor(i / 4) * 140),
      ...(mappedDumpId ? { sourceDumpId: mappedDumpId } : {}),
    });
  }

  const rawThreads = Array.isArray(record.threads) ? record.threads.slice(0, 300) : [];
  const edges: MapEdge[] = [];
  for (const item of rawThreads) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const fromId = typeof t.fromId === 'string' ? nodeIdMap.get(t.fromId) : undefined;
    const toId = typeof t.toId === 'string' ? nodeIdMap.get(t.toId) : undefined;
    if (!fromId || !toId || fromId === toId) continue;
    edges.push({
      id: makeImportId('edge'),
      ownerId,
      mapId,
      fromId,
      toId,
      label: clampString(t.label, 80) || 'connects to',
    });
  }

  const rawPatterns = Array.isArray(record.patterns) ? record.patterns.slice(0, 6) : [];
  const patterns: PatternInsight[] = [];
  for (const item of rawPatterns) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const pTitle = clampString(p.title, 140);
    const insight = clampString(p.insight, 800);
    if (!pTitle || !insight) continue;
    const relatedNodeIds = Array.isArray(p.relatedNodeIds)
      ? p.relatedNodeIds
          .map((oldId) => (typeof oldId === 'string' ? nodeIdMap.get(oldId) : undefined))
          .filter((id): id is string => Boolean(id))
          .slice(0, 20)
      : [];
    patterns.push({
      id: makeImportId('pat'),
      ownerId,
      mapId,
      title: pTitle,
      insight,
      tone: VALID_TONES.has(p.tone as PatternTone) ? (p.tone as PatternTone) : 'anchor',
      relatedNodeIds,
    });
  }

  return { map, nodes, edges, dumps, patterns };
}
