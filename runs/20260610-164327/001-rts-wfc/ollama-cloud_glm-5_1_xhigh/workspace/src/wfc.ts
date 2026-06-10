// ─── Wave Function Collapse map generator ───
// Uses simple-tiled WFC with adjacency constraints and weighted tile selection.

import { TileType, type GameMap, type Tile } from './types';
import { PRNG } from './prng';
import { GOLD_MINE_AMOUNT, FOREST_TILE_WOOD, WALKABLE_TILES } from './constants';

// ─── Tile definition with adjacency constraints ───

interface TileDef {
  type: TileType;
  weight: number;
  // Which tile types can be adjacent (any side)
  adj: Set<string>;
}

const TILE_DEFS: TileDef[] = [
  { type: TileType.Grass, weight: 12, adj: new Set(['grass', 'dirt', 'forest', 'gold_mine', 'rock']) },
  { type: TileType.Dirt, weight: 8, adj: new Set(['grass', 'dirt', 'forest', 'water', 'rock', 'gold_mine']) },
  { type: TileType.Forest, weight: 7, adj: new Set(['grass', 'dirt', 'forest']) },
  { type: TileType.Water, weight: 3, adj: new Set(['water', 'dirt']) },
  { type: TileType.Rock, weight: 2, adj: new Set(['rock', 'dirt', 'grass']) },
  { type: TileType.GoldMine, weight: 1, adj: new Set(['grass', 'dirt']) },
];

const TILE_DEF_MAP = new Map(TILE_DEFS.map(d => [d.type, d]));

// 4-directional neighbor offsets: N, E, S, W
const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

function canBeAdjacent(a: TileType, b: TileType): boolean {
  const defA = TILE_DEF_MAP.get(a)!;
  return defA.adj.has(b);
}

// ─── WFC State ───

interface WFCCell {
  possible: Set<number>; // indices into TILE_DEFS
  collapsed: boolean;
  chosen: number | null; // chosen TILE_DEFS index
}

function entropy(cell: WFCCell): number {
  if (cell.collapsed) return Infinity;
  return cell.possible.size;
}

// ─── WFC Solver ───

function solveWFC(width: number, height: number, rng: PRNG): number[][] | null {
  // Initialize grid
  const grid: WFCCell[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        possible: new Set(TILE_DEFS.map((_, i) => i)),
        collapsed: false,
        chosen: null,
      };
    }
  }

  const totalCells = width * height;
  let collapsedCount = 0;

  while (collapsedCount < totalCells) {
    // Find minimum entropy cell (not yet collapsed)
    let minEntropy = Infinity;
    let candidates: { x: number; y: number }[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const e = entropy(grid[y][x]);
        if (e === 0) return null; // contradiction
        if (e < minEntropy) {
          minEntropy = e;
          candidates = [{ x, y }];
        } else if (e === minEntropy) {
          candidates.push({ x, y });
        }
      }
    }

    // All cells are either collapsed or entropy Infinity — shouldn't happen
    if (candidates.length === 0) return null;

    // Pick a random minimum-entropy cell (break ties randomly)
    const pick = rng.pick(candidates);
    const cell = grid[pick.y][pick.x];

    // Collapse: choose a tile type based on weights
    const weights: [number, number][] = [];
    for (const idx of cell.possible) {
      weights.push([idx, TILE_DEFS[idx].weight]);
    }
    const chosenIdx = rng.pickWeighted(weights);
    cell.possible = new Set([chosenIdx]);
    cell.collapsed = true;
    cell.chosen = chosenIdx;
    collapsedCount++;

    // Propagate constraints
    if (!propagate(grid, width, height, pick.x, pick.y)) {
      return null; // contradiction during propagation
    }
  }

  // Extract result
  const result: number[][] = [];
  for (let y = 0; y < height; y++) {
    result[y] = [];
    for (let x = 0; x < width; x++) {
      result[y][x] = grid[y][x].chosen!;
    }
  }
  return result;
}

