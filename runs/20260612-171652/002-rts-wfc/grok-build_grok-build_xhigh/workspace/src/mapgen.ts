/**
 * Map generation: WFC + playability pass + deterministic repair.
 * Delegates core collapse logic to ./wfc.ts to stay under line limits.
 */

import type { GameMap, Vec2, ResourceNode } from './types';
import type { PRNG } from './prng';
import type { TileType } from './constants';
import { array2d, tileCenter, dist } from './utils';
import { WALKABLE_TILES } from './constants';
import { LEVEL_SIZES } from './constants';
import { createAndCollapse, validateAdjacencies as _validateAdjacencies } from './wfc';

function computeLandDistance(tiles: TileType[][], a: Vec2, b: Vec2, w: number, h: number): number | null {
  const dists = array2d(w, h, Infinity);
  const q: Array<{x:number; y:number; cost:number}> = [];
  const sx = Math.floor(a.x), sy = Math.floor(a.y);
  const tx = Math.floor(b.x), ty = Math.floor(b.y);
  if (!WALKABLE_TILES.has(tiles[sy][sx]) || !WALKABLE_TILES.has(tiles[ty][tx])) return null;
  dists[sy][sx] = 0;
  q.push({ x: sx, y: sy, cost: 0 });

  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const costs = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

  while (q.length > 0) {
    q.sort((p1, p2) => p1.cost - p2.cost);
    const curr = q.shift();
    if (!curr) continue;
    if (curr.x === tx && curr.y === ty) return curr.cost;
    for (let i = 0; i < dirs.length; i++) {
      const [dx, dy] = dirs[i];
      const nx = curr.x + dx, ny = curr.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const t = tiles[ny][nx];
      if (!WALKABLE_TILES.has(t)) continue;
      const nc = curr.cost + costs[i];
      if (nc < dists[ny][nx]) {
        dists[ny][nx] = nc;
        q.push({ x: nx, y: ny, cost: nc });
      }
    }
  }
  return null;
}

function findContiguousArea(tiles: TileType[][], seedX: number, seedY: number, w: number, h: number): Vec2[] {
  const visited = array2d(w, h, false);
  const area: Vec2[] = [];
  const q: Vec2[] = [];
  if (!WALKABLE_TILES.has(tiles[seedY][seedX])) return [];
  q.push({ x: seedX, y: seedY });
  visited[seedY][seedX] = true;

  const dirs8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  while (q.length > 0) {
    const p = q.shift();
    if (!p) continue;
    area.push(p);
    for (const [dx, dy] of dirs8) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || visited[ny][nx]) continue;
      if (WALKABLE_TILES.has(tiles[ny][nx])) {
        visited[ny][nx] = true;
        q.push({ x: nx, y: ny });
      }
    }
  }
  return area;
}

