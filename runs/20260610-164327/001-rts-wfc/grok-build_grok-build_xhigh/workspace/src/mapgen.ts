import type { Tile, Point } from './types';
import { runWFC } from './wfc';
import type { RNG } from './rng';
import { shuffle } from './rng';
import { TILE_WALKABLE, TILE_HARVESTABLE } from './data';

export interface MapData {
  w: number;
  h: number;
  tiles: Tile[][];
  startA: Point;
  startB: Point;
  goldMines: Point[];
  forests: Point[];
}

const WALKABLE_TILES = new Set<Tile>(['grass', 'dirt', 'goldmine']);

function isWalkable(t: Tile): boolean {
  return WALKABLE_TILES.has(t);
}

function floodFillWalkable(tiles: Tile[][], sx: number, sy: number, w: number, h: number): boolean[][] {
  const visited: boolean[][] = Array.from({ length: h }, () => Array(w).fill(false));
  const queue: Point[] = [{ x: sx, y: sy }];
  visited[sy][sx] = true;
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

  while (queue.length) {
    const { x, y } = queue.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (visited[ny][nx]) continue;
      if (!isWalkable(tiles[ny][nx])) continue;
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return visited;
}

function findLargestClearArea(tiles: Tile[][], w: number, h: number): Point | null {
  const visited: boolean[][] = Array.from({ length: h }, () => Array(w).fill(false));
  let best: Point | null = null;
  let bestSize = 0;
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];

  for (let y = 2; y < h-2; y++) {
    for (let x = 2; x < w-2; x++) {
      if (visited[y][x] || !isWalkable(tiles[y][x])) continue;
      let size = 0;
      const q: Point[] = [{x,y}];
      visited[y][x] = true;
      while (q.length) {
        const p = q.shift()!;
        size++;
        for (const [dx,dy] of dirs) {
          const nx = p.x+dx, ny=p.y+dy;
          if (nx<0||ny<0||nx>=w||ny>=h || visited[ny][nx] || !isWalkable(tiles[ny][nx])) continue;
          visited[ny][nx]=true;
          q.push({x:nx,y:ny});
        }
      }
      if (size > bestSize) {
        bestSize = size;
        best = { x, y };
      }
    }
  }
  return best;
}

function findStartLocation(tiles: Tile[][], w: number, h: number, avoid: Point | null): Point | null {
  // Prefer flat areas with nearby gold and wood, far from the other start
  const candidates: Array<{p: Point, score: number}> = [];
  const minDist = Math.min(w, h) * 0.38;

  for (let y = 3; y < h-3; y++) {
    for (let x = 3; x < w-3; x++) {
      if (!isWalkable(tiles[y][x])) continue;
      // Check 3x3-ish clear area
      let clear = 0;
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
        const tx=x+dx, ty=y+dy;
        if (tx>=0&&ty>=0&&tx<w&&ty<h && isWalkable(tiles[ty][tx])) clear++;
      }
      if (clear < 6) continue;

      // nearby resources
      let hasGold = false, hasForest = false;
      for (let r=-5; r<=5; r++) {
        for (let c=-5; c<=5; c++) {
          const tx = x + c, ty = y + r;
          if (tx<0||ty<0||tx>=w||ty>=h) continue;
          const t = tiles[ty][tx];
          if (TILE_HARVESTABLE[t] === 'gold') hasGold = true;
          if (TILE_HARVESTABLE[t] === 'wood') hasForest = true;
        }
      }
      if (!hasGold || !hasForest) continue;

      let score = clear + (hasGold ? 5 : 0) + (hasForest ? 3 : 0);
      if (avoid) {
        const d = Math.hypot(x - avoid.x, y - avoid.y);
        if (d < minDist) score -= (minDist - d) * 1.5;
        else score += 2;
      }
      candidates.push({ p: { x, y }, score });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a,b) => b.score - a.score);
  return candidates[0].p;
}

function placeGoldIfMissing(tiles: Tile[][], sx: number, sy: number, w: number, h: number, rng: RNG): void {
  // Ensure a gold mine within ~8 tiles
  let closestD = Infinity;
  let closest: Point | null = null;
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) if (tiles[y][x] === 'goldmine') {
    const d = Math.hypot(x-sx, y-sy);
    if (d < closestD) { closestD = d; closest = {x,y}; }
  }
  if (closestD <= 9) return;

  // Find a suitable grass/dirt spot near start
  const candidates: Point[] = [];
  for (let r=3; r<12; r++) {
    for (let a=0; a<16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const tx = Math.round(sx + Math.cos(ang) * r);
      const ty = Math.round(sy + Math.sin(ang) * r);
      if (tx<=1||ty<=1||tx>=w-2||ty>=h-2) continue;
      if (tiles[ty][tx] === 'grass' || tiles[ty][tx] === 'dirt') {
        // Ensure not too close to other resources
        let ok = true;
        for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
          const t2 = tiles[ty+dy]?.[tx+dx];
          if (t2 === 'goldmine' || t2 === 'water') ok = false;
        }
        if (ok) candidates.push({x:tx,y:ty});
      }
    }
  }
  if (candidates.length === 0) {
    // force place
    for (let yy=sy-2; yy<=sy+4; yy++) {
      for (let xx=sx-2; xx<=sx+4; xx++) {
        if (xx>1&&yy>1&&xx<w-2&&yy<h-2 && (tiles[yy][xx]==='grass'||tiles[yy][xx]==='dirt')) {
          tiles[yy][xx] = 'goldmine';
          return;
        }
      }
    }
    return;
  }
  const chosen = candidates[Math.floor(rng() * candidates.length)];
  tiles[chosen.y][chosen.x] = 'goldmine';
}

function ensureTwoStarts(tiles: Tile[][], w: number, h: number, rng: RNG): {startA: Point, startB: Point} | null {
  // First try to find two good starts with existing WFC map
  let startA = findStartLocation(tiles, w, h, null);
  if (!startA) {
    startA = findLargestClearArea(tiles, w, h) || {x: Math.floor(w*0.25), y: Math.floor(h*0.25)};
  }
  let startB = findStartLocation(tiles, w, h, startA);
  if (!startB) {
    // Try symmetric placement if WFC produced very asymmetric result
    const cx = Math.floor(w/2), cy = Math.floor(h/2);
    startB = { x: Math.max(4, w-1 - startA.x), y: Math.max(4, h-1 - startA.y) };
    // Make sure startB is walkable
    if (!isWalkable(tiles[startB.y][startB.x])) {
      // scan around
      let found = false;
      for (let r=1; r<8 && !found; r++) for (let d=0; d<8; d++) {
        const a = (d/8)*Math.PI*2;
        const tx = Math.round(startB.x + Math.cos(a)*r);
        const ty = Math.round(startB.y + Math.sin(a)*r);
        if (tx>2&&ty>2&&tx<w-2&&ty<h-2 && isWalkable(tiles[ty][tx])) {
          startB = {x:tx,y:ty}; found=true;
        }
      }
    }
  }

  if (!startA || !startB) return null;

  // Ensure gold mines nearby for both
  placeGoldIfMissing(tiles, startA.x, startA.y, w, h, rng);
  placeGoldIfMissing(tiles, startB.x, startB.y, w, h, rng);

  // Make sure starts are walkable and clear a bit
  for (const s of [startA, startB]) {
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
      const tx = s.x + dx, ty = s.y + dy;
      if (tx>=0&&ty>=0&&tx<w&&ty<h && !isWalkable(tiles[ty][tx])) {
        tiles[ty][tx] = 'grass';
      }
    }
    // carve a little path if needed
    if (!isWalkable(tiles[s.y][s.x])) tiles[s.y][s.x] = 'grass';
  }

  // Final connectivity check
  const reachA = floodFillWalkable(tiles, startA.x, startA.y, w, h);
  if (!reachA[startB.y][startB.x]) {
    // Carve a deterministic corridor between them
    let cx = startA.x, cy = startA.y;
    const stepX = Math.sign(startB.x - startA.x) || (rng() > 0.5 ? 1 : -1);
    const stepY = Math.sign(startB.y - startA.y) || (rng() > 0.5 ? 1 : -1);
    let steps = 0;
    while ((cx !== startB.x || cy !== startB.y) && steps < w+h) {
      if (rng() > 0.4) cx = Math.max(2, Math.min(w-3, cx + stepX));
      else cy = Math.max(2, Math.min(h-3, cy + stepY));
      if (!isWalkable(tiles[cy][cx])) tiles[cy][cx] = 'dirt';
      steps++;
      // also clear neighbors
      for (let ddy=-1; ddy<=1; ddy++) for (let ddx=-1; ddx<=1; ddx++) {
        const txx = cx+ddx, tyy=cy+ddy;
        if (txx>=0&&tyy>=0&&txx<w&&tyy<h && !isWalkable(tiles[tyy][txx])) tiles[tyy][txx]='dirt';
      }
    }
  }

  return { startA, startB };
}

