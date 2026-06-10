/** Terrain tile kinds and their static properties. */
export enum Tile {
  Grass = 0,
  Dirt = 1,
  Forest = 2,
  Water = 3,
  Rock = 4,
  GoldMine = 5,
}

export const TILE_COUNT = 6;

export const ALL_TILES: readonly Tile[] = [
  Tile.Grass,
  Tile.Dirt,
  Tile.Forest,
  Tile.Water,
  Tile.Rock,
  Tile.GoldMine,
];

/**
 * Symmetric adjacency rules for WFC: ADJACENT[t] lists the tiles allowed to
 * appear in a 4-neighbour cell next to t.
 *  - water borders only water and dirt (beaches)
 *  - gold mines sit in grass/dirt clearings
 *  - rock ranges meet the world through dirt or forest, never water/grass
 */
const ADJACENT: readonly (readonly Tile[])[] = [
  /* Grass  */ [Tile.Grass, Tile.Dirt, Tile.Forest, Tile.GoldMine],
  /* Dirt   */ [Tile.Grass, Tile.Dirt, Tile.Forest, Tile.Water, Tile.Rock, Tile.GoldMine],
  /* Forest */ [Tile.Grass, Tile.Dirt, Tile.Forest, Tile.Rock],
  /* Water  */ [Tile.Dirt, Tile.Water],
  /* Rock   */ [Tile.Dirt, Tile.Forest, Tile.Rock],
  /* Gold   */ [Tile.Grass, Tile.Dirt],
];

/** Bitmask form of the adjacency table: bit t set => tile t allowed adjacent. */
export const ADJACENCY_MASK: readonly number[] = ADJACENT.map((list) =>
  list.reduce((m, t) => m | (1 << t), 0),
);

/** Sanity invariant: the adjacency relation must be symmetric. */
for (let a = 0; a < TILE_COUNT; a++) {
  for (let b = 0; b < TILE_COUNT; b++) {
    const ab = (ADJACENCY_MASK[a] >> b) & 1;
    const ba = (ADJACENCY_MASK[b] >> a) & 1;
    if (ab !== ba) throw new Error(`Adjacency table asymmetric for ${a},${b}`);
  }
}

export function isWalkable(t: Tile): boolean {
  return t === Tile.Grass || t === Tile.Dirt;
}

export function isBuildable(t: Tile): boolean {
  return t === Tile.Grass || t === Tile.Dirt;
}

export const FULL_MASK = (1 << TILE_COUNT) - 1;
