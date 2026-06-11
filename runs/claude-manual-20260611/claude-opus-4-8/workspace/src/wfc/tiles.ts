/**
 * WFC tile set, weights, and the SYMMETRIC adjacency-rule table.
 *
 * The tile types mirror `TileKind` from src/game/types.ts but this module is
 * the authoritative source for the WFC solver: it owns the per-tile weights,
 * the legal-neighbour relation, and the render colours.  Keeping these here
 * (rather than in the pure type module) lets the solver depend on one place
 * for "what may sit next to what".
 */

// ---------------------------------------------------------------------------
// Tile types
// ---------------------------------------------------------------------------

/**
 * The closed set of terrain tiles the solver can emit.
 *  - grass / dirt : the connective tiles (border almost everything)
 *  - forest       : tree cover (grows out of grass/dirt)
 *  - water        : lakes/coast (borders only water + dirt)
 *  - rock         : mountain (clusters with itself; reached via dirt/grass)
 *  - goldMine     : a resource node that sits in grass/dirt clearings only
 */
export type TileType = "grass" | "dirt" | "forest" | "water" | "rock" | "goldMine";

/** All tile types, in a stable order. The index in this array is the tile's bit. */
export const TILE_TYPES: readonly TileType[] = [
  "grass",
  "dirt",
  "forest",
  "water",
  "rock",
  "goldMine",
] as const;

/** Number of distinct tiles; also the width of the domain bitmask. */
export const TILE_COUNT = TILE_TYPES.length;

/** Maps a tile type to its bit index (0..TILE_COUNT-1). */
export const TILE_INDEX: Readonly<Record<TileType, number>> = Object.freeze(
  TILE_TYPES.reduce<Record<TileType, number>>((acc, t, i) => {
    acc[t] = i;
    return acc;
  }, {} as Record<TileType, number>),
);

// ---------------------------------------------------------------------------
// Weights — relative frequency a tile is chosen at collapse time.
// Higher ⇒ more common. Gold mines and water are deliberately rare.
// ---------------------------------------------------------------------------

export const TILE_WEIGHTS: Readonly<Record<TileType, number>> = Object.freeze({
  grass: 10,
  dirt: 6,
  forest: 5,
  water: 4,
  rock: 3,
  goldMine: 1,
});

// ---------------------------------------------------------------------------
// Render colours (hex). Used later for programmatic Canvas rendering.
// ---------------------------------------------------------------------------

export const TILE_COLORS: Readonly<Record<TileType, string>> = Object.freeze({
  grass: "#4a7c3a",
  dirt: "#9b7653",
  forest: "#1f4d23",
  water: "#2b5d8a",
  rock: "#6e6e72",
  goldMine: "#d4af37",
});

// ---------------------------------------------------------------------------
// Adjacency rules.
//
// ADJACENCY[A] = the set of tiles permitted ORTHOGONALLY adjacent to A.
// Authored as an undirected relation; symmetry is asserted at module load via
// assertAdjacencySymmetry() so an authoring mistake fails loudly rather than
// producing a subtly-wrong solver.
//
// Design intent:
//  - grass/dirt are connective: they touch everything (incl. themselves).
//  - forest borders grass/dirt/forest (forests grow from / merge with land).
//  - water borders only water + dirt (a dirt shoreline, no grass coast).
//  - rock (mountain) clusters with itself and is reached through grass/dirt.
//  - goldMine sits in grass/dirt clearings: adjacent ONLY to grass + dirt
//    (never forest/water/rock, and never another goldMine — nodes are isolated).
// ---------------------------------------------------------------------------

export const ADJACENCY: Readonly<Record<TileType, readonly TileType[]>> = Object.freeze({
  grass: ["grass", "dirt", "forest", "rock", "goldMine"],
  dirt: ["grass", "dirt", "forest", "water", "rock", "goldMine"],
  forest: ["grass", "dirt", "forest"],
  water: ["dirt", "water"],
  rock: ["grass", "dirt", "rock"],
  goldMine: ["grass", "dirt"],
});

// ---------------------------------------------------------------------------
// Bitmask helpers
// ---------------------------------------------------------------------------

/** A domain is a bitmask: bit i set ⇒ TILE_TYPES[i] is still allowed. */
export type Domain = number;

/** Bitmask with exactly the bit for `t` set. */
export function tileBit(t: TileType): Domain {
  return 1 << TILE_INDEX[t];
}

/** The full domain (all tiles allowed). */
export const FULL_DOMAIN: Domain = (1 << TILE_COUNT) - 1;

/**
 * ADJACENCY_MASKS[i] = bitmask of tiles allowed next to TILE_TYPES[i].
 * Precomputed once so propagation is pure integer bit-twiddling.
 */
export const ADJACENCY_MASKS: readonly Domain[] = TILE_TYPES.map((t) => {
  let mask = 0;
  for (const n of ADJACENCY[t]) mask |= tileBit(n);
  return mask;
});

/** Count of set bits in a domain (population count). */
export function domainSize(d: Domain): number {
  let v = d;
  let c = 0;
  while (v !== 0) {
    v &= v - 1;
    c++;
  }
  return c;
}

/** Returns the list of tile types currently allowed by a domain. */
export function domainTiles(d: Domain): TileType[] {
  const out: TileType[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((d & (1 << i)) !== 0) out.push(TILE_TYPES[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Symmetry proof
// ---------------------------------------------------------------------------

/**
 * Verifies the adjacency relation is symmetric: for every ordered pair (A, B),
 * A permits B  ⟺  B permits A.  Returns the list of offending pairs (empty
 * when symmetric).  An undirected adjacency relation MUST be symmetric for the
 * propagation step (which treats neighbour support bidirectionally) to be sound.
 */
export function adjacencySymmetryViolations(): Array<readonly [TileType, TileType]> {
  const allows = (a: TileType, b: TileType): boolean => ADJACENCY[a].includes(b);
  const violations: Array<readonly [TileType, TileType]> = [];
  for (const a of TILE_TYPES) {
    for (const b of TILE_TYPES) {
      if (allows(a, b) !== allows(b, a)) violations.push([a, b] as const);
    }
  }
  return violations;
}

/** Throws if the adjacency table is not symmetric. */
export function assertAdjacencySymmetry(): void {
  const v = adjacencySymmetryViolations();
  if (v.length > 0) {
    const pairs = v.map(([a, b]) => `${a}~${b}`).join(", ");
    throw new Error(`WFC adjacency table is not symmetric: ${pairs}`);
  }
}

// Fail loudly at import time if the hand-authored table is inconsistent.
assertAdjacencySymmetry();