function placeResourcesFair(
  tiles: TileType[][],
  starts: [Vec2, Vec2],
  w: number,
  h: number,
  prng: PRNG
): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  const used = array2d(w, h, false);

  function findSpotNear(start: Vec2, radius: number, pred: (t: TileType) => boolean): Vec2 | null {
    const candidates: Vec2[] = [];
    const sx = Math.floor(start.x), sy = Math.floor(start.y);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && x < w && y >= 0 && y < h && pred(tiles[y][x]) && !used[y][x]) {
          candidates.push({ x, y });
        }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[prng.nextInt(candidates.length)];
  }

  for (let i = 0; i < 2; i++) {
    const s = starts[i];
    let g = findSpotNear(s, 14, (t) => t === 'grass' || t === 'dirt');
    if (!g) {
      for (let yy = 0; yy < h && !g; yy++) for (let xx = 0; xx < w && !g; xx++) {
        if ((tiles[yy][xx] === 'grass' || tiles[yy][xx] === 'dirt') && !used[yy][xx]) g = { x: xx, y: yy };
      }
    }
    if (g) {
      tiles[g.y][g.x] = 'goldMine';
      used[g.y][g.x] = true;
      nodes.push({ pos: tileCenter(g.x, g.y), type: 'goldMine', amount: 1500, depleted: false });
    }

    let f = findSpotNear(s, 12, (t) => t === 'forest');
    if (!f) {
      for (let yy = 0; yy < h && !f; yy++) for (let xx = 0; xx < w && !f; xx++) {
        if (tiles[yy][xx] === 'forest' && !used[yy][xx]) f = { x: xx, y: yy };
      }
    }
    if (f) {
      used[f.y][f.x] = true;
      nodes.push({ pos: tileCenter(f.x, f.y), type: 'forest', amount: 200, depleted: false });
    }
  }

  const numExtra = Math.floor(Math.max(2, w / 28));
  for (let i = 0; i < numExtra; i++) {
    for (let tries = 0; tries < 25; tries++) {
      const x = prng.nextInt(w), y = prng.nextInt(h);
      if ((tiles[y][x] === 'grass' || tiles[y][x] === 'dirt') && !used[y][x]) {
        tiles[y][x] = 'goldMine';
        used[y][x] = true;
        nodes.push({ pos: tileCenter(x, y), type: 'goldMine', amount: 1500, depleted: false });
        break;
      }
    }
  }
  return nodes;
}

function ensureStartAreas(tiles: TileType[][], w: number, h: number, prng: PRNG): { starts: [Vec2, Vec2]; success: boolean } {
  const areas: Array<{ seed: Vec2; size: number }> = [];
  const visited = array2d(w, h, false);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (visited[y][x] || !WALKABLE_TILES.has(tiles[y][x])) continue;
      const area = findContiguousArea(tiles, x, y, w, h);
      area.forEach(p => { visited[p.y][p.x] = true; });
      if (area.length >= 25) areas.push({ seed: { x, y }, size: area.length });
    }
  }

  if (areas.length < 2) {
    return { starts: [tileCenter(5, 5), tileCenter(w - 6, h - 6)], success: false };
  }

  areas.sort((a, b) => b.size - a.size);
  const minStraight = Math.max(w, h) * 0.4;
  const minLand = Math.max(w, h) * 0.6;

  let best: [number, number] | null = null;
  let bestD = 0;

  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const sa = areas[i].seed;
      const sb = areas[j].seed;
      const straight = Math.hypot(sa.x - sb.x, sa.y - sb.y);
      const land = computeLandDistance(tiles, sa, sb, w, h) ?? 0;
      if (straight >= minStraight && land >= minLand && land > bestD) {
        bestD = land;
        best = [i, j];
      }
    }
  }

  if (!best) {
    const a0 = areas[0].seed;
    let far = 1, maxd = 0;
    for (let k = 1; k < areas.length; k++) {
      const d = Math.hypot(a0.x - areas[k].seed.x, a0.y - areas[k].seed.y);
      if (d > maxd) { maxd = d; far = k; }
    }
    return { starts: [tileCenter(Math.floor(a0.x), Math.floor(a0.y)), tileCenter(Math.floor(areas[far].seed.x), Math.floor(areas[far].seed.y))], success: false };
  }

  const s1 = tileCenter(Math.floor(areas[best[0]].seed.x), Math.floor(areas[best[0]].seed.y));
  const s2 = tileCenter(Math.floor(areas[best[1]].seed.x), Math.floor(areas[best[1]].seed.y));
  return { starts: [s1, s2], success: true };
}

