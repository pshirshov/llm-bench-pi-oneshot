/**
 * Terrain tile set for Wave Function Collapse map generation and for the
 * simulation's terrain/passability model.
 */
export enum TileType {
  Grass = 0,
  Dirt = 1,
  Forest = 2,
  Water = 3,
  Rock = 4,
  GoldMine = 5,
}

export const ALL_TILES: readonly TileType[] = [
  TileType.Grass,
  TileType.Dirt,
  TileType.Forest,
  TileType.Water,
  TileType.Rock,
  TileType.GoldMine,
];

export interface TileProps {
  readonly name: string;
  /** Land units can stand on / move through this tile. */
  readonly passable: boolean;
  /** A building can be placed on this tile. */
  readonly buildable: boolean;
  /** Workers can chop wood here (depletes to Dirt when exhausted). */
  readonly choppable: boolean;
  /** A gold mine that workers harvest. */
  readonly goldMine: boolean;
  readonly color: string;
  readonly colorAlt: string;
}

export const TILE_PROPS: Record<TileType, TileProps> = {
  [TileType.Grass]: {
    name: "Grass",
    passable: true,
    buildable: true,
    choppable: false,
    goldMine: false,
    color: "#3f7d36",
    colorAlt: "#467f3d",
  },
  [TileType.Dirt]: {
    name: "Dirt",
    passable: true,
    buildable: true,
    choppable: false,
    goldMine: false,
    color: "#7a5c39",
    colorAlt: "#836441",
  },
  [TileType.Forest]: {
    name: "Forest",
    passable: false,
    buildable: false,
    choppable: true,
    goldMine: false,
    color: "#1f4d24",
    colorAlt: "#26592b",
  },
  [TileType.Water]: {
    name: "Water",
    passable: false,
    buildable: false,
    choppable: false,
    goldMine: false,
    color: "#27548f",
    colorAlt: "#2d5d9c",
  },
  [TileType.Rock]: {
    name: "Mountain",
    passable: false,
    buildable: false,
    choppable: false,
    goldMine: false,
    color: "#6b6b6b",
    colorAlt: "#777777",
  },
  [TileType.GoldMine]: {
    name: "Gold Mine",
    passable: false,
    buildable: false,
    choppable: false,
    goldMine: true,
    color: "#c9a227",
    colorAlt: "#d8b13a",
  },
};

/** Per-tile selection weight for WFC (higher = more common). */
export const TILE_WEIGHTS: Record<TileType, number> = {
  [TileType.Grass]: 12,
  [TileType.Dirt]: 5,
  [TileType.Forest]: 4,
  [TileType.Water]: 3,
  [TileType.Rock]: 2,
  [TileType.GoldMine]: 0.25,
};

/**
 * Symmetric adjacency table: ALLOWED[a] is the set of tiles permitted to sit
 * orthogonally next to tile `a`. The table is symmetric by construction
 * (validated in tests).
 *
 * Design intent:
 *  - water borders only water and dirt (shorelines are dirt),
 *  - forests sit among grass/dirt and other forest,
 *  - mountains (rock) cluster and only touch grass/dirt/rock,
 *  - gold mines sit in grass/dirt clearings only (never touching water/forest/rock),
 *  - grass is the universal connector.
 */
function buildAdjacency(): Record<TileType, Set<TileType>> {
  const pairs: ReadonlyArray<readonly [TileType, TileType]> = [
    [TileType.Grass, TileType.Grass],
    [TileType.Grass, TileType.Dirt],
    [TileType.Grass, TileType.Forest],
    [TileType.Grass, TileType.Rock],
    [TileType.Grass, TileType.GoldMine],
    [TileType.Dirt, TileType.Dirt],
    [TileType.Dirt, TileType.Forest],
    [TileType.Dirt, TileType.Water],
    [TileType.Dirt, TileType.Rock],
    [TileType.Dirt, TileType.GoldMine],
    [TileType.Forest, TileType.Forest],
    [TileType.Water, TileType.Water],
    [TileType.Rock, TileType.Rock],
  ];
  const table = {} as Record<TileType, Set<TileType>>;
  for (const t of ALL_TILES) table[t] = new Set<TileType>();
  for (const [a, b] of pairs) {
    table[a].add(b);
    table[b].add(a);
  }
  return table;
}

export const ADJACENCY: Record<TileType, Set<TileType>> = buildAdjacency();

export function canBeAdjacent(a: TileType, b: TileType): boolean {
  return ADJACENCY[a].has(b);
}