export function generateMap(w: number, h: number, seed: number, rng: RNG): MapData {
  const wfcRes = runWFC({ width: w, height: h, rng, maxAttempts: 9 });
  let tiles = wfcRes.tiles.map(row => row.slice());

  const starts = ensureTwoStarts(tiles, w, h, rng);
  if (!starts) {
    // Last resort fallback map - very playable grid
    tiles = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => {
        const r = ((x * 31 + y * 17 + seed) % 100) / 100;
        if (x < 3 || x > w-4 || y<3 || y>h-4) return 'grass';
        if (r < 0.07) return 'water';
        if (r < 0.14) return 'rock';
        if (r < 0.28) return 'forest';
        if (r < 0.33) return 'goldmine';
        return (r < 0.55 ? 'dirt' : 'grass');
      })
    );
    // place starts in corners-ish
    const sa: Point = { x: 6, y: 6 };
    const sb: Point = { x: w-7, y: h-7 };
    tiles[sa.y][sa.x] = 'grass';
    tiles[sb.y][sb.x] = 'grass';
    // place guaranteed gold and wood
    tiles[sa.y+2][sa.x+3] = 'goldmine';
    tiles[sb.y-2][sb.x-3] = 'goldmine';
    tiles[sa.y+1][sa.x+1] = 'forest';
    tiles[sb.y-1][sb.x-1] = 'forest';
    return {
      w, h, tiles,
      startA: sa,
      startB: sb,
      goldMines: [{x:sa.x+3,y:sa.y+2}, {x:sb.x-3,y:sb.y-2}],
      forests: [{x:sa.x+1,y:sa.y+1}, {x:sb.x-1,y:sb.y-1}]
    };
  }

  const { startA, startB } = starts;

  // Collect gold mines and forest representative locations
  const goldMines: Point[] = [];
  const forests: Point[] = [];
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      if (tiles[y][x] === 'goldmine') goldMines.push({x,y});
      if (tiles[y][x] === 'forest') forests.push({x,y});
    }
  }

  return {
    w, h,
    tiles,
    startA,
    startB,
    goldMines,
    forests
  };
}

export function isTileBuildable(tiles: Tile[][], x: number, y: number, fw: number, fh: number): boolean {
  for (let dy=0; dy<fh; dy++) {
    for (let dx=0; dx<fw; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= tiles[0].length || ty >= tiles.length) return false;
      const t = tiles[ty][tx];
      if (!isWalkable(t)) return false;
    }
  }
  return true;
}

export function markTiles(tiles: Tile[][], footX: number, footY: number, fw: number, fh: number, replacement: Tile): void {
  for (let dy=0; dy<fh; dy++) {
    for (let dx=0; dx<fw; dx++) {
      const tx=footX+dx, ty=footY+dy;
      if (tx>=0 && ty>=0 && tx<tiles[0].length && ty<tiles.length) {
        tiles[ty][tx] = replacement;
      }
    }
  }
}
