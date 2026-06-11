/**
 * Core domain types for the Warband RTS.
 * Pure type definitions — no behavior, no magic constants.
 */

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export type Faction = "human" | "orc";

export const FACTIONS: readonly Faction[] = ["human", "orc"] as const;

// ---------------------------------------------------------------------------
// Unit kinds
// ---------------------------------------------------------------------------

export type UnitKind = "worker" | "infantry" | "ranged" | "heavy";

export const UNIT_KINDS: readonly UnitKind[] = [
  "worker",
  "infantry",
  "ranged",
  "heavy",
] as const;

// ---------------------------------------------------------------------------
// Building kinds
// ---------------------------------------------------------------------------

export type BuildingKind =
  | "townHall"
  | "farm"
  | "barracks"
  | "lumberMill"
  | "guardTower";

export const BUILDING_KINDS: readonly BuildingKind[] = [
  "townHall",
  "farm",
  "barracks",
  "lumberMill",
  "guardTower",
] as const;

// ---------------------------------------------------------------------------
// Entity identity
// ---------------------------------------------------------------------------

/** Opaque numeric entity identifier — use EntityId rather than bare number. */
export type EntityId = number & { readonly __brand: "EntityId" };

export function makeEntityId(n: number): EntityId {
  return n as EntityId;
}

// ---------------------------------------------------------------------------
// Tile / terrain enums
// ---------------------------------------------------------------------------

export type TileKind =
  | "grass"
  | "dirt"
  | "forest"
  | "water"
  | "rock"
  | "goldMine";

export const TILE_KINDS: readonly TileKind[] = [
  "grass",
  "dirt",
  "forest",
  "water",
  "rock",
  "goldMine",
] as const;

// ---------------------------------------------------------------------------
// Resource kinds
// ---------------------------------------------------------------------------

export type ResourceKind = "gold" | "wood" | "supply";

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  "gold",
  "wood",
  "supply",
] as const;

// ---------------------------------------------------------------------------
// Order kinds
// ---------------------------------------------------------------------------

export type OrderKind =
  | "move"
  | "attack"
  | "attackMove"
  | "harvest"
  | "build"
  | "repair"
  | "stop"
  | "hold"
  | "train";

export type Order =
  | { readonly kind: "move"; readonly targetPos: { readonly x: number; readonly y: number } }
  | { readonly kind: "attack"; readonly targetId: EntityId }
  | { readonly kind: "attackMove"; readonly targetPos: { readonly x: number; readonly y: number } }
  | { readonly kind: "harvest"; readonly targetId: EntityId }
  | { readonly kind: "build"; readonly buildingKind: BuildingKind; readonly pos: { readonly x: number; readonly y: number } }
  | { readonly kind: "repair"; readonly targetId: EntityId }
  | { readonly kind: "stop" }
  | { readonly kind: "hold" }
  | { readonly kind: "train"; readonly unitKind: UnitKind };

// ---------------------------------------------------------------------------
// Fog-of-war tile visibility
// ---------------------------------------------------------------------------

export type Visibility = "unexplored" | "explored" | "visible";
