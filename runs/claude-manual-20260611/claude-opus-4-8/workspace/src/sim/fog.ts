/**
 * Three-state fog-of-war for the Warband simulation.
 *
 * State machine per tile per faction:
 *   Unexplored  — tile has never been seen (rendered black).
 *   Explored    — tile was visible at some earlier tick but is not in any
 *                 friendly unit's sight cone now; last-seen terrain/building
 *                 snapshot is shown (rendered dimmed).
 *   Visible     — tile is currently within the sight radius of at least one
 *                 alive, friendly entity (rendered live).
 *
 * State transitions (per fog phase tick):
 *   Visible     → Explored  (on every tick, before recomputing from entities)
 *   Explored    stays Explored  (never reverts to Unexplored)
 *   Unexplored  → Visible    (when an entity's sight disk reaches the tile)
 *
 * Storage: `Grid<FogState>` per faction, held on `world.fog`.  No module-level
 * mutable state — two same-seed worlds stepped interleaved stay bit-identical.
 *
 * Sight disk: Euclidean distance from the entity's TILE POSITION (floor of unit
 * float pos) to candidate tile ≤ sight radius, scanning only the bounding square
 * for efficiency.  Integer-only arithmetic (no `Math.random`, no `Date.now`),
 * deterministic across identical inputs.
 */

import { Grid } from "../core/grid.js";
import { FACTIONS } from "../game/types.js";
import type { Faction } from "../game/types.js";
import { getUnitStats, getBuildingStats } from "./stats.js";
import type { World } from "./world.js";
import type { Building, Unit } from "./entity.js";

// ---------------------------------------------------------------------------
// FogState
// ---------------------------------------------------------------------------

/** Visibility state of one tile from one faction's perspective. */
export type FogState = "unexplored" | "explored" | "visible";

/** Per-faction fog grids stored on the World. */
export type FogMap = Record<Faction, Grid<FogState>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Allocates a fresh `FogMap` for a world of `width × height` tiles, with every
 * tile initialised to `"unexplored"`. Called by `createFogMap` below.
 */
export function createFogMap(width: number, height: number): FogMap {
  const result = {} as FogMap;
  for (const faction of FACTIONS) {
    result[faction] = new Grid<FogState>(width, height, "unexplored");
  }
  return result;
}

/**
 * Returns true iff tile `(tx, ty)` is currently `"visible"` to `faction`.
 * Bounds-unchecked callers should guard with map.inBounds first; out-of-bounds
 * tiles always return false (the Grid would throw a RangeError).
 */
export function isVisibleTo(world: World, faction: Faction, tx: number, ty: number): boolean {
  if (world.fog === undefined) return false;
  const fog = world.fog as FogMap;
  const grid = fog[faction];
  if (!grid.inBounds(tx, ty)) return false;
  return grid.get(tx, ty) === "visible";
}

/**
 * Returns true iff `entity` (unit OR building) is observable by `faction` —
 * i.e. its tile is currently `"visible"` to `faction`.
 *
 * For units the tile is `floor(pos.x)` × `floor(pos.y)`.
 * For buildings the tile is the TOP-LEFT anchor tile (the entire footprint is
 * revealed when any tile of it is visible, but the anchor is the canonical
 * representative used here; the phase paints the WHOLE footprint visible, so
 * any tile suffices — we check the anchor for simplicity).
 */
export function isEntityVisibleTo(
  world: World,
  faction: Faction,
  entity: Unit | Building,
): boolean {
  if (world.fog === undefined) return false;
  const fog = world.fog as FogMap;
  const grid = fog[faction];
  let tx: number;
  let ty: number;
  if ("pos" in entity) {
    // Unit: fractional position → tile index by floor
    tx = Math.floor(entity.pos.x);
    ty = Math.floor(entity.pos.y);
  } else {
    // Building: anchor tile
    tx = entity.tile.x;
    ty = entity.tile.y;
  }
  if (!grid.inBounds(tx, ty)) return false;
  return grid.get(tx, ty) === "visible";
}

// ---------------------------------------------------------------------------
// Sight-disk painter
// ---------------------------------------------------------------------------

/**
 * Marks every tile within Euclidean distance ≤ `radius` of `(cx, cy)` as
 * `"visible"` in `grid`. Uses integer squared-distance to stay deterministic
 * (no floating-point rounding divergence between platforms).
 */
function paintDisk(grid: Grid<FogState>, cx: number, cy: number, radius: number): void {
  // Scan the bounding square; check radius² to avoid sqrt.
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  const w = grid.width;
  const h = grid.height;
  const xMin = Math.max(0, cx - r);
  const xMax = Math.min(w - 1, cx + r);
  const yMin = Math.max(0, cy - r);
  const yMax = Math.min(h - 1, cy + r);
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        grid.set(x, y, "visible");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fog phase
// ---------------------------------------------------------------------------

/**
 * The fog phase: called once per tick (step 6 in SIM_PHASES) to recompute
 * per-faction fog grids.
 *
 * Algorithm per faction:
 *   1. Demote every `"visible"` tile to `"explored"` (they may become visible
 *      again below; `"unexplored"` tiles are untouched — they stay black until
 *      first seen).
 *   2. For each alive unit owned by this faction: paint a Euclidean disk of
 *      radius `stats.sight` centred on `floor(pos)`.
 *   3. For each alive building owned by this faction: paint a Euclidean disk of
 *      radius `stats.sight` centred on the building's footprint CENTRE tile
 *      (cx = tile.x + floor(footprint.w/2), cy = tile.y + floor(footprint.h/2)).
 *
 * Determinism: iteration over `world.units` / `world.buildings` is stable
 * within a tick (Map preserves insertion order) and the disk painter uses only
 * integer arithmetic. No `Math.random`, no `Date.now`, no module-level state.
 */
export function phaseFog(world: World): void {
  if (world.fog === undefined) return;
  const fog = world.fog as FogMap;
  const mapW = world.map.width;
  const mapH = world.map.height;

  for (const faction of FACTIONS) {
    const grid = fog[faction];

    // ── 1. Demote Visible → Explored ────────────────────────────────────────
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        if (grid.get(x, y) === "visible") {
          grid.set(x, y, "explored");
        }
      }
    }

    // ── 2. Units ─────────────────────────────────────────────────────────────
    for (const unit of world.units.values()) {
      if (unit.owner !== faction) continue;
      const stats = getUnitStats(faction, unit.kind);
      const cx = Math.floor(unit.pos.x);
      const cy = Math.floor(unit.pos.y);
      paintDisk(grid, cx, cy, stats.sight);
    }

    // ── 3. Buildings ──────────────────────────────────────────────────────────
    for (const building of world.buildings.values()) {
      if (building.owner !== faction) continue;
      const stats = getBuildingStats(faction, building.kind);
      // Centre of the footprint (integer tile, biased towards top-left for even
      // sizes — floor gives the left/top tile of the centre pair, which is a
      // deterministic, consistent choice).
      const cx = building.tile.x + Math.floor(building.footprint.w / 2);
      const cy = building.tile.y + Math.floor(building.footprint.h / 2);
      paintDisk(grid, cx, cy, stats.sight);
    }
  }
}
