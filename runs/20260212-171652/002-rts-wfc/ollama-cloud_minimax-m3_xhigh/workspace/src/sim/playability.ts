// Playability pass: validates that a WFC-generated map is actually playable
// per spec C1 (start separation), per-side resource availability, and
// contiguous buildable area. Repairs maps that fail the pass deterministically
// so generation always terminates.

import { TILE, TileType, isWalkableTile } from "./tiles.js";
import { GameMap } from "./map.js";
import { Rng } from "./rng.js";
import { landPathLength, octile, SQRT2 } from "./pathfinding.js";
import { HARVEST } from "./stats.js";

export interface StartPair {
  readonly a: { x: number; y: number };
  readonly b: { x: number; y: number };
}

export interface PlayabilityResult {
  readonly map: GameMap;
  readonly starts: StartPair;
  readonly ok: boolean;
  readonly attempts: number;
  readonly issues: string[];
}

export interface PlayabilityOptions {
  readonly rng: Rng;
  /** Max deterministic re-collapse attempts. */
  readonly maxCollapseAttempts?: number;
  /** WFC option factory given a child RNG. */
  readonly wfcFactory: (rng: Rng) => { width: number; height: number; map: GameMap };
}

const MIN_BUILDABLE = 5;
const START_SEPARATION_RATIO = 0.6; // C1: land-path >= 60% of larger dim
const START_LINEAR_RATIO = 0.4; // C1: straight-line >= 40%

/** Find largest contiguous walkable patch (BFS). */
function floodWalkable(map: GameMap, sx: number, sy: number): { tiles: Uint8Array; size: number } {
  const N = map.width * map.height;
  const seen = new Uint8Array(N);
  const out = new Uint8Array(N);
  if (!map.inBounds(sx, sy) || !isWalkableTile(map.get(sx, sy))) {
    return { tiles: out, size: 0 };
  }
  const stack: Array<[number, number]> = [[sx, sy]];
  let size = 0;
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  while (stack.length > 0) {
    const [x, y] = stack.pop() as [number, number];
    const idx = y * map.width + x;
    if (seen[idx] === 1) continue;
    seen[idx] = 1;
    if (!isWalkableTile(map.get(x, y))) continue;
    out[idx] = 1;
    size++;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      stack.push([nx, ny]);
    }
  }
  return { tiles: out, size };
}

/** Find the centers of the two largest walkable patches that satisfy C1. */
function findStarts(map: GameMap, rng: Rng): StartPair | null {
  const w = map.width;
  const h = map.height;
  const minSep = START_SEPARATION_RATIO * Math.max(w, h);
  const minLin = START_LINEAR_RATIO * Math.max(w, h);
  // Find all candidate patches >= 5x5.
  const patches: Array<{ center: { x: number; y: number }; tiles: Uint8Array; size: number }> = [];
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i] === 1) continue;
      if (!isWalkableTile(map.get(x, y))) {
        seen[i] = 1;
        continue;
      }
      const flood = floodWalkable(map, x, y);
      for (let j = 0; j < flood.tiles.length; j++) {
        if (flood.tiles[j] === 1) seen[j] = 1;
      }
      if (flood.size < MIN_BUILDABLE * MIN_BUILDABLE) continue;
      // Compute center as centroid over walkable tiles.
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          if (flood.tiles[yy * w + xx] === 1) {
            sx += xx;
            sy += yy;
            count++;
          }
        }
      }
      patches.push({
        center: { x: Math.round(sx / count), y: Math.round(sy / count) },
        tiles: flood.tiles,
        size: flood.size,
      });
    }
  }
  if (patches.length < 2) return null;
  // Sort by size desc, then jitter with rng for determinism.
  patches.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    return rng.next() - 0.5;
  });
  // Try pairs in size order, accept first that meets C1.
  for (let i = 0; i < Math.min(8, patches.length); i++) {
    for (let j = i + 1; j < Math.min(16, patches.length); j++) {
      const a = patches[i] as { center: { x: number; y: number } };
      const b = patches[j] as { center: { x: number; y: number } };
      const linear = octile(a.center.x, a.center.y, b.center.x, b.center.y);
      if (linear < minLin) continue;
      const land = landPathLength(map, a.center.x, a.center.y, b.center.x, b.center.y);
      if (land < minSep) continue;
      return { a: a.center, b: b.center };
    }
  }
  return null;
}

/** Returns true if the start location has both a gold mine and a forest within
 *  `reach` land-path tiles, plus an estimate of the local resources. */
function scoreStartArea(map: GameMap, cx: number, cy: number, reach: number): {
  hasGold: boolean;
  hasWood: boolean;
  goldCount: number;
  woodCount: number;
} {
  let hasGold = false;
  let hasWood = false;
  let goldCount = 0;
  let woodCount = 0;
  const w = map.width;
  const h = map.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = map.get(x, y);
      if (t !== TILE.GOLD_MINE && t !== TILE.FOREST) continue;
      const dist = landPathLength(map, cx, cy, x, y);
      if (dist > reach) continue;
      if (t === TILE.GOLD_MINE) {
        hasGold = true;
        goldCount++;
      } else {
        hasWood = true;
        woodCount++;
      }
    }
  }
  return { hasGold, hasWood, goldCount, woodCount };
}

