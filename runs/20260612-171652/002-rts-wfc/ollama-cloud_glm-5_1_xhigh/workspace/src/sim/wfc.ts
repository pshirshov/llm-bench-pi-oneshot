/** Wave Function Collapse map generation. */

import { createPRNG, type PRNG } from "./prng";
import type { TileType, TileCoord } from "./types";
import { ADJACENCY, TILE_WEIGHTS, ALL_TILE_TYPES, isBuildable } from "./tile";
import { GameMap } from "./map";
import { HARVEST_STATS } from "./stats";
import {
  MAX_GEN_RETRIES, START_SEPARATION_EUCLIDEAN,
  START_RESOURCE_RANGE, START_AREA_SIZE,
} from "./constants";

interface WFCCell {
  possible: Set<TileType>;
  collapsed: boolean;
  tile: TileType | null;
}

const PLACEABLE_TILES = ALL_TILE_TYPES.filter(t => TILE_WEIGHTS[t] > 0);

function findMinEntropy(
  cells: WFCCell[][], width: number, height: number, prng: PRNG
): { col: number; row: number } | null {
  let minSize = Infinity;
  const candidates: { col: number; row: number }[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const cell = cells[r][c];
      if (cell.collapsed) continue;
      if (cell.possible.size < minSize) {
        minSize = cell.possible.size;
        candidates.length = 0;
        candidates.push({ col: c, row: r });
      } else if (cell.possible.size === minSize) {
        candidates.push({ col: c, row: r });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[prng.nextInt(0, candidates.length - 1)];
}

function collapseCell(cells: WFCCell[][], col: number, row: number, prng: PRNG): TileType {
  const cell = cells[row][col];
  const possibilities = [...cell.possible];
  const weights = possibilities.map(t => TILE_WEIGHTS[t]);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = prng.next() * total;
  let chosen = possibilities[0];
  for (let i = 0; i < possibilities.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { chosen = possibilities[i]; break; }
  }
  cell.possible = new Set([chosen]);
  cell.collapsed = true;
  cell.tile = chosen;
  return chosen;
}

const DIRS: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

function propagate(cells: WFCCell[][], width: number, height: number, startCol: number, startRow: number): boolean {
  const stack: TileCoord[] = [{ col: startCol, row: startRow }];
  while (stack.length > 0) {
    const maybeCur = stack.pop();
    if (!maybeCur) break;
    const cur = maybeCur;
    const curCell = cells[cur.row][cur.col];
    for (const [dc, dr] of DIRS) {
      const nc = cur.col + dc;
      const nr = cur.row + dr;
      if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
      const neighbor = cells[nr][nc];
      if (neighbor.collapsed) continue;
      const allowedByCurrent = new Set<TileType>();
      for (const t of curCell.possible) {
        for (const a of ADJACENCY[t]) allowedByCurrent.add(a);
      }
      const before = neighbor.possible.size;
      const newPossible = new Set([...neighbor.possible].filter(t => allowedByCurrent.has(t)));
      if (newPossible.size === 0) return false;
      neighbor.possible = newPossible;
      if (newPossible.size < before) stack.push({ col: nc, row: nr });
    }
  }
  return true;
}

function runWFC(width: number, height: number, prng: PRNG): TileType[][] | null {
  const cells: WFCCell[][] = [];
  for (let r = 0; r < height; r++) {
    cells[r] = [];
    for (let c = 0; c < width; c++) {
      cells[r][c] = { possible: new Set(PLACEABLE_TILES), collapsed: false, tile: null };
    }
  }
  const totalCells = width * height;
  for (let i = 0; i < totalCells; i++) {
    const cell = findMinEntropy(cells, width, height, prng);
    if (!cell) break;
    collapseCell(cells, cell.col, cell.row, prng);
    if (!propagate(cells, width, height, cell.col, cell.row)) return null;
  }
  const grid: TileType[][] = [];
  for (let r = 0; r < height; r++) {
    grid[r] = [];
    for (let c = 0; c < width; c++) {
      grid[r][c] = cells[r][c].tile ?? "grass";
    }
  }
  return grid;
}

function ensureStartArea(map: GameMap, cx: number, cy: number, prng: PRNG): void {
  const half = Math.floor(START_AREA_SIZE / 2);
  for (let dr = -half; dr <= half; dr++) {
    for (let dc = -half; dc <= half; dc++) {
      map.setTile(cx + dc, cy + dr, "grass");
    }
  }
  // Place a gold mine nearby
  for (let attempts = 0; attempts < 50; attempts++) {
    const angle = prng.next() * Math.PI * 2;
    const dist = 3 + Math.floor(prng.next() * 5);
    const mc = cx + Math.round(Math.cos(angle) * dist);
    const mr = cy + Math.round(Math.sin(angle) * dist);
    if (map.inBounds(mc, mr) && isBuildable(map.getTile(mc, mr))) {
      const walkableNeighbor = map.neighbors(mc, mr).some(
        n => map.isWalkable(n.col, n.row)
      );
      if (walkableNeighbor) {
        map.addGoldMine(mc, mr, HARVEST_STATS.goldMineCapacity);
        break;
      }
    }
  }
  // Ensure a forest tile nearby
  let hasForest = false;
  for (let dr = -12; dr <= 12 && !hasForest; dr++) {
    for (let dc = -12; dc <= 12 && !hasForest; dc++) {
      if (map.getTile(cx + dc, cy + dr) === "forest") hasForest = true;
    }
  }
  if (!hasForest) {
    for (let attempts = 0; attempts < 50; attempts++) {
      const angle = prng.next() * Math.PI * 2;
      const dist = 2 + Math.floor(prng.next() * 6);
      const fc = cx + Math.round(Math.cos(angle) * dist);
      const fr = cy + Math.round(Math.sin(angle) * dist);
      if (map.inBounds(fc, fr) && isBuildable(map.getTile(fc, fr))) {
        map.setTile(fc, fr, "forest");
        break;
      }
    }
  }
}

function pickStartLocations(map: GameMap, prng: PRNG): TileCoord[] {
  const candidates: TileCoord[] = [];
  for (let r = 3; r < map.height - 3; r += 4) {
    for (let c = 3; c < map.width - 3; c += 4) {
      if (map.isBuildable(c, r)) candidates.push({ col: c, row: r });
    }
  }
  if (candidates.length < 2) return [];
  let best: [TileCoord, TileCoord] | null = null;
  let bestDist = 0;
  const limit = Math.min(candidates.length, 200);
  for (let i = 0; i < limit; i++) {
    const a = candidates[prng.nextInt(0, candidates.length - 1)];
    const b = candidates[prng.nextInt(0, candidates.length - 1)];
    if (a.col === b.col && a.row === b.row) continue;
    const dist = GameMap.dist(a, b);
    if (dist > bestDist) { bestDist = dist; best = [a, b]; }
  }
  return best ? [best[0], best[1]] : [];
}

function validateStarts(map: GameMap, starts: TileCoord[]): boolean {
  if (starts.length !== 2) return false;
  const [a, b] = starts;
  const maxDim = Math.max(map.width, map.height);
  if (GameMap.dist(a, b) < maxDim * START_SEPARATION_EUCLIDEAN) return false;
  // Start area buildability is ensured by ensureStartArea, so we skip that check here
  // and only check resources near starts
  for (const s of starts) {
    let hasGold = false;
    let hasForest = false;
    for (let dr = -START_RESOURCE_RANGE; dr <= START_RESOURCE_RANGE; dr++) {
      for (let dc = -START_RESOURCE_RANGE; dc <= START_RESOURCE_RANGE; dc++) {
        const t = map.getTile(s.col + dc, s.row + dr);
        if (t === "gold_mine") hasGold = true;
        if (t === "forest") hasForest = true;
      }
    }
    if (!hasGold || !hasForest) return false;
  }
  return true;
}

function registerGoldMines(map: GameMap): void {
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (map.getTile(c, r) === "gold_mine") {
        let exists = false;
        for (const mine of map.goldMines.values()) {
          if (mine.col === c && mine.row === r) { exists = true; break; }
        }
        if (!exists) map.addGoldMine(c, r, HARVEST_STATS.goldMineCapacity);
      }
    }
  }
}

