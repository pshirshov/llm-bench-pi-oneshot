/**
 * Map generation: WFC + playability pass + start-location placement.
 * Generates a complete GameMap for a given seed and level.
 */

import type { PRNG } from '../core/prng';
import type { TileType, Vec2, GameMap, Faction, FogState } from '../core/types';
import {
  MIN_START_SEPARATION_RATIO, MIN_START_LINE_SEPARATION_RATIO,
  MIN_BUILD_AREA,
} from '../core/types';
import { vecDist, vecManhattan } from '../core/types';
import { TILE_DEFS } from '../core/tiles';
import { findNearestWalkable } from '../core/pathfinding';
import { createPRNG } from '../core/prng';
import { runWFC, ensureGoldMines, ensureForestNearStarts } from './wfc';

/** Map dimensions per campaign level */
export const LEVEL_MAP_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 32, height: 32 },
  { width: 48, height: 48 },
  { width: 64, height: 64 },
  { width: 80, height: 80 },
  { width: 96, height: 96 },
];

/** Number of extra water/rock tiles to add per level (higher = more constrained) */
const LEVEL_TERRAIN_ROUGHNESS = [0, 2, 5, 8, 12];

function makeFog(width: number, height: number): FogState[] {
  return new Array<FogState>(width * height).fill('unexplored');
}

function makeWalkable(tiles: TileType[], width: number, height: number): boolean[] {
  const walkable = new Array<boolean>(width * height);
  for (let i = 0; i < tiles.length; i++) {
    walkable[i] = TILE_DEFS[tiles[i]].walkable;
  }
  return walkable;
}

/**
 * Find a contiguous buildable area of at least minSize x minSize tiles
 * starting from (sx, sy). Returns the set of buildable tiles.
 */