/** Bounded deterministic re-collapse attempts. */
function tryGenerate(
  rng: Rng,
  wfcFactory: PlayabilityOptions["wfcFactory"],
  levelReach: number,
  maxAttempts: number,
  issues: string[],
): PlayabilityResult | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const child = rng.child(`play-attempt-${attempt}`);
    const { width, height, map } = wfcFactory(child);
    void width;
    void height;
    const starts = findStarts(map, child);
    if (!starts) {
      issues.push("no-start-pair");
      continue;
    }
    const aScore = scoreStartArea(map, starts.a.x, starts.a.y, levelReach);
    const bScore = scoreStartArea(map, starts.b.x, starts.b.y, levelReach);
    if (!aScore.hasGold || !aScore.hasWood || !bScore.hasGold || !bScore.hasWood) {
      issues.push("missing-resource");
      continue;
    }
    // Fairness ~30%.
    const aTotal = aScore.goldCount * HARVEST.mineGold + aScore.woodCount * HARVEST.forestWood;
    const bTotal = bScore.goldCount * HARVEST.mineGold + bScore.woodCount * HARVEST.forestWood;
    if (aTotal === 0 || bTotal === 0) {
      issues.push("zero-resource");
      continue;
    }
    const ratio = Math.min(aTotal, bTotal) / Math.max(aTotal, bTotal);
    if (ratio < 0.7) {
      issues.push("unfair-resources");
      continue;
    }
    return { map, starts, ok: true, attempts: attempt + 1, issues };
  }
  return null;
}

/** Deterministically repair a map by carving a land corridor and placing
 *  required resources near both start locations. */
function repairMap(
  map: GameMap,
  starts: StartPair,
  rng: Rng,
  issues: string[],
): GameMap {
  const w = map.width;
  const h = map.height;
  // Carve a path of walkable tiles between the two starts using line-of-sight
  // with water/rock obstacles turned to dirt.
  let cx = starts.a.x;
  let cy = starts.a.y;
  const goalX = starts.b.x;
  const goalY = starts.b.y;
  const maxIters = w * h;
  let iters = 0;
  while ((cx !== goalX || cy !== goalY) && iters++ < maxIters) {
    map.set(cx, cy, TILE.GRASS);
    if (cx < goalX) cx++;
    else if (cx > goalX) cx--;
    else if (cy < goalY) cy++;
    else if (cy > goalY) cy--;
  }
  map.set(cx, cy, TILE.GRASS);

  // Place at least one gold mine and one forest within 15 land-path tiles of
  // each start.
  for (const s of [starts.a, starts.b]) {
    if (!nearbyHas(map, s.x, s.y, TILE.GOLD_MINE, 15)) {
      const p = findFreePatchNear(map, s.x, s.y, rng, 8);
      if (p) map.set(p.x, p.y, TILE.GOLD_MINE);
    }
    if (!nearbyHas(map, s.x, s.y, TILE.FOREST, 15)) {
      const p = findFreePatchNear(map, s.x, s.y, rng, 8);
      if (p) {
        // Place a 2x2 forest cluster.
        map.set(p.x, p.y, TILE.FOREST);
        const n = map.inBounds(p.x + 1, p.y) ? map.get(p.x + 1, p.y) : TILE.ROCK;
        if (n === TILE.GRASS || n === TILE.DIRT) map.set(p.x + 1, p.y, TILE.FOREST);
      }
    }
  }
  issues.push("repaired");
  return map;
}

function nearbyHas(map: GameMap, cx: number, cy: number, t: TileType, reach: number): boolean {
  const w = map.width;
  const h = map.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (map.get(x, y) !== t) continue;
      if (octile(x, y, cx, cy) <= reach) return true;
    }
  }
  return false;
}

function findFreePatchNear(
  map: GameMap,
  cx: number,
  cy: number,
  rng: Rng,
  radius: number,
): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number; d: number }> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!map.inBounds(x, y)) continue;
      if (map.get(x, y) !== TILE.GRASS && map.get(x, y) !== TILE.DIRT) continue;
      const d = octile(x, y, cx, cy);
      candidates.push({ x, y, d });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.d !== b.d) return a.d - b.d;
    return rng.next() - 0.5;
  });
  return candidates[0] as { x: number; y: number };
}

/** Main entry point: generate a playable map. Always returns a map + starts. */
export function generatePlayableMap(opts: PlayabilityOptions): PlayabilityResult {
  const issues: string[] = [];
  const maxAttempts = opts.maxCollapseAttempts ?? 6;
  const levelReach = 15;
  const result = tryGenerate(opts.rng, opts.wfcFactory, levelReach, maxAttempts, issues);
  if (result !== null) return result;

  // Last resort: take the most recent WFC map and repair.
  const child = opts.rng.child("repair");
  const { map } = opts.wfcFactory(child);
  let starts = findStarts(map, child);
  if (!starts) {
    // Force two opposite corners.
    starts = {
      a: { x: 3, y: 3 },
      b: { x: map.width - 4, y: map.height - 4 },
    };
  }
  const repaired = repairMap(map, starts, child, issues);
  return { map: repaired, starts, ok: false, attempts: maxAttempts, issues };
}

void SQRT2;
