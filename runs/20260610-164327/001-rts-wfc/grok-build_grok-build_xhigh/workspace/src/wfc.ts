import type { Tile } from './types';
import type { RNG } from './rng';
import { pickWeighted } from './rng';

export type TileId = Tile;

const TILES: TileId[] = ['grass', 'dirt', 'forest', 'water', 'rock', 'goldmine'];

interface AdjacencyRule {
  // For each direction: N E S W NE NW SE SW  (0-7)
  // Each entry is the set of tiles allowed next to this one in that dir.
  neighbors: TileId[][];
}

// Build explicit adjacency rules (symmetric where makes sense)
const ADJ_RULES: Record<TileId, AdjacencyRule> = {
  grass: {
    neighbors: [
      ['grass', 'dirt', 'forest'], // N
      ['grass', 'dirt', 'forest', 'goldmine'], // E
      ['grass', 'dirt', 'forest'], // S
      ['grass', 'dirt', 'forest', 'goldmine'], // W
      ['grass', 'dirt', 'forest'], // NE
      ['grass', 'dirt', 'forest'], // NW
      ['grass', 'dirt', 'forest'], // SE
      ['grass', 'dirt', 'forest'], // SW
    ]
  },
  dirt: {
    neighbors: [
      ['grass', 'dirt', 'forest', 'rock', 'goldmine'],
      ['grass', 'dirt', 'forest', 'rock', 'goldmine', 'water'],
      ['grass', 'dirt', 'forest', 'rock', 'goldmine'],
      ['grass', 'dirt', 'forest', 'rock', 'goldmine', 'water'],
      ['grass', 'dirt', 'forest', 'rock'],
      ['grass', 'dirt', 'forest', 'rock'],
      ['grass', 'dirt', 'forest', 'rock'],
      ['grass', 'dirt', 'forest', 'rock'],
    ]
  },
  forest: {
    neighbors: [
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
    ]
  },
  water: {
    neighbors: [
      ['water', 'dirt'],
      ['water', 'dirt'],
      ['water', 'dirt'],
      ['water', 'dirt'],
      ['water', 'dirt'],
      ['water', 'dirt'],
      ['water', 'dirt'],
      ['water', 'dirt'],
    ]
  },
  rock: {
    neighbors: [
      ['rock', 'dirt'],
      ['rock', 'dirt'],
      ['rock', 'dirt'],
      ['rock', 'dirt'],
      ['rock', 'dirt'],
      ['rock', 'dirt'],
      ['rock', 'dirt'],
      ['rock', 'dirt'],
    ]
  },
  goldmine: {
    neighbors: [
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
      ['grass', 'dirt', 'forest'],
    ]
  }
};

// Weights for initial possibilities (higher = more common)
const TILE_WEIGHTS: Record<TileId, number> = {
  grass: 35,
  dirt: 22,
  forest: 18,
  water: 9,
  rock: 7,
  goldmine: 2.5
};

const DIRS = [
  { dx: 0, dy: -1 }, // N 0
  { dx: 1, dy: 0 },  // E 1
  { dx: 0, dy: 1 },  // S 2
  { dx: -1, dy: 0 }, // W 3
  { dx: 1, dy: -1 }, // NE 4
  { dx: -1, dy: -1 },// NW 5
  { dx: 1, dy: 1 },  // SE 6
  { dx: -1, dy: 1 }, // SW 7
];

export interface WFCOpts {
  width: number;
  height: number;
  rng: RNG;
  maxAttempts?: number;
}

export interface WFCResult {
  tiles: TileId[][];
  attempts: number;
  success: boolean;
}

function createWave(w: number, h: number): Set<TileId>[][] {
  const wave: Set<TileId>[][] = [];
  for (let y = 0; y < h; y++) {
    wave[y] = [];
    for (let x = 0; x < w; x++) {
      wave[y][x] = new Set(TILES);
    }
  }
  return wave;
}

function getAllowedNeighbors(tile: TileId, dirIdx: number): TileId[] {
  return ADJ_RULES[tile].neighbors[dirIdx];
}

function propagate(wave: Set<TileId>[][], w: number, h: number, stack: Array<{x:number,y:number}>): boolean {
  while (stack.length > 0) {
    const {x, y} = stack.pop()!;
    const currPoss = wave[y][x];
    if (currPoss.size === 0) return false;

    for (let d = 0; d < 8; d++) {
      const nx = x + DIRS[d].dx;
      const ny = y + DIRS[d].dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

      const neighPoss = wave[ny][nx];
      if (neighPoss.size === 0) return false;

      let changed = false;
      for (const nTile of Array.from(neighPoss)) {
        // Check if nTile is compatible with ANY possibility in currPoss
        let compatible = false;
        for (const cTile of currPoss) {
          const allowed = getAllowedNeighbors(cTile, d);
          if (allowed.includes(nTile)) {
            compatible = true;
            break;
          }
        }
        if (!compatible) {
          neighPoss.delete(nTile);
          changed = true;
        }
      }
      if (changed) {
        if (neighPoss.size === 0) return false;
        stack.push({x: nx, y: ny});
      }
    }
  }
  return true;
}

