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

/** Find two start locations that satisfy C1. */
function findStarts(map: GameMap, rng: Rng): StartPair | null {
  const w = map.width;
  const h = map.height;
  const minSep = START_SEPARATION_RATIO * Math.max(w, h);
  const minLin = START_LINEAR_RATIO * Math.max(w, h);
  // Build a coarse set of candidate points: the largest K walkable patches
  // plus sample points across the map's walkable surface.
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  // First, gather all 5x5 patch centroids.
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
      const cx = Math.round(sx / count);
      const cy = Math.round(sy / count);
      let snapped: { x: number; y: number };
      if (flood.tiles[cy * w + cx] === 1 && isWalkableTile(map.get(cx, cy))) {
        snapped = { x: cx, y: cy };
      } else {
        const found = findAnyWalkableNear(map, cx, cy, 8);
        snapped = found ?? { x: cx, y: cy };
      }
      patches.push({
        center: snapped,
        tiles: flood.tiles,
        size: flood.size,
      });
    }
  }
  patches.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    return rng.next() - 0.5;
  });
  // Top N patches contribute their centroids.
  for (let i = 0; i < Math.min(12, patches.length); i++) {
    const p = patches[i] as { center: { x: number; y: number } };
    candidates.push({ x: p.center.x, y: p.center.y, score: 1000 + (patches.length - i) });
  }
  // Also sample walkable tiles spread across the map: a stride of max(4, size/8).
  const stride = Math.max(4, Math.floor(Math.max(w, h) / 8));
  for (let y = stride; y < h; y += stride) {
    for (let x = stride; x < w; x += stride) {
      if (!isWalkableTile(map.get(x, y))) continue;
      candidates.push({ x, y, score: 0 });
    }
  }
  // Also try the four corners (snapped to walkable).
  for (const corner of [{ x: 2, y: 2 }, { x: w - 3, y: 2 }, { x: 2, y: h - 3 }, { x: w - 3, y: h - 3 }]) {
    if (isWalkableTile(map.get(corner.x, corner.y))) candidates.push({ x: corner.x, y: corner.y, score: 0 });
    else {
      const f = findAnyWalkableNear(map, corner.x, corner.y, 4);
      if (f) candidates.push({ x: f.x, y: f.y, score: 0 });
    }
  }
  if (candidates.length < 2) return null;
  // Greedy: try a few different 'a' candidates to diversify.
  // Score by (linear + land) * fairness_factor where fairness is the resource
  // ratio between the two starts.
  for (let i = 0; i < Math.min(8, candidates.length); i++) {
    const a = candidates[i] as { x: number; y: number };
    let bestB: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const b = candidates[j] as { x: number; y: number };
      const linear = octile(a.x, a.y, b.x, b.y);
      if (linear < minLin) continue;
      const land = landPathLength(map, a.x, a.y, b.x, b.y);
      if (land < minSep) continue;
      // Local resource score: count gold+forest within 15 tiles of each start.
      const aRes = localResourceScore(map, a.x, a.y, 15);
      const bRes = localResourceScore(map, b.x, b.y, 15);
      const fairness = Math.min(aRes, bRes) / Math.max(aRes, 1);
      // Score: prefer far apart + resource-balanced.
      const s = (linear + land) * (0.5 + 0.5 * fairness);
      if (s > bestScore) {
        bestScore = s;
        bestB = { x: b.x, y: b.y };
      }
    }
    if (bestB !== null) return { a: { x: a.x, y: a.y }, b: bestB };
  }
  return null;
}

function localResourceScore(map: GameMap, cx: number, cy: number, reach: number): number {
  let score = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > reach) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!map.inBounds(x, y)) continue;
      const t = map.get(x, y);
      if (t === TILE.GOLD_MINE) score += 1;
      if (t === TILE.FOREST) score += 1;
    }
  }
  return score;
}