function findBuildableArea(
  tiles: TileType[],
  width: number,
  height: number,
  sx: number,
  sy: number,
): Vec2[] {
  const area: Vec2[] = [];
  const visited = new Set<number>();

  // BFS from start to find connected buildable tiles
  const queue: Vec2[] = [{ x: sx, y: sy }];
  while (queue.length > 0) {
    const pos = queue.shift() as Vec2;
    const idx = pos.y * width + pos.x;
    if (visited.has(idx)) continue;
    visited.add(idx);

    const tile = tiles[idx];
    if (!TILE_DEFS[tile].buildable) continue;

    area.push(pos);

    // Check 4-cardinal neighbors
    const dirs = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
    ];
    for (const d of dirs) {
      const nx = pos.x + d.x;
      const ny = pos.y + d.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return area;
}

/**
 * Check if there's a contiguous buildable area of at least minSize x minSize
 * near the given position.
 */
function hasBuildableArea(
  tiles: TileType[],
  width: number,
  height: number,
  sx: number,
  sy: number,
  minSize: number,
): boolean {
  // Check a region around the start for a buildable area
  const regionSize = minSize + 4;
  let maxContiguous = 0;

  for (let dy = -regionSize; dy <= regionSize; dy++) {
    for (let dx = -regionSize; dx <= regionSize; dx++) {
      const nx = sx + dx;
      const ny = sy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const area = findBuildableArea(tiles, width, height, nx, ny);
      if (area.length > maxContiguous) {
        maxContiguous = area.length;
      }
    }
  }

  return maxContiguous >= minSize * minSize;
}

/** Find valid start locations on the map */
function findStartLocations(
  tiles: TileType[],
  width: number,
  height: number,
  rng: PRNG,
): Vec2[] {
  const starts: Vec2[] = [];
  const maxDim = Math.max(width, height);
  const minSep = Math.floor(maxDim * MIN_START_SEPARATION_RATIO);
  const minLineSep = Math.floor(maxDim * MIN_START_LINE_SEPARATION_RATIO);

  // Try to find two good start locations far apart
  for (let attempt = 0; attempt < 500; attempt++) {
    const x = rng.nextInt(4, width - 5);
    const y = rng.nextInt(4, height - 5);
    const idx = y * width + x;

    if (!TILE_DEFS[tiles[idx]].buildable) continue;

    // Check buildable area
    if (!hasBuildableArea(tiles, width, height, x, y, MIN_BUILD_AREA)) continue;

    if (starts.length === 0) {
      starts.push({ x, y });
    } else {
      const dist = vecDist(starts[0], { x, y });
      const lineDist = vecManhattan(starts[0], { x, y });
      if (dist >= minSep && lineDist >= minLineSep) {
        starts.push({ x, y });
        break;
      }
    }
  }

  // Fallback if we didn't find two good starts
  if (starts.length < 2) {
    const fallback1 = { x: Math.floor(width * 0.2), y: Math.floor(height * 0.2) };
    const fallback2 = { x: Math.floor(width * 0.8), y: Math.floor(height * 0.8) };
    // Find nearest walkable tiles
    const tempMap = { width, height, tiles, walkable: makeWalkable(tiles, width, height),
      fog: { humans: [], orcs: [] }, startLocations: { humans: fallback1, orcs: fallback2 }, level: 0 };
    const w1 = findNearestWalkable(tempMap, fallback1.x, fallback1.y) ?? fallback1;
    const w2 = findNearestWalkable(tempMap, fallback2.x, fallback2.y) ?? fallback2;
    starts.length = 0;
    starts.push(w1, w2);
  }

  return starts;
}

/** Add water/rock constraints to the map for harder levels */
function constrainTerrain(
  tiles: TileType[],
  width: number,
  height: number,
  rng: PRNG,
  roughness: number,
): TileType[] {
  const result = [...tiles];
  for (let i = 0; i < roughness; i++) {
    const x = rng.nextInt(2, width - 3);
    const y = rng.nextInt(2, height - 3);
    const idx = y * width + x;
    if (result[idx] === 'grass' || result[idx] === 'dirt') {
      result[idx] = rng.next() < 0.5 ? 'water' : 'rock';
    }
  }
  return result;
}

/**
 * Carve a land corridor between two points to guarantee reachability.
 */
function carveCorridor(
  tiles: TileType[],
  width: number,
  _height: number,
  from: Vec2,
  to: Vec2,
): TileType[] {
  const result = [...tiles];
  let cx = from.x;
  let cy = from.y;

  while (cx !== to.x || cy !== to.y) {
    const idx = cy * width + cx;
    if (result[idx] === 'water' || result[idx] === 'rock') {
      result[idx] = 'grass';
    }

    if (cx < to.x) cx++;
    else if (cx > to.x) cx--;
    if (cy < to.y) cy++;
    else if (cy > to.y) cy--;
  }
  // Also clear the destination
  const toIdx = to.y * width + to.x;
  if (result[toIdx] === 'water' || result[toIdx] === 'rock') {
    result[toIdx] = 'grass';
  }

  return result;
}

/**
 * Generate a complete map for a campaign level.
 */
export function generateMap(
  seed: number,
  level: number,
): GameMap {
  const size = LEVEL_MAP_SIZES[level] ?? LEVEL_MAP_SIZES[0];
  const { width, height } = size;
  const mapSeed = (seed * 31 + level * 17) >>> 0;
  const rng = createPRNG(mapSeed);

  // Generate base terrain with WFC
  let tiles = runWFC(width, height, rng);

  // Add terrain constraints for harder levels
  const roughness = LEVEL_TERRAIN_ROUGHNESS[level] ?? 0;
  tiles = constrainTerrain(tiles, width, height, rng, roughness);

  // Find start locations
  const starts = findStartLocations(tiles, width, height, rng);

  // Ensure reachability between starts
  if (starts.length >= 2) {
    tiles = carveCorridor(tiles, width, height, starts[0], starts[1]);
  }

  // Ensure buildable areas near starts (clear water/rock around start)
  for (const start of starts) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = start.x + dx;
        const y = start.y + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const idx = y * width + x;
        if (tiles[idx] === 'water' || tiles[idx] === 'rock' || tiles[idx] === 'goldMine' || tiles[idx] === 'forest') {
          tiles[idx] = 'grass';
        }
      }
    }
  }

  // Ensure resources near starts
  tiles = ensureGoldMines(tiles, width, height, rng, 4 + level, starts);
  tiles = ensureForestNearStarts(tiles, width, height, starts, rng);

  // Make walkable array
  const walkable = makeWalkable(tiles, width, height);

  // Create fog arrays
  const fog: Record<Faction, FogState[]> = {
    humans: makeFog(width, height),
    orcs: makeFog(width, height),
  };

  // Set start locations
  const startLocations: Record<Faction, Vec2> = {
    humans: starts[0] ?? { x: 5, y: 5 },
    orcs: starts[1] ?? { x: width - 6, y: height - 6 },
  };

  return {
    width,
    height,
    tiles,
    walkable,
    fog,
    startLocations,
    level,
  };
}