function propagate(grid: WFCCell[][], width: number, height: number, startX: number, startY: number): boolean {
  // BFS propagation from the start cell
  const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    const cell = grid[y][x];

    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const neighbor = grid[ny][nx];
      if (neighbor.collapsed) continue;

      // Determine which tile types in the neighbor are compatible with this cell
      const thisPossible = cell.possible;
      const neighborPossible = neighbor.possible;
      const newPossible = new Set<number>();

      for (const nIdx of neighborPossible) {
        const nType = TILE_DEFS[nIdx].type;
        let compatible = false;
        for (const tIdx of thisPossible) {
          if (canBeAdjacent(TILE_DEFS[tIdx].type, nType)) {
            compatible = true;
            break;
          }
        }
        if (compatible) {
          newPossible.add(nIdx);
        }
      }

      if (newPossible.size === 0) return false; // contradiction

      if (newPossible.size < neighborPossible.size) {
        // Constraint narrowed — propagate further
        neighbor.possible = newPossible;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return true;
}

// ─── Map Generation ───

export function generateMap(width: number, height: number, seed: number): GameMap {
  const rng = new PRNG(seed);
  let result: number[][] | null = null;

  // Try up to 10 times to get a valid map
  for (let attempt = 0; attempt < 10; attempt++) {
    const attemptRng = new PRNG(seed + attempt * 7919);
    result = solveWFC(width, height, attemptRng);
    if (result) {
      // Validate playability
      const map = buildMapFromWFC(result, width, height, rng);
      if (validateAndFixMap(map, width, height, rng)) {
        return map;
      }
    }
  }

  // Fallback: generate a simple grassland with resources
  return generateFallbackMap(width, height, rng);
}

function buildMapFromWFC(wfcResult: number[][], width: number, height: number, _rng: PRNG): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      const tileType = TILE_DEFS[wfcResult[y][x]].type;
      let resourceAmount = 0;
      if (tileType === TileType.GoldMine) resourceAmount = GOLD_MINE_AMOUNT;
      else if (tileType === TileType.Forest) resourceAmount = FOREST_TILE_WOOD;

      tiles[y][x] = {
        type: tileType,
        buildingId: null,
        resourceAmount,
        revealed: false,
      };
    }
  }

  return { width, height, tiles };
}

interface StartLocation {
  x: number;
  y: number;
  goldMines: { x: number; y: number }[];
  forests: { x: number; y: number }[];
  buildableArea: number;
}

function validateAndFixMap(map: GameMap, width: number, height: number, rng: PRNG): boolean {
  // Find two suitable start locations
  const starts = findStartLocations(map, width, height, rng);
  if (starts.length < 2) return false;

  // Check mutual reachability
  if (!isReachable(map, starts[0].x, starts[0].y, starts[1].x, starts[1].y)) return false;

  // Ensure gold mines near each start — if not, place them
  for (const start of starts) {
    if (start.goldMines.length === 0) {
      // Place a gold mine near the start
      const pos = findNearestBuildable(map, start.x, start.y, WALKABLE_TILES);
      if (pos) {
        map.tiles[pos.y][pos.x].type = TileType.GoldMine;
        map.tiles[pos.y][pos.x].resourceAmount = GOLD_MINE_AMOUNT;
        start.goldMines.push(pos);
      } else {
        return false;
      }
    }
    // Ensure some forest near the start
    if (start.forests.length < 3) {
      for (let i = 0; i < 5; i++) {
        const pos = findNearestTileOfType(map, start.x, start.y, TileType.Grass, rng);
        if (pos) {
          map.tiles[pos.y][pos.x].type = TileType.Forest;
          map.tiles[pos.y][pos.x].resourceAmount = FOREST_TILE_WOOD;
        }
      }
    }
  }

  // Clear starting areas — make sure there's a 5x5 buildable area around each start
  for (const start of starts) {
    clearStartArea(map, start.x, start.y);
  }

  return true;
}

function clearStartArea(map: GameMap, cx: number, cy: number): void {
  const radius = 3;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || x >= map.width - 1 || y < 1 || y >= map.height - 1) continue;
      const tile = map.tiles[y][x];
      if (tile.type === TileType.Water || tile.type === TileType.Rock) {
        tile.type = TileType.Grass;
        tile.resourceAmount = 0;
      }
    }
  }
}

