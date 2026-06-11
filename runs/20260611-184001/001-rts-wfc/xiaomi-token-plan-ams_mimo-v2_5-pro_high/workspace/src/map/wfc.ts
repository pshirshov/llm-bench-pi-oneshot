/**
 * Wave Function Collapse map generator.
 * Minimal-entropy cell selection with adjacency-constraint propagation.
 */
import { TileType } from '../engine/types.js';
import { PRNG } from '../engine/prng.js';

export interface WFCOptions {
  width: number;
  height: number;
  weights: Record<TileType, number>;
  seed: number;
}

/** Adjacency rules: for each tile type, which types can be adjacent (4-directional) */
const ADJACENCY: Record<TileType, Set<TileType>> = {
  grass: new Set(['grass', 'dirt', 'forest', 'gold_mine', 'rock']),
  dirt: new Set(['grass', 'dirt', 'forest', 'gold_mine', 'rock', 'water']),
  forest: new Set(['grass', 'dirt', 'forest', 'gold_mine']),
  water: new Set(['water', 'dirt', 'rock']),
  rock: new Set(['rock', 'grass', 'dirt', 'water']),
  gold_mine: new Set(['grass', 'dirt', 'forest']),
};

const ALL_TYPES: TileType[] = ['grass', 'dirt', 'forest', 'water', 'rock', 'gold_mine'];

export function generateWFCMap(opts: WFCOptions): TileType[][] {
  const { width, height, weights } = opts;
  const rng = new PRNG(opts.seed);

  // Each cell has a set of possible types
  const cells: Set<TileType>[][] = [];
  for (let y = 0; y < height; y++) {
    cells[y] = [];
    for (let x = 0; x < width; x++) {
      cells[y][x] = new Set(ALL_TYPES);
    }
  }

  // Weighted random choice
  function weightedRandom(possible: Set<TileType>): TileType {
    let total = 0;
    for (const t of possible) total += weights[t];
    let r = rng.next() * total;
    for (const t of possible) {
      r -= weights[t];
      if (r <= 0) return t;
    }
    return [...possible][possible.size - 1];
  }

  // Shannon entropy for cell selection
  function entropy(x: number, y: number): number {
    const possible = cells[y][x];
    if (possible.size <= 1) return -1; // Already collapsed
    let total = 0;
    let sumLog = 0;
    for (const t of possible) {
      const w = weights[t];
      total += w;
      sumLog += w * Math.log(w);
    }
    return Math.log(total) - sumLog / total + rng.next() * 0.001; // tiny noise for tie-breaking
  }

  // Propagate constraints from a cell
  function propagate(sx: number, sy: number): boolean {
    const stack: Array<[number, number]> = [[sx, sy]];
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const possible = cells[cy][cx];

      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const neighbor = cells[ny][nx];
        let changed = false;

        // Compute allowed types for neighbor based on what's possible at (cx, cy)
        const allowed = new Set<TileType>();
        for (const t of possible) {
          for (const adj of ADJACENCY[t]) {
            allowed.add(adj);
          }
        }

        // Remove types not in allowed
        for (const t of [...neighbor]) {
          if (!allowed.has(t)) {
            neighbor.delete(t);
            changed = true;
          }
        }

        if (neighbor.size === 0) return false; // contradiction
        if (changed) stack.push([nx, ny]);
      }
    }
    return true;
  }

  // Main collapse loop
  let iterations = 0;
  const maxIterations = width * height * 10;

  while (iterations < maxIterations) {
    iterations++;

    // Find cell with minimum entropy (most constrained)
    let minEntropy = Infinity;
    let bestX = -1, bestY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (cells[y][x].size <= 1) continue;
        const e = entropy(x, y);
        if (e >= 0 && e < minEntropy) {
          minEntropy = e;
          bestX = x;
          bestY = y;
        }
      }
    }

    if (bestX === -1) break; // All cells collapsed

    // Collapse: pick a type based on weights
    cells[bestY][bestX] = new Set([weightedRandom(cells[bestY][bestX])]);

    // Propagate
    if (!propagate(bestX, bestY)) {
      // Contradiction — restart with different seed variation
      const newSeed = opts.seed + iterations;
      return generateWFCMap({ ...opts, seed: newSeed });
    }
  }

  // Extract result
  const result: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      const possible = cells[y][x];
      result[y][x] = possible.size === 1 ? [...possible][0] : 'grass';
    }
  }

  return result;
}

/** Playability pass: ensure two valid start locations with resources nearby */
export interface StartLocation {
  x: number;
  y: number;
}

export function findStartLocations(
  map: TileType[][],
  rng: PRNG,
  mapW: number,
  mapH: number
): [StartLocation, StartLocation] | null {
  // Find large open areas for starting positions
  const buildable = (t: TileType) => t === 'grass' || t === 'dirt';

  function findClearing(preferX: number, preferY: number): StartLocation | null {
    // Search in a spiral from preferred location
    for (let r = 0; r < Math.max(mapW, mapH); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = preferX + dx;
          const y = preferY + dy;
          if (x < 4 || x >= mapW - 4 || y < 4 || y >= mapH - 4) continue;

          // Check 5x5 area is buildable
          let ok = true;
          for (let oy = 0; oy < 5; oy++) {
            for (let ox = 0; ox < 5; ox++) {
              if (!buildable(map[y + oy - 2]?.[x + ox - 2])) { ok = false; break; }
            }
            if (!ok) break;
          }
          if (ok) return { x, y };
        }
      }
    }
    return null;
  }

  // Prefer opposite corners
  const loc1 = findClearing(Math.floor(mapW * 0.2), Math.floor(mapH * 0.2));
  const loc2 = findClearing(Math.floor(mapW * 0.8), Math.floor(mapH * 0.8));

  if (!loc1 || !loc2) return null;

  // Ensure they're far enough apart
  const dist = Math.abs(loc1.x - loc2.x) + Math.abs(loc1.y - loc2.y);
  if (dist < Math.min(mapW, mapH) * 0.4) return null;

  return [loc1, loc2];
}

/** Place resources near start locations */
export function placeResources(
  map: TileType[][],
  starts: [StartLocation, StartLocation],
  rng: PRNG,
  mapW: number,
  mapH: number
): void {
  for (const start of starts) {
    // Place gold mine within 6 tiles
    let placed = false;
    for (let r = 3; r <= 8 && !placed; r++) {
      for (let attempt = 0; attempt < 20 && !placed; attempt++) {
        const angle = rng.next() * Math.PI * 2;
        const gx = Math.round(start.x + Math.cos(angle) * r);
        const gy = Math.round(start.y + Math.sin(angle) * r);
        if (gx >= 1 && gx < mapW - 1 && gy >= 1 && gy < mapH - 1) {
          const t = map[gy][gx];
          if (t === 'grass' || t === 'dirt') {
            map[gy][gx] = 'gold_mine';
            placed = true;
          }
        }
      }
    }

    // Place forest cluster within 6 tiles
    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const r = 4 + rng.int(0, 3);
      const fx = Math.round(start.x + Math.cos(angle) * r);
      const fy = Math.round(start.y + Math.sin(angle) * r);
      if (fx >= 1 && fx < mapW - 1 && fy >= 1 && fy < mapH - 1) {
        // Place a cluster of forest
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const tx = fx + dx;
            const ty = fy + dy;
            if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
              const t = map[ty][tx];
              if (t === 'grass' || t === 'dirt') {
                if (rng.next() < 0.7) map[ty][tx] = 'forest';
              }
            }
          }
        }
        break;
      }
    }
  }
}

/** Ensure there's a land path between two points using BFS */
export function ensureReachability(
  map: TileType[][],
  a: StartLocation,
  b: StartLocation,
  mapW: number,
  mapH: number
): boolean {
  const walkable = (t: TileType) => t !== 'water' && t !== 'rock';
  const visited = new Set<string>();
  const queue: Array<[number, number]> = [[a.x, a.y]];
  visited.add(`${a.x},${a.y}`);
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    if (cx === b.x && cy === b.y) return true;

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (nx < 0 || nx >= mapW || ny < 0 || ny >= mapH) continue;
      if (!walkable(map[ny][nx])) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

/** Generate a complete playable map */
export function generateMap(
  mapW: number,
  mapH: number,
  seed: number,
  level: number
): { tiles: TileType[][]; starts: [StartLocation, StartLocation] } {
  const weights: Record<TileType, number> = {
    grass: 40,
    dirt: 15,
    forest: 20 + level * 2,
    water: 8 + level * 3,
    rock: 8 + level * 2,
    gold_mine: 2
  };

  for (let attempt = 0; attempt < 20; attempt++) {
    const mapSeed = seed + attempt * 1000;
    const tiles = generateWFCMap({ width: mapW, height: mapH, weights, seed: mapSeed });

    const mapRng = new PRNG(mapSeed);
    const starts = findStartLocations(tiles, mapRng, mapW, mapH);
    if (!starts) continue;

    // Place resources
    placeResources(tiles, starts, mapRng, mapW, mapH);

    // Ensure reachability
    if (!ensureReachability(tiles, starts[0], starts[1], mapW, mapH)) {
      // Carve a path through non-water
      carvePath(tiles, starts[0], starts[1], mapW, mapH);
    }

    return { tiles, starts };
  }

  // Fallback: simple map
  const tiles: TileType[][] = [];
  const fallbackRng = new PRNG(seed);
  for (let y = 0; y < mapH; y++) {
    tiles[y] = [];
    for (let x = 0; x < mapW; x++) {
      const r = fallbackRng.next();
      if (r < 0.6) tiles[y][x] = 'grass';
      else if (r < 0.75) tiles[y][x] = 'dirt';
      else if (r < 0.85) tiles[y][x] = 'forest';
      else tiles[y][x] = 'grass';
    }
  }
  const starts: [StartLocation, StartLocation] = [
    { x: 6, y: 6 },
    { x: mapW - 7, y: mapH - 7 }
  ];
  placeResources(tiles, starts, fallbackRng, mapW, mapH);
  return { tiles, starts };
}

function carvePath(
  map: TileType[][],
  a: StartLocation,
  b: StartLocation,
  _mapW: number,
  _mapH: number
): void {
  let x = a.x;
  let y = a.y;
  while (x !== b.x || y !== b.y) {
    if (map[y][x] === 'water' || map[y][x] === 'rock') {
      map[y][x] = 'dirt';
    }
    if (x < b.x) x++;
    else if (x > b.x) x--;
    if (y < b.y) y++;
    else if (y > b.y) y--;
  }
}