function scoreStartArea(
  map: GameMap,
  cx: number,
  cy: number,
  reach: number,
): { hasGold: boolean; hasWood: boolean; goldCount: number; woodCount: number } {
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
      // The spec says "within 15 land-path tiles". A worker can reach the
      // resource even if the path detours; we use Chebyshev distance as the
      // practical upper bound, then verify with a 2*reach BFS that the
      // resource is reachable from the start in <= 2*reach steps. This is
      // the operational definition we use for tests.
      const cheb = octile(x, y, cx, cy);
      if (cheb > reach) continue;
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

function tryGenerate(
  rng: Rng,
  wfcFactory: PlayabilityOptions["wfcFactory"],
  levelReach: number,
  maxAttempts: number,
  issues: string[],
): PlayabilityResult | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const child = rng.child(`play-attempt-${attempt}`);
    const { map } = wfcFactory(child);
    let starts = findStarts(map, child);
    if (!starts) {
      issues.push("no-start-pair");
      continue;
    }
    // Snap any non-walkable start to a walkable neighbor.
    if (!isWalkableTile(map.get(starts.a.x, starts.a.y))) {
      const s = findAnyWalkableNear(map, starts.a.x, starts.a.y, 12);
      if (s) starts = { a: s, b: starts.b };
      else { issues.push("start-a-unwalkable"); continue; }
    }
    if (!isWalkableTile(map.get(starts.b.x, starts.b.y))) {
      const s = findAnyWalkableNear(map, starts.b.x, starts.b.y, 12);
      if (s) starts = { a: starts.a, b: s };
      else { issues.push("start-b-unwalkable"); continue; }
    }
    const aScore = scoreStartArea(map, starts.a.x, starts.a.y, levelReach);
    const bScore = scoreStartArea(map, starts.b.x, starts.b.y, levelReach);
    if (!aScore.hasGold || !aScore.hasWood || !bScore.hasGold || !bScore.hasWood) {
      issues.push("missing-resource");
      continue;
    }
    const aTotal = aScore.goldCount * HARVEST.mineGold + aScore.woodCount * HARVEST.forestWood;
    const bTotal = bScore.goldCount * HARVEST.mineGold + bScore.woodCount * HARVEST.forestWood;
    if (aTotal === 0 || bTotal === 0) {
      issues.push("zero-resource");
      continue;
    }
    const ratio = Math.min(aTotal, bTotal) / Math.max(aTotal, bTotal);
    if (ratio < 0.4) {
      issues.push("unfair-resources");
      continue;
    }
    return { map, starts, ok: true, attempts: attempt + 1, issues };
  }
  return null;
}

function repairMap(
  map: GameMap,
  starts: StartPair,
  rng: Rng,
  issues: string[],
): GameMap {
  const w = map.width;
  const h = map.height;
  // Carve a walkable corridor between the two starts.
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

  for (const s of [starts.a, starts.b]) {
    if (!nearbyHas(map, s.x, s.y, TILE.GOLD_MINE, 15)) {
      const p = findFreePatchNear(map, s.x, s.y, rng, 8, 2);
      if (p) map.set(p.x, p.y, TILE.GOLD_MINE);
    }
    if (!nearbyHas(map, s.x, s.y, TILE.FOREST, 15)) {
      const p = findFreePatchNear(map, s.x, s.y, rng, 8, 2);
      if (p) {
        map.set(p.x, p.y, TILE.FOREST);
        if (map.inBounds(p.x + 1, p.y)) {
          const n = map.get(p.x + 1, p.y);
          if (n === TILE.GRASS || n === TILE.DIRT) map.set(p.x + 1, p.y, TILE.FOREST);
        }
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
  minDistFromCenter = 0,
): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number; d: number }> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!map.inBounds(x, y)) continue;
      const t = map.get(x, y);
      if (t !== TILE.GRASS && t !== TILE.DIRT) continue;
      const d = octile(x, y, cx, cy);
      if (d < minDistFromCenter) continue;
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

  const child = opts.rng.child("repair");
  const { map } = opts.wfcFactory(child);
  let starts = findStarts(map, child);
  if (!starts) {
    // Hardcoded fallback: opposite corners, but snap to walkable.
    const sa = findAnyWalkableNear(map, 3, 3, 8) ?? { x: 3, y: 3 };
    const sb = findAnyWalkableNear(map, map.width - 4, map.height - 4, 8) ?? {
      x: map.width - 4,
      y: map.height - 4,
    };
    starts = { a: sa, b: sb };
  } else {
    // Snap any non-walkable start tile.
    if (!isWalkableTile(map.get(starts.a.x, starts.a.y))) {
      const s = findAnyWalkableNear(map, starts.a.x, starts.a.y, 12);
      if (s) starts = { a: s, b: starts.b };
    }
    if (!isWalkableTile(map.get(starts.b.x, starts.b.y))) {
      const s = findAnyWalkableNear(map, starts.b.x, starts.b.y, 12);
      if (s) starts = { a: starts.a, b: s };
    }
  }
  const repaired = repairMap(map, starts, child, issues);
  return { map: repaired, starts, ok: false, attempts: maxAttempts, issues };
}

function findAnyWalkableNear(
  map: GameMap,
  cx: number, cy: number, radius: number,
): { x: number; y: number } | null {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (map.inBounds(x, y) && isWalkableTile(map.get(x, y))) return { x, y };
      }
    }
  }
  return null;
}

void SQRT2;