function findMinEntropyCell(wave: Set<TileId>[][], w: number, h: number, rng: RNG): {x:number,y:number} | null {
  let minEnt = Infinity;
  let candidates: Array<{x:number,y:number,ent:number}> = [];
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const s = wave[y][x].size;
      if (s === 0) return null;
      if (s === 1) continue;
      // entropy with weight consideration (approximate)
      let ent = 0;
      for (const t of wave[y][x]) {
        const wt = TILE_WEIGHTS[t];
        ent -= wt * Math.log(wt); // not normalized but ok for comparison
      }
      const noise = (rng() - 0.5) * 0.001; // tie break
      const score = ent + noise;
      if (score < minEnt - 1e-9) {
        minEnt = score;
        candidates = [{x,y,ent: score}];
      } else if (Math.abs(score - minEnt) < 1e-6) {
        candidates.push({x,y,ent: score});
      }
    }
  }
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(rng() * candidates.length)];
  return {x: pick.x, y: pick.y};
}

function collapseCell(wave: Set<TileId>[][], x: number, y: number, rng: RNG): boolean {
  const poss = Array.from(wave[y][x]);
  if (poss.length === 0) return false;
  const weights = poss.map(t => TILE_WEIGHTS[t]);
  const chosen = pickWeighted(poss, weights, rng);
  wave[y][x] = new Set([chosen]);
  return true;
}

function observe(wave: Set<TileId>[][], w: number, h: number, rng: RNG): boolean {
  const cell = findMinEntropyCell(wave, w, h, rng);
  if (!cell) return true; // fully collapsed
  if (!collapseCell(wave, cell.x, cell.y, rng)) return false;
  const stack = [{x: cell.x, y: cell.y}];
  return propagate(wave, w, h, stack);
}

export function runWFC(opts: WFCOpts): WFCResult {
  const { width: w, height: h, rng, maxAttempts = 12 } = opts;
  let attempts = 0;
  let lastTiles: TileId[][] | null = null;

  while (attempts < maxAttempts) {
    attempts++;
    const wave = createWave(w, h);
    // Optional seed bias: place some forced tiles for interesting maps
    // But keep fully procedural + deterministic via rng
    let ok = true;
    // Initial collapse of a few cells to kickstart
    const seedCells = 3 + Math.floor(rng() * 3);
    for (let i=0; i<seedCells && ok; i++) {
      const sx = Math.floor(rng() * w);
      const sy = Math.floor(rng() * h);
      if (wave[sy][sx].size > 1) {
        if (!collapseCell(wave, sx, sy, rng)) ok = false;
        else {
          const st = [{x:sx, y:sy}];
          if (!propagate(wave, w, h, st)) ok = false;
        }
      }
    }
    if (!ok) continue;

    let collapsed = true;
    while (true) {
      const done = observe(wave, w, h, rng);
      if (!done) {
        collapsed = false;
        break;
      }
      // check if fully collapsed
      let fully = true;
      for (let y=0; y<h; y++) for (let x=0; x<w; x++) if (wave[y][x].size !== 1) { fully=false; break; }
      if (fully) break;
    }

    if (collapsed) {
      const tiles: TileId[][] = [];
      for (let y=0; y<h; y++) {
        tiles[y] = [];
        for (let x=0; x<w; x++) {
          const s = Array.from(wave[y][x]);
          tiles[y][x] = s.length === 1 ? s[0] : 'grass'; // fallback
        }
      }
      lastTiles = tiles;
      return { tiles, attempts, success: true };
    }
  }

  // Fallback deterministic simple map if WFC repeatedly fails (rare)
  const tiles: TileId[][] = [];
  for (let y=0; y<h; y++) {
    tiles[y] = [];
    for (let x=0; x<w; x++) {
      const r = rng();
      if (r < 0.08) tiles[y][x] = 'water';
      else if (r < 0.15) tiles[y][x] = 'rock';
      else if (r < 0.32) tiles[y][x] = 'forest';
      else if (r < 0.37) tiles[y][x] = 'goldmine';
      else if (r < 0.55) tiles[y][x] = 'dirt';
      else tiles[y][x] = 'grass';
    }
  }
  return { tiles, attempts, success: false };
}

// Utility: count tile occurrences
export function countTiles(tiles: TileId[][]): Record<TileId, number> {
  const cnt: Partial<Record<TileId, number>> = {};
  for (const row of tiles) for (const t of row) cnt[t] = (cnt[t] || 0) + 1;
  return cnt as Record<TileId, number>;
}