function repairMap(width: number, height: number, prng: PRNG): GameMap {
  const map = new GameMap(width, height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      map.tiles[r][c] = "grass";
    }
  }
  for (let i = 0; i < width * height * 0.15; i++) {
    map.tiles[prng.nextInt(0, height - 1)][prng.nextInt(0, width - 1)] = "forest";
  }
  for (let i = 0; i < width * height * 0.05; i++) {
    map.tiles[prng.nextInt(0, height - 1)][prng.nextInt(0, width - 1)] = "water";
  }
  const left = Math.floor(width * 0.2);
  const right = Math.floor(width * 0.8);
  const mid = Math.floor(height / 2);
  for (let c = left; c <= right; c++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (map.inBounds(c, mid + dr)) map.setTile(c, mid + dr, "dirt");
    }
  }
  return map;
}

export function generateMap(
  width: number, height: number, seed: number
): { map: GameMap; starts: TileCoord[] } {
  const mainPrng = createPRNG(seed);
  for (let attempt = 0; attempt < MAX_GEN_RETRIES; attempt++) {
    const subPrng = mainPrng.fork();
    const grid = runWFC(width, height, subPrng);
    if (!grid) continue;
    const map = new GameMap(width, height, grid);
    const starts = pickStartLocations(map, mainPrng.fork());
    if (starts.length === 2 && validateStarts(map, starts)) {
      for (const s of starts) ensureStartArea(map, s.col, s.row, mainPrng.fork());
      registerGoldMines(map);
      return { map, starts };
    }
  }
  // Deterministic repair fallback
  const map = repairMap(width, height, createPRNG(seed + 99999));
  const starts: TileCoord[] = [
    { col: Math.floor(width * 0.2), row: Math.floor(height / 2) },
    { col: Math.floor(width * 0.8), row: Math.floor(height / 2) },
  ];
  for (const s of starts) ensureStartArea(map, s.col, s.row, createPRNG(seed + 88888));
  registerGoldMines(map);
  return { map, starts };
}