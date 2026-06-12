import type { Prng } from '../prng';
import type { GameMap, TileKind } from '../types';
import { inBounds } from '../utils';
import { areAdjacentKindsAllowed, COLLAPSIBLE_TILES, createTile, TILE_RULES } from './tiles';

interface CellState {
  options: Set<TileKind>;
}

export interface WfcOptions {
  width: number;
  height: number;
  seed: number;
  level: number;
  waterScale: number;
  rockScale: number;
  forestScale: number;
}

const directions = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

export function collapseWfc(options: WfcOptions, prng: Prng): GameMap | undefined {
  const cells: CellState[] = Array.from({ length: options.width * options.height }, () => ({
    options: new Set(COLLAPSIBLE_TILES)
  }));
  const buckets = createEntropyBuckets(cells.length, COLLAPSIBLE_TILES.length);
  for (let guard = 0; guard < options.width * options.height; guard += 1) {
    const index = findLowestEntropyCell(cells, buckets, prng);
    if (index === undefined) {
      return toMap(cells, options);
    }
    const chosen = chooseOption(cells[index], options, prng);
    cells[index].options = new Set([chosen]);
    if (!propagate(cells, options.width, options.height, index, buckets)) {
      return undefined;
    }
  }
  return toMap(cells, options);
}

export function validateAdjacency(map: GameMap): boolean {
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const here = map.tiles[y * map.width + x].kind;
      for (const direction of directions) {
        const nx = x + direction.x;
        const ny = y + direction.y;
        if (inBounds(map.width, map.height, nx, ny)) {
          const there = map.tiles[ny * map.width + nx].kind;
          if (!areAdjacentKindsAllowed(here, there)) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

function createEntropyBuckets(cellCount: number, entropy: number): number[][] {
  const buckets = Array.from({ length: entropy + 1 }, () => [] as number[]);
  for (let i = 0; i < cellCount; i += 1) {
    buckets[entropy].push(i);
  }
  return buckets;
}

function findLowestEntropyCell(cells: CellState[], buckets: number[][], prng: Prng): number | undefined {
  for (let size = 2; size < buckets.length; size += 1) {
    const bucket = buckets[size];
    while (bucket.length > 0) {
      const cursor = prng.int(bucket.length);
      const index = bucket[cursor];
      bucket[cursor] = bucket[bucket.length - 1];
      bucket.pop();
      if (cells[index].options.size === size) {
        return index;
      }
    }
  }
  return undefined;
}

function chooseOption(cell: CellState, options: WfcOptions, prng: Prng): TileKind {
  const kinds = Array.from(cell.options);
  const weights = kinds.map(kind => scaledWeight(kind, options));
  return kinds[prng.pickIndex(weights)];
}

function scaledWeight(kind: TileKind, options: WfcOptions): number {
  const base = TILE_RULES[kind].weight;
  if (kind === 'water') {
    return Math.max(1, Math.round(base * options.waterScale));
  }
  if (kind === 'rock') {
    return Math.max(1, Math.round(base * options.rockScale));
  }
  if (kind === 'forest') {
    return Math.max(1, Math.round(base * options.forestScale));
  }
  return base;
}

function propagate(cells: CellState[], width: number, height: number, start: number, buckets: number[][]): boolean {
  const queue = [start];
  while (queue.length > 0) {
    const index = queue.shift();
    if (index === undefined) {
      throw new Error('queue returned undefined after non-empty check');
    }
    const x = index % width;
    const y = Math.floor(index / width);
    for (const direction of directions) {
      const nx = x + direction.x;
      const ny = y + direction.y;
      if (!inBounds(width, height, nx, ny)) {
        continue;
      }
      const neighborIndex = ny * width + nx;
      const neighbor = cells[neighborIndex];
      const before = neighbor.options.size;
      for (const candidate of Array.from(neighbor.options)) {
        if (!hasCompatibleOption(cells[index], candidate)) {
          neighbor.options.delete(candidate);
        }
      }
      if (neighbor.options.size === 0) {
        return false;
      }
      if (neighbor.options.size < before) {
        if (neighbor.options.size > 1) {
          buckets[neighbor.options.size].push(neighborIndex);
        }
        queue.push(neighborIndex);
      }
    }
  }
  return true;
}

function hasCompatibleOption(source: CellState, candidate: TileKind): boolean {
  for (const sourceKind of source.options) {
    if (areAdjacentKindsAllowed(sourceKind, candidate)) {
      return true;
    }
  }
  return false;
}

function toMap(cells: CellState[], options: WfcOptions): GameMap | undefined {
  const tiles = [];
  for (const cell of cells) {
    if (cell.options.size !== 1) {
      return undefined;
    }
    const [kind] = Array.from(cell.options);
    tiles.push(createTile(kind));
  }
  return {
    width: options.width,
    height: options.height,
    tiles,
    starts: [
      { player: 1, x: 0, y: 0 },
      { player: 2, x: options.width - 1, y: options.height - 1 }
    ],
    level: options.level,
    seed: options.seed,
    walkVersion: 0
  };
}
