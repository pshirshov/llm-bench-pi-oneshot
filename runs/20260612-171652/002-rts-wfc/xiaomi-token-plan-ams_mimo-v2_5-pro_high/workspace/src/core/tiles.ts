/**
 * Tile type definitions and adjacency rules for WFC map generation.
 */

import type { TileType } from './types';

export interface TileDef {
  readonly type: TileType;
  readonly walkable: boolean;
  readonly buildable: boolean;
  readonly isResource: boolean;
  /** Weight for WFC generation (higher = more common) */
  readonly weight: number;
  /** Color for rendering */
  readonly color: string;
  /** Dark variant for forest/water shimmer */
  readonly colorAlt: string;
}

export const TILE_DEFS: Record<TileType, TileDef> = {
  grass: {
    type: 'grass', walkable: true, buildable: true, isResource: false,
    weight: 30, color: '#4a8c3f', colorAlt: '#3f7a35',
  },
  dirt: {
    type: 'dirt', walkable: true, buildable: true, isResource: false,
    weight: 10, color: '#8b7355', colorAlt: '#7a6548',
  },
  forest: {
    type: 'forest', walkable: false, buildable: false, isResource: true,
    weight: 20, color: '#2d5a1e', colorAlt: '#245018',
  },
  water: {
    type: 'water', walkable: false, buildable: false, isResource: false,
    weight: 8, color: '#2a6496', colorAlt: '#1f5080',
  },
  rock: {
    type: 'rock', walkable: false, buildable: false, isResource: false,
    weight: 6, color: '#666666', colorAlt: '#555555',
  },
  goldMine: {
    type: 'goldMine', walkable: false, buildable: false, isResource: true,
    weight: 2, color: '#daa520', colorAlt: '#b8860b',
  },
  goldMineDepleted: {
    type: 'goldMineDepleted', walkable: true, buildable: false, isResource: false,
    weight: 0, color: '#8b7355', colorAlt: '#7a6548',
  },
};

/**
 * Adjacency rules for WFC: for each tile type, the set of tile types
 * that may appear in the 4 cardinal directions (N/E/S/W).
 * Diagonals are checked as both adjacent cardinals must allow the diagonal tile.
 */
export const ADJACENCY: Record<TileType, Set<TileType>> = {
  grass: new Set<TileType>(['grass', 'dirt', 'forest', 'goldMine']),
  dirt: new Set<TileType>(['grass', 'dirt', 'forest', 'goldMine', 'rock']),
  forest: new Set<TileType>(['grass', 'dirt', 'forest']),
  water: new Set<TileType>(['water', 'dirt']),
  rock: new Set<TileType>(['dirt', 'rock']),
  goldMine: new Set<TileType>(['grass', 'dirt']),
  goldMineDepleted: new Set<TileType>(['grass', 'dirt']),
};

/** Check if tileA is allowed adjacent to tileB */
export function tilesAdjacentAllowed(a: TileType, b: TileType): boolean {
  return ADJACENCY[a].has(b);
}

/** Total tile count for array indexing */
export const NUM_TILE_TYPES = 7;

/** Ordered tile type list for iteration */
export const ALL_TILE_TYPES: readonly TileType[] = [
  'grass', 'dirt', 'forest', 'water', 'rock', 'goldMine', 'goldMineDepleted',
] as const;