function repairMap(tiles: TileType[][], starts: [Vec2, Vec2], w: number, h: number, prng: PRNG): void {
  const land = computeLandDistance(tiles, starts[0], starts[1], w, h);
  if (land === null || land > Math.max(w, h) * 1.2) {
    let cx = Math.floor(starts[0].x), cy = Math.floor(starts[0].y);
    const bx = Math.floor(starts[1].x), by = Math.floor(starts[1].y);
    for (let step = 0; step < w * h && (cx !== bx || cy !== by); step++) {
      if (prng.next() < 0.5 && cx !== bx) cx += Math.sign(bx - cx);
      else if (cy !== by) cy += Math.sign(by - cy);
      else cx += Math.sign(bx - cx);
      if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
        const t = tiles[cy][cx];
        if (t === 'water' || t === 'rock') tiles[cy][cx] = 'dirt';
      }
    }
  }

  for (const s of starts) {
    const cx = Math.floor(s.x), cy = Math.floor(s.y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) {
          if (!WALKABLE_TILES.has(tiles[y][x])) tiles[y][x] = 'grass';
        }
      }
    }
  }
}

export interface GenerateOptions {
  level?: number;
  attempts?: number;
}

export function generateMap(seed: number, prng: PRNG, opts: GenerateOptions = {}): GameMap {
  const level = Math.max(0, Math.min(4, opts.level ?? 0));
  const [width, height] = LEVEL_SIZES[level];
  const maxAttempts = opts.attempts ?? 7;

  let lastTiles: TileType[][] | null = null;
  let lastStarts: [Vec2, Vec2] | null = null;
  let lastNodes: ResourceNode[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptPrng = prng.clone();
    for (let k = 0; k < attempt * 23 + 7; k++) attemptPrng.next();

    const tiles = createAndCollapse(width, height, attemptPrng);
    if (!tiles) continue;
    lastTiles = tiles;

    const { starts } = ensureStartAreas(tiles, width, height, attemptPrng);
    lastStarts = starts;

    const nodes = placeResourcesFair(tiles, starts, width, height, attemptPrng);

    const straight = Math.hypot(starts[0].x - starts[1].x, starts[0].y - starts[1].y);
    const landD = computeLandDistance(tiles, starts[0], starts[1], width, height) ?? Infinity;
    const minStraight = Math.max(width, height) * 0.4;
    const minLand = Math.max(width, height) * 0.6;

    const checkRes = (s: Vec2) => {
      let g = false, f = false;
      for (const n of nodes) {
        if (dist(s, n.pos) < 15.5) {
          if (n.type === 'goldMine' && !n.depleted) g = true;
          if (n.type === 'forest' && !n.depleted) f = true;
        }
      }
      return g && f;
    };

    if (straight >= minStraight && landD >= minLand && checkRes(starts[0]) && checkRes(starts[1])) {
      lastNodes = nodes;
      return { width, height, tiles, resourceNodes: nodes, startLocations: starts };
    }
  }

  // Repair fallback — always succeeds
  if (!lastTiles || !lastStarts) {
    const tiles: TileType[][] = array2d(width, height, 'grass');
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = (x * 5 + y * 3) % 13;
        if (v === 0) tiles[y][x] = 'dirt';
        if (v === 2 && y % 3 !== 0) tiles[y][x] = 'forest';
        if (x < 2 || x >= width - 2) tiles[y][x] = 'water';
        if ((x > width / 2 - 2 && x < width / 2 + 2) && y % 5 === 0) tiles[y][x] = 'rock';
      }
    }
    lastTiles = tiles;
    lastStarts = [tileCenter(6, 6), tileCenter(width - 7, height - 7)];
    lastNodes = placeResourcesFair(tiles, lastStarts, width, height, prng);
  }

  repairMap(lastTiles, lastStarts, width, height, prng);

  // Rebuild nodes from final tiles
  const finalNodes: ResourceNode[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = lastTiles[y][x];
      if (t === 'goldMine') finalNodes.push({ pos: tileCenter(x, y), type: 'goldMine', amount: 1500, depleted: false });
      if (t === 'forest') finalNodes.push({ pos: tileCenter(x, y), type: 'forest', amount: 200, depleted: false });
    }
  }

  if (!lastStarts) {
    lastStarts = [tileCenter(6, 6), tileCenter(width - 7, height - 7)];
  }
  return {
    width, height,
    tiles: lastTiles,
    resourceNodes: finalNodes.length ? finalNodes : lastNodes,
    startLocations: lastStarts,
  };
}
