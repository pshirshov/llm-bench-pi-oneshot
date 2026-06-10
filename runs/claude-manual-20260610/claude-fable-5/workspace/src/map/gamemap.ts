import { Rng } from '../core/rng';
import { isWalkable, Tile } from './tiles';
import { runWfc } from './wfc';

export interface StartLocation {
  x: number;
  y: number;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Uint8Array; // Tile per cell, row-major
  /** Remaining gold per cell (nonzero only on GoldMine tiles). */
  gold: Float64Array;
  /** Remaining wood per cell (nonzero only on Forest tiles). */
  wood: Float64Array;
  starts: [StartLocation, StartLocation];
}

export interface MapGenConfig {
  width: number;
  height: number;
  weights: readonly number[];
  goldPerMine: number;
  woodPerTree: number;
  /** Radius of the cleared start area. */
  clearRadius: number;
}

export const idx = (map: { width: number }, x: number, y: number): number => y * map.width + x;

export function tileAt(map: GameMap, x: number, y: number): Tile {
  return map.tiles[idx(map, x, y)] as Tile;
}

export function inBounds(map: { width: number; height: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function isWalkableAt(map: GameMap, x: number, y: number): boolean {
  return inBounds(map, x, y) && isWalkable(tileAt(map, x, y));
}

/**
 * Generate a playable map: WFC terrain, then a deterministic repair pass that
 * guarantees two mutually reachable start clearings, each with a gold mine
 * and forest in reach, with symmetric resource amounts.
 */
export function generateMap(cfg: MapGenConfig, seed: number): GameMap {
  const rng = new Rng(seed);
  const { width, height } = cfg;
  const { tiles } = runWfc(
    { width, height, weights: cfg.weights },
    rng,
  );

  const map: GameMap = {
    width,
    height,
    tiles,
    gold: new Float64Array(width * height),
    wood: new Float64Array(width * height),
    starts: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  };

  placeStarts(map, cfg, rng);
  for (const start of map.starts) {
    ensureGoldMine(map, start, cfg, rng);
    ensureForest(map, start, cfg, rng);
  }
  // Runs after resource repair so freshly planted forest cannot re-seal the
  // corridor. The carve avoids gold mines unless there is no other way.
  ensureReachability(map);

  // Stock every resource tile (repair may have added/removed some).
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tile.GoldMine) map.gold[i] = cfg.goldPerMine;
    else if (tiles[i] === Tile.Forest) map.wood[i] = cfg.woodPerTree;
    else {
      map.gold[i] = 0;
      map.wood[i] = 0;
    }
  }
  return map;
}

/** Pick two far-apart cells and flatten a clearing around each. */
function placeStarts(map: GameMap, cfg: MapGenConfig, rng: Rng): void {
  const { width: w, height: h } = map;
  const margin = cfg.clearRadius + 1;
  // The two corner pairs of a diagonal; pick one diagonal per map.
  const diag = rng.int(2);
  const corners: [StartLocation, StartLocation] =
    diag === 0
      ? [
          { x: margin, y: margin },
          { x: w - 1 - margin, y: h - 1 - margin },
        ]
      : [
          { x: w - 1 - margin, y: margin },
          { x: margin, y: h - 1 - margin },
        ];

  map.starts = [snapStart(map, corners[0], margin), snapStart(map, corners[1], margin)];
  for (const start of map.starts) clearArea(map, start, cfg.clearRadius);
}

/** Find the in-margin cell nearest the corner that costs the least to clear. */
function snapStart(map: GameMap, corner: StartLocation, margin: number): StartLocation {
  let best: StartLocation = corner;
  let bestCost = Infinity;
  // Scan a window near the corner and prefer the spot whose surrounding area
  // already contains the most open ground (cheaper, more natural repair).
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = Math.min(Math.max(corner.x + dx, margin), map.width - 1 - margin);
      const y = Math.min(Math.max(corner.y + dy, margin), map.height - 1 - margin);
      let cost = 0;
      for (let yy = y - 3; yy <= y + 3; yy++) {
        for (let xx = x - 3; xx <= x + 3; xx++) {
          if (!isWalkable(tileAt(map, xx, yy))) cost++;
        }
      }
      cost += Math.abs(dx) * 0.01 + Math.abs(dy) * 0.01;
      if (cost < bestCost) {
        bestCost = cost;
        best = { x, y };
      }
    }
  }
  return best;
}