function findStartLocations(map: GameMap, width: number, height: number, _rng: PRNG): StartLocation[] {
  const candidates: StartLocation[] = [];

  // Scan for large buildable areas
  for (let y = 4; y < height - 4; y += 8) {
    for (let x = 4; x < width - 4; x += 8) {
      const area = countBuildableArea(map, x, y, 5);
      if (area >= 20) {
        const goldMines = findNearbyTiles(map, x, y, 8, TileType.GoldMine);
        const forests = findNearbyTiles(map, x, y, 10, TileType.Forest);
        candidates.push({ x, y, goldMines, forests, buildableArea: area });
      }
    }
  }

  if (candidates.length < 2) return [];

  // Sort by quality (prefer areas with resources nearby)
  candidates.sort((a, b) => {
    const scoreA = a.goldMines.length * 10 + a.forests.length + a.buildableArea * 0.1;
    const scoreB = b.goldMines.length * 10 + b.forests.length + b.buildableArea * 0.1;
    return scoreB - scoreA;
  });

  // Pick two start locations that are far apart (ideally in opposite corners)
  let bestPair: [StartLocation, StartLocation] | null = null;
  let bestDist = 0;

  for (let i = 0; i < Math.min(candidates.length, 10); i++) {
    for (let j = i + 1; j < Math.min(candidates.length, 10); j++) {
      const dx = candidates[i].x - candidates[j].x;
      const dy = candidates[i].y - candidates[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > bestDist) {
        bestDist = dist;
        bestPair = [candidates[i], candidates[j]];
      }
    }
  }

  return bestPair ? [bestPair[0], bestPair[1]] : [candidates[0], candidates[1]];
}

function countBuildableArea(map: GameMap, cx: number, cy: number, radius: number): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
      if (BUILDABLE_TILES.has(map.tiles[y][x].type)) count++;
    }
  }
  return count;
}

const BUILDABLE_TILES = new Set(['grass', 'dirt']);

function findNearbyTiles(map: GameMap, cx: number, cy: number, radius: number, type: TileType): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
      if (map.tiles[y][x].type === type) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

function findNearestBuildable(map: GameMap, cx: number, cy: number, walkable: Set<string>): { x: number; y: number } | null {
  for (let r = 1; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
        if (walkable.has(map.tiles[y][x].type)) return { x, y };
      }
    }
  }
  return null;
}

function findNearestTileOfType(map: GameMap, cx: number, cy: number, type: TileType, rng: PRNG): { x: number; y: number } | null {
  const candidates: { x: number; y: number }[] = [];
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= map.width || y < 0 || y >= map.height) continue;
        if (map.tiles[y][x].type === type) {
          candidates.push({ x, y });
        }
      }
    }
    if (candidates.length > 0) return rng.pick(candidates);
  }
  return null;
}

function isReachable(map: GameMap, x1: number, y1: number, x2: number, y2: number): boolean {
  // BFS flood fill to check if two points are reachable
  const visited = new Set<string>();
  const queue: { x: number; y: number }[] = [{ x: x1, y: y1 }];
  visited.add(`${x1},${y1}`);

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    if (x === x2 && y === y2) return true;

    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;
      if (!WALKABLE_TILES.has(map.tiles[ny][nx].type)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return false;
}

function generateFallbackMap(width: number, height: number, rng: PRNG): GameMap {
  // Simple grassland with gold mines and forests
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      tiles[y][x] = {
        type: TileType.Grass,
        buildingId: null,
        resourceAmount: 0,
        revealed: false,
      };
    }
  }

  // Place gold mines near corners
  const corners = [
    { x: Math.floor(width * 0.2), y: Math.floor(height * 0.2) },
    { x: Math.floor(width * 0.8), y: Math.floor(height * 0.8) },
  ];

  for (const corner of corners) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = corner.x + dx;
        const y = corner.y + dy;
        if (x >= 0 && x < width && y >= 0 && y < height) {
          tiles[y][x].type = TileType.GoldMine;
          tiles[y][x].resourceAmount = GOLD_MINE_AMOUNT;
        }
      }
    }
  }

  // Scatter some forests
  for (let i = 0; i < width * height * 0.15; i++) {
    const x = rng.nextInt(0, width - 1);
    const y = rng.nextInt(0, height - 1);
    if (tiles[y][x].type === TileType.Grass) {
      tiles[y][x].type = TileType.Forest;
      tiles[y][x].resourceAmount = FOREST_TILE_WOOD;
    }
  }

  return { width, height, tiles };
}

// ─── Export for testing ───

export { TILE_DEFS, canBeAdjacent, solveWFC };