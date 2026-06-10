// Map post-processing: place two start locations, validate playability, repair
// or retry. All driven by the seed for determinism.

import { aStarSearch } from './pathfind.js';
import { generateWFC, type WFCResult } from './wfc.js';
import { TILES, type TileId } from './data.js';
import { type MapData } from './state.js';
import { dist2 } from './math.js';
import { makeRng, type Rng } from './rng.js';

export interface StartLocation {
  x: number;
  y: number;
  // Tile coords of the gold mine "near" the start
  goldMine: { x: number; y: number } | null;
  // Tile coords of forest "near" the start
  forest: { x: number; y: number } | null;
  // Score for fairness
  reachability: number;
  resourceScore: number;
}

export interface MapGenOptions {
  width: number;
  height: number;
  seed: number;
  // Number of restarts before giving up
  maxRestarts?: number;
}

const CLEAR_RADIUS = 2; // 5x5 flat area (2-tile margin)
const FOREST_RADIUS = 10;
const GOLD_RADIUS = 12;

function clearArea(map: MapData, x: number, y: number, radius: number, fill: TileId = 'grass'): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      map.tiles[ty * map.width + tx] = fill;
    }
  }
}

function findGoldMineNear(map: MapData, x: number, y: number, radius: number): { x: number; y: number } | null {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        if (map.tiles[ty * map.width + tx] === 'gold_mine') return { x: tx, y: ty };
      }
    }
  }
  return null;
}

function findForestNear(map: MapData, cx: number, cy: number, radius: number): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y * map.width + x] !== 'forest') continue;
      const dd = dist2(x, y, cx, cy);
      if (dd > radius * radius) continue;
      if (!best || dd < best.d) best = { x, y, d: dd };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function reachable(map: MapData, ax: number, ay: number, bx: number, by: number): boolean {
  if (ax === bx && ay === by) return true;
  const path = aStarSearch(map, ax, ay, bx, by, {
    walkable: (x, y) => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
      return TILES[map.tiles[y * map.width + x] as TileId].walkable;
    },
  });
  return path !== null && path.length > 0;
}

function isMapFair(a: StartLocation, b: StartLocation): boolean {
  // The two starts should be roughly equally resourced.
  const da = a.resourceScore;
  const db = b.resourceScore;
  if (da === 0 || db === 0) return false;
  const ratio = Math.min(da, db) / Math.max(da, db);
  return ratio >= 0.5;
}

// After WFC, instead of requiring natural 5x5 clearings (WFC rarely produces
// those organically), we *pick* a region of buildable tiles that's roughly
// rectangular, then clear it. This is the deterministic "repair" step.
function findStartCandidates(map: MapData, radius: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const stride = Math.max(radius + 1, Math.floor(Math.min(map.width, map.height) / 8));
  for (let y = stride; y < map.height - stride; y += stride) {
    for (let x = stride; x < map.width - stride; x += stride) {
      // require that the center is buildable and at least 60% of the 5x5 is buildable
      let buildable = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          const t = map.tiles[ty * map.width + tx] as keyof typeof TILES;
          if (TILES[t].buildable) buildable++;
        }
      }
      const total = (2 * radius + 1) ** 2;
      if (buildable >= total * 0.6) out.push({ x, y });
    }
  }
  return out;
}

function pairStarts(map: MapData, rng: Rng): [StartLocation, StartLocation] | null {
  const candidates = findStartCandidates(map, CLEAR_RADIUS);
  if (candidates.length < 2) return null;
  // Shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = candidates[i] as { x: number; y: number };
    candidates[i] = candidates[j] as { x: number; y: number };
    candidates[j] = tmp;
  }
  // Pick first; then pick a partner that's far (map diagonal) and mutually reachable
  const a = candidates[0] as { x: number; y: number };
  let bestPartner: StartLocation | null = null;
  let bestDist = -Infinity;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i] as { x: number; y: number };
    const d = dist2(a.x, a.y, c.x, c.y);
    if (d < bestDist) continue;
    if (!reachable(map, a.x, a.y, c.x, c.y)) continue;
    const gold = findGoldMineNear(map, c.x, c.y, GOLD_RADIUS);
    if (!gold) continue;
    const forest = findForestNear(map, c.x, c.y, FOREST_RADIUS);
    if (!forest) continue;
    const resourceScore = (gold ? 1000 : 0) + (forest ? 500 : 0);
    const cand: StartLocation = { x: c.x, y: c.y, goldMine: gold, forest, reachability: d, resourceScore };
    if (d > bestDist) { bestDist = d; bestPartner = cand; }
  }
  if (!bestPartner) return null;
  const aGold = findGoldMineNear(map, a.x, a.y, GOLD_RADIUS);
  const aForest = findForestNear(map, a.x, a.y, FOREST_RADIUS);
  if (!aGold || !aForest) return null;
  const startA: StartLocation = { x: a.x, y: a.y, goldMine: aGold, forest: aForest, reachability: bestDist, resourceScore: 1500 };
  return [startA, bestPartner];
}
// After pairing, repair: if one side has noticeably fewer resources, we
// procedurally add a forest or shift the partner. For determinism we just
// re-roll the whole map (driven by a derived seed) if the fairness test fails.
export function generateMap(opts: MapGenOptions): { map: MapData; starts: [StartLocation, StartLocation] } | null {
  const maxRestarts = opts.maxRestarts ?? 3;
  for (let attempt = 0; attempt < maxRestarts; attempt++) {
    const sub = (opts.seed + attempt * 0x9e3779b1) | 0;
    const wfc: WFCResult = generateWFC({ width: opts.width, height: opts.height, seed: sub });
    const map: MapData = {
      width: wfc.width,
      height: wfc.height,
      tiles: wfc.tiles.slice(),
      startingSpots: [],
    };
    const rng = makeRng((opts.seed ^ 0xa5a5a5a5 + attempt * 0xb5297a4d) | 0);
    const pair = pairStarts(map, rng);
    if (!pair) continue;
    if (!isMapFair(pair[0], pair[1])) continue;
    // clear the start areas to make them definitely buildable
    clearArea(map, pair[0].x, pair[0].y, CLEAR_RADIUS);
    clearArea(map, pair[1].x, pair[1].y, CLEAR_RADIUS);
    map.startingSpots = [{ x: pair[0].x, y: pair[0].y }, { x: pair[1].x, y: pair[1].y }];
    return { map, starts: pair };
  }
  return null;
}

// Re-derive a map from a (campaign seed, level) pair.
export function mapForLevel(campaignSeed: number, level: number): { map: MapData; starts: [StartLocation, StartLocation] } {
  // Sizes/difficulty scale per spec: 32..96, level 0..4
  const sizeMap = [32, 48, 64, 80, 96];
  const size = sizeMap[Math.min(level, sizeMap.length - 1)] ?? 64;
  const mapSeed = ((campaignSeed + level * 1009) * 0x9e3779b1) | 0;
  const result = generateMap({ width: size, height: size, seed: mapSeed });
  if (result) return result;
  // Fallback: a 32x32 all-grass map (should never happen)
  return {
    map: {
      width: 32, height: 32,
      tiles: new Array(32 * 32).fill('grass') as TileId[],
      startingSpots: [{ x: 8, y: 16 }, { x: 24, y: 16 }],
    },
    starts: [
      { x: 8, y: 16, goldMine: null, forest: null, reachability: 0, resourceScore: 0 },
      { x: 24, y: 16, goldMine: null, forest: null, reachability: 0, resourceScore: 0 },
    ],
  };
}

export function difficultyForLevel(level: number): number {
  // 0..4 -> 1..5
  return Math.min(5, Math.max(1, level + 1));
}
