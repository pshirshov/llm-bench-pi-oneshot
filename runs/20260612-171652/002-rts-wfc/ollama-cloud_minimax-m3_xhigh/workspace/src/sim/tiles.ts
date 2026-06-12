// Map tile types. Used by the WFC generator, the playability pass, and the
// renderer. WALKABLE is documented as a single constant per type.

export const TILE = {
  GRASS: 0,
  DIRT: 1,
  FOREST: 2,
  WATER: 3,
  ROCK: 4,
  GOLD_MINE: 5,
  DEPLETED_MINE: 6,
  STUMP: 7,
} as const;

export type TileType = (typeof TILE)[keyof typeof TILE];

export interface TileMeta {
  readonly walkable: boolean;
  readonly blocksSight: boolean;
  /** Resource yielded to a worker who completes a harvest cycle here. */
  readonly resource?: "gold" | "wood";
  /** Display name. */
  readonly name: string;
  /** Color base for renderer. */
  readonly color: string;
}

export const TILE_META: Record<TileType, TileMeta> = {
  [TILE.GRASS]: { walkable: true, blocksSight: false, name: "grass", color: "#3a6d3a" },
  [TILE.DIRT]: { walkable: true, blocksSight: false, name: "dirt", color: "#7a5a3a" },
  [TILE.FOREST]: { walkable: false, blocksSight: false, resource: "wood", name: "forest", color: "#1e4a1e" },
  [TILE.WATER]: { walkable: false, blocksSight: false, name: "water", color: "#1e3a6a" },
  [TILE.ROCK]: { walkable: false, blocksSight: true, name: "rock", color: "#555555" },
  [TILE.GOLD_MINE]: { walkable: false, blocksSight: false, resource: "gold", name: "gold mine", color: "#c8a020" },
  [TILE.DEPLETED_MINE]: { walkable: false, blocksSight: false, name: "depleted mine", color: "#5a4a20" },
  [TILE.STUMP]: { walkable: true, blocksSight: false, name: "stump", color: "#4a3a1e" },
};

export function isWalkableTile(t: TileType): boolean {
  return TILE_META[t].walkable;
}

export function isResourceTile(t: TileType): boolean {
  return TILE_META[t].resource !== undefined;
}