function clearArea(map: GameMap, c: StartLocation, radius: number): void {
  for (let y = c.y - radius; y <= c.y + radius; y++) {
    for (let x = c.x - radius; x <= c.x + radius; x++) {
      if (!inBounds(map, x, y)) continue;
      map.tiles[idx(map, x, y)] = Tile.Grass;
    }
  }
}

/** BFS over walkable tiles; carve a dirt corridor if the starts are separated. */
function ensureReachability(map: GameMap): void {
  const [a, b] = map.starts;
  if (bfsReachable(map, a, b)) return;
  carveCorridor(map, true);
  if (bfsReachable(map, a, b)) return;
  carveCorridor(map, false); // last resort: plow through gold mines too
}

function carveCorridor(map: GameMap, preserveMines: boolean): void {
  const [a, b] = map.starts;
  // Carve along the straight line between starts (Bresenham), widening to 2
  // tiles so units can actually pass.
  let { x, y } = a;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        if (inBounds(map, x + ox, y + oy)) {
          const i = idx(map, x + ox, y + oy);
          const t = map.tiles[i] as Tile;
          if (!isWalkable(t) && !(preserveMines && t === Tile.GoldMine)) {
            map.tiles[i] = Tile.Dirt;
          }
        }
      }
    }
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

export function bfsReachable(map: GameMap, a: StartLocation, b: StartLocation): boolean {
  if (!isWalkableAt(map, a.x, a.y) || !isWalkableAt(map, b.x, b.y)) return false;
  const seen = new Uint8Array(map.width * map.height);
  const queue: number[] = [idx(map, a.x, a.y)];
  seen[queue[0]] = 1;
  const target = idx(map, b.x, b.y);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === target) return true;
    const x = cur % map.width;
    const y = (cur / map.width) | 0;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (!isWalkableAt(map, nx, ny)) continue;
      const ni = idx(map, nx, ny);
      if (!seen[ni]) {
        seen[ni] = 1;
        queue.push(ni);
      }
    }
  }
  return false;
}

const MINE_SEARCH_RADIUS = 10;
const FOREST_SEARCH_RADIUS = 12;
const MIN_FOREST_TILES = 8;

function ensureGoldMine(map: GameMap, start: StartLocation, cfg: MapGenConfig, rng: Rng): void {
  if (countNear(map, start, MINE_SEARCH_RADIUS, Tile.GoldMine) > 0) return;
  // Place a mine on a walkable tile near the edge of the clearing, away from
  // the start centre so the town hall has room.
  const candidates: StartLocation[] = [];
  for (let r = cfg.clearRadius - 1; r <= MINE_SEARCH_RADIUS; r++) {
    for (let y = start.y - r; y <= start.y + r; y++) {
      for (let x = start.x - r; x <= start.x + r; x++) {
        if (Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) !== r) continue;
        if (!isWalkableAt(map, x, y)) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) {
    // Degenerate map: force a spot at the clearing edge.
    candidates.push({ x: start.x + cfg.clearRadius - 1, y: start.y });
  }
  const spot = candidates[rng.int(candidates.length)];
  map.tiles[idx(map, spot.x, spot.y)] = Tile.GoldMine;
}

function ensureForest(map: GameMap, start: StartLocation, cfg: MapGenConfig, rng: Rng): void {
  const existing = countNear(map, start, FOREST_SEARCH_RADIUS, Tile.Forest);
  if (existing >= MIN_FOREST_TILES) return;
  // Plant a forest blob on grass just outside the clearing.
  let needed = MIN_FOREST_TILES - existing;
  const ring: StartLocation[] = [];
  const r0 = cfg.clearRadius + 1;
  for (let y = start.y - r0 - 2; y <= start.y + r0 + 2; y++) {
    for (let x = start.x - r0 - 2; x <= start.x + r0 + 2; x++) {
      const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
      if (d < r0 || !inBounds(map, x, y)) continue;
      if (tileAt(map, x, y) === Tile.Grass) ring.push({ x, y });
    }
  }
  while (needed > 0 && ring.length > 0) {
    const i = rng.int(ring.length);
    const spot = ring.splice(i, 1)[0];
    map.tiles[idx(map, spot.x, spot.y)] = Tile.Forest;
    needed--;
  }
}

function countNear(map: GameMap, c: StartLocation, radius: number, tile: Tile): number {
  let count = 0;
  for (let y = c.y - radius; y <= c.y + radius; y++) {
    for (let x = c.x - radius; x <= c.x + radius; x++) {
      if (inBounds(map, x, y) && tileAt(map, x, y) === tile) count++;
    }
  }
  return count;
}
