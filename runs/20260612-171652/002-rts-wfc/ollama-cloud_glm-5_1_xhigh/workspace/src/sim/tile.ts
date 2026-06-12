/** Tile types, walkability, and adjacency rules. */

import type { TileType } from "./types";

export const ALL_TILE_TYPES: TileType[] = [
  "grass", "dirt", "forest", "water", "rock", "gold_mine",
  "depleted_mine", "chopped_forest",
];

export function isWalkable(t: TileType): boolean {
  return t === "grass" || t === "dirt" || t === "depleted_mine" || t === "chopped_forest";
}

export function isBuildable(t: TileType): boolean {
  return t === "grass" || t === "dirt";
}

export function isHarvestable(t: TileType): boolean {
  return t === "gold_mine" || t === "forest";
}

export function isResource(t: TileType): boolean {
  return t === "gold_mine" || t === "forest";
}

/** Post-depletion tile types. */
export function depletedForm(t: TileType): TileType {
  if (t === "gold_mine") return "depleted_mine";
  if (t === "forest") return "chopped_forest";
  return t;
}

/** WFC adjacency constraints: which tile types may be adjacent. */
export const ADJACENCY: Record<TileType, TileType[]> = {
  grass:  ["grass", "dirt", "forest", "gold_mine", "chopped_forest", "depleted_mine"],
  dirt:   ["grass", "dirt", "forest", "water", "rock", "gold_mine", "chopped_forest", "depleted_mine"],
  forest: ["grass", "dirt", "forest", "rock", "gold_mine"],
  water:  ["dirt", "water", "rock"],
  rock:   ["dirt", "forest", "water", "rock"],
  gold_mine: ["grass", "dirt", "forest"],
  depleted_mine: ["grass", "dirt", "chopped_forest"],
  chopped_forest: ["grass", "dirt", "depleted_mine", "forest", "chopped_forest"],
};

/** WFC tile weights — higher = more common. */
export const TILE_WEIGHTS: Record<TileType, number> = {
  grass: 30,
  dirt: 15,
  forest: 20,
  water: 8,
  rock: 5,
  gold_mine: 1,
  depleted_mine: 0,
  chopped_forest: 0,
};

export function tileColor(t: TileType): string {
  switch (t) {
    case "grass": return "#4a8c3f";
    case "dirt": return "#a08050";
    case "forest": return "#2d6b2d";
    case "water": return "#3366aa";
    case "rock": return "#808080";
    case "gold_mine": return "#ccaa33";
    case "depleted_mine": return "#776644";
    case "chopped_forest": return "#7a9a4a";
  }
}

export function tileBorderColor(t: TileType): string {
  switch (t) {
    case "water": return "#2255aa";
    case "rock": return "#606060";
    default: return "#33333322";
  }
}