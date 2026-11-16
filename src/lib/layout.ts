import type { MapNode, PriorityTier } from '../types';

export const HEARTH_BOUNDS: {
  x: number;
  y: number;
  width: number;
  height: number;
} = {
  x: 340,
  y: 90,
  width: 320,
  height: 360,
};

export const NODE_WIDTH = 236;
export const NODE_HEIGHT = 132;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxesOverlap(a: Box, b: Box, padding = 22): boolean {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

/**
 * Computes calm, collision-free positions flanking the Priority Hearth
 * so newly unpacked thoughts never land on top of existing cards or the Hearth.
 */
export function computeHarmonyPositions(
  count: number,
  existingNodes: Pick<MapNode, 'x' | 'y'>[]
): Array<{ x: number; y: number }> {
  const occupied: Box[] = [
    { ...HEARTH_BOUNDS },
    ...existingNodes.map((n) => ({
      x: n.x,
      y: n.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
  ];

  const slots: Array<{ x: number; y: number }> = [];
  const baseRows = Math.max(8, Math.ceil((existingNodes.length + count) / 2) + 4);

  // Build candidate slots alternating left and right of the Priority Hearth,
  // then outer wings if inner columns fill up.
  const columnXs = [60, 700, -210, 970];
  const candidates: Array<{ x: number; y: number }> = [];

  for (let band = 0; band < 2; band++) {
    const leftX = columnXs[band * 2];
    const rightX = columnXs[band * 2 + 1];
    for (let row = 0; row < baseRows; row++) {
      const stagger = (row % 2) * 20;
      candidates.push({ x: leftX + stagger, y: 95 + row * 164 });
      candidates.push({ x: rightX + stagger, y: 95 + row * 164 });
    }
  }

  for (let i = 0; i < count; i++) {
    let chosen: { x: number; y: number } | null = null;
    for (const candidate of candidates) {
      const box: Box = {
        x: candidate.x,
        y: candidate.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
      if (!occupied.some((other) => boxesOverlap(box, other))) {
        chosen = candidate;
        occupied.push(box);
        break;
      }
    }

    if (!chosen) {
      const fallbackRow = existingNodes.length + i;
      chosen = {
        x: fallbackRow % 2 === 0 ? 60 : 700,
        y: 95 + Math.floor(fallbackRow / 2) * 168,
      };
      occupied.push({
        x: chosen.x,
        y: chosen.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }

    slots.push(chosen);
  }

  return slots;
}

/**
 * Computes tidy arranged positions ordered by priority tier around the Hearth.
 */
export function computeArrangedPositions(
  nodes: MapNode[]
): Array<{ id: string; x: number; y: number }> {
  const rank: Record<PriorityTier, number> = { now: 0, next: 1, later: 2, none: 3 };
  const ordered = [...nodes].sort((a, b) => {
    const tierDiff = rank[a.priorityTier] - rank[b.priorityTier];
    if (tierDiff !== 0) return tierDiff;
    return a.priorityOrder - b.priorityOrder;
  });

  return ordered.map((node, idx) => {
    const isLeft = idx % 2 === 0;
    const row = Math.floor(idx / 2);
    return {
      id: node.id,
      x: isLeft ? 70 : 695,
      y: 95 + row * 168,
    };
  });
}

/**
 * Finds a clean, non-overlapping spot near a parent card for a newly branched child thought.
 */
export function computeBranchPosition(
  parentNode: Pick<MapNode, 'x' | 'y'>,
  existingNodes: Pick<MapNode, 'x' | 'y'>[]
): { x: number; y: number } {
  const occupied: Box[] = [
    { ...HEARTH_BOUNDS },
    ...existingNodes.map((n) => ({
      x: n.x,
      y: n.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
  ];

  const offsets = [
    { dx: 290, dy: 0 },
    { dx: 290, dy: 165 },
    { dx: -290, dy: 0 },
    { dx: -290, dy: 165 },
    { dx: 0, dy: 175 },
    { dx: 0, dy: -175 },
    { dx: 290, dy: -165 },
    { dx: -290, dy: -165 },
    { dx: 570, dy: 40 },
    { dx: -570, dy: 40 },
  ];

  for (const { dx, dy } of offsets) {
    const candidate = {
      x: Math.round(parentNode.x + dx),
      y: Math.round(parentNode.y + dy),
    };
    const box: Box = {
      x: candidate.x,
      y: candidate.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    if (!occupied.some((other) => boxesOverlap(box, other, 18))) {
      return candidate;
    }
  }

  return {
    x: Math.round(parentNode.x + 280),
    y: Math.round(parentNode.y + 150),
  };
}
