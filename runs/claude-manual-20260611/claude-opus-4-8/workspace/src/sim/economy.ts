/**
 * T10 — Economy phase: harvesting, supply accounting, construction, repair,
 * and unit training.
 *
 * This module exports `phaseEconomy`, which replaces the no-op stub in
 * `simulation.ts`.  It is the single place all resource-producing and
 * resource-consuming mechanics live.
 *
 * ## Harvesting (worker)
 * A worker with a `harvest` order goes through a cycle:
 *   APPROACH → GATHER (GATHER_TICKS per load) → RETURN → DEPOSIT → APPROACH
 * Approach: the movement phase has already walked the worker adjacent to the
 * resource.  The economy phase checks adjacency (Chebyshev ≤ 1) to the target
 * tile identified in `workerState`.  On first adjacency it sets `gatherPhase`.
 * Gather: increments a per-unit tick counter; on completion picks up
 * GOLD_LOAD / WOOD_LOAD units and decrements `goldRemaining` (mine) or flips
 * the tile to dirt (forest, after one load).
 * Return: the movement phase walks the worker to the chosen drop-off building;
 * the economy phase orders movement and then waits for adjacency.
 * Deposit: increments player gold/wood, clears `unit.carrying`, re-issues the
 * harvest movement toward the resource.
 *
 * ## Supply
 * `supplyCap` = sum of `supplyProvided` over completed Town Hall + Farm for
 * the faction.  Recomputed each tick so it is always consistent with the live
 * building set.  `supplyUsed` is set from the unit set the same way, so it
 * does not drift even if addUnit/cleanup double-count.
 *
 * ## Construction
 * A worker with a `build` order: on first adjacency to the target tile,
 * deducts the building's gold/wood cost (if the player can afford it and the
 * placement is valid) and spawns a building at `buildProgress = 0`.  Each
 * subsequent tick the worker remains adjacent it advances `buildProgress` by
 * `1 / buildTime`; hp grows proportionally.  On completion (buildProgress ≥ 1)
 * the worker idles and `supplyCap` is incremented (via the supply recount).
 *
 * ## Repair
 * A worker with a `repair` order adjacent to a friendly, damaged, complete
 * building restores `REPAIR_HP_PER_TICK` hp per tick, deducting
 * `REPAIR_WOOD_PER_HP` wood per hp restored.  If the player cannot afford any
 * wood the repair stalls.
 *
 * ## Training
 * A building with a `train` order enqueues the unit if: the player has enough
 * gold/wood, `supplyUsed + unitSupplyCost ≤ supplyCap`, and all building
 * prerequisites are met.  On enqueue gold/wood are deducted and supply is
 * reserved (`supplyUsed += supplyCost`).  The head of the queue advances by 1
 * tick per tick; on completion the unit spawns adjacent to the building.
 * Cancellation (order changes to non-train) refunds the cost of every queued
 * job and releases their reserved supply.
 *
 * ## Determinism
 * No `Math.random` is called.  Iteration order is deterministic (sorted
 * EntityId for units, sorted EntityId for buildings).  All mutable scratch
 * state lives on the Unit entity (`harvestState`, `buildState`) so two worlds
 * sharing the same EntityId counter cannot cross-contaminate each other's state.
 */

import type { Building, Unit, WorkerHarvestState } from "./entity.js";
import type { World } from "./world.js";
import type { Vec2 } from "../core/vec.js";
import type { BuildingKind, Faction, UnitKind } from "../game/types.js";
import { vec } from "../core/vec.js";
import {
  getBuildingStats,
  getUnitStats,
  UNIT_REQUIREMENTS,
  BUILDING_REQUIREMENTS,
} from "./stats.js";
import { idle } from "./orders.js";
import { addBuilding, addUnit } from "./world.js";
import { SIM_HZ } from "./simulation.js";
import { tilesForFootprint } from "./gamemap.js";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Gold extracted per harvest trip from a mine tile. */
const GOLD_LOAD = 100;

/** Wood gathered per chop from a forest tile (the entire tile's yield). */
const WOOD_LOAD = 100;

/** Ticks the worker spends gathering before picking up the load. */
const GATHER_TICKS = Math.round(SIM_HZ * 1.5); // 1.5 s

/**
 * HP restored per tick during repair.  At SIM_HZ=30 this is ~10 hp/s, which
 * feels expensive enough to be a real choice but fast enough to matter.
 */
const REPAIR_HP_PER_TICK = 0.333;

/**
 * Wood cost per HP restored.  Proportional to the building's wood cost
 * relative to its max HP, so the total wood cost to fully repair equals the
 * building's woodCost.  Stored as a scalar applied per HP; the per-tick debit
 * is `REPAIR_HP_PER_TICK * REPAIR_WOOD_PER_HP` (sub-integer debits accumulate
 * via a fractional ledger on the worker — no state added to Building).
 *
 * We use a fixed rate of 0.1 wood/hp for simplicity (matching Warcraft II
 * genre conventions).
 */
const REPAIR_WOOD_PER_HP = 0.1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Chebyshev distance between a fractional position and an integer tile centre. */
function chebyshevPosToTile(pos: { x: number; y: number }, tile: Vec2): number {
  const tx = Math.floor(pos.x);
  const ty = Math.floor(pos.y);
  return Math.max(Math.abs(tx - tile.x), Math.abs(ty - tile.y));
}

/**
 * True iff the unit position is adjacent to (Chebyshev ≤ 1) the given tile —
 * i.e. the worker is standing next to or on the target tile.
 */
function isAdjacentToTile(unit: Unit, tile: Vec2): boolean {
  return chebyshevPosToTile(unit.pos, tile) <= 1;
}

/**
 * True iff the unit position is adjacent to any tile of a building footprint.
 * A worker next to the TOP-LEFT tile of a 4×4 building is adjacent to the
 * building; workers walk to the nearest footprint edge.
 */
function isAdjacentToBuilding(unit: Unit, building: Building): boolean {
  const { tile, footprint } = building;
  for (const t of tilesForFootprint(tile, footprint)) {
    if (chebyshevPosToTile(unit.pos, t) <= 1) return true;
  }
  return false;
}

/**
 * Nearest completed building of `kind` owned by `faction` to `pos`, or null.
 * "Nearest" = Chebyshev distance from `pos` to the building's top-left tile.
 * Deterministic: ties broken by lowest EntityId.
 */
function nearestCompletedBuilding(
  world: World,
  faction: Faction,
  kind: BuildingKind,
  pos: { x: number; y: number },
): Building | null {
  let best: Building | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of world.buildings.values()) {
    if (b.owner !== faction || b.kind !== kind || b.buildProgress < 1) continue;
    const dist = Math.max(Math.abs(b.tile.x - Math.floor(pos.x)), Math.abs(b.tile.y - Math.floor(pos.y)));
    if (dist < bestDist || (dist === bestDist && best !== null && b.id < best.id)) {
      bestDist = dist;
      best = b;
    }
  }
  return best;
}

/**
 * Nearest completed drop-off building for `kind` owned by `faction`.
 * Gold drops off at Town Hall only; wood drops off at Lumber Mill OR Town Hall
 * (Lumber Mill preferred for wood if one exists).
 */
function nearestDropOff(
  world: World,
  faction: Faction,
  resourceKind: "gold" | "wood",
  pos: { x: number; y: number },
): Building | null {
  if (resourceKind === "gold") {
    return nearestCompletedBuilding(world, faction, "townHall", pos);
  }
  // Wood: prefer Lumber Mill, fall back to Town Hall.
  const lumberMill = nearestCompletedBuilding(world, faction, "lumberMill", pos);
  if (lumberMill !== null) return lumberMill;
  return nearestCompletedBuilding(world, faction, "townHall", pos);
}

/**
 * Issues a `move` order to walk toward a building (its top-left tile centre).
 * The movement phase handles pathfinding from there.
 */
function orderMoveToBuilding(unit: Unit, building: Building): void {
  unit.order = {
    kind: "move",
    targetPos: { x: building.tile.x, y: building.tile.y },
  };
  unit.path = undefined;
  unit.arrival = undefined;
  unit.pinned = undefined;
}

/**
 * Issues a `move` order to walk toward a tile.
 */
function orderMoveToTile(unit: Unit, tile: Vec2): void {
  unit.order = {
    kind: "move",
    targetPos: { x: tile.x, y: tile.y },
  };
  unit.path = undefined;
  unit.arrival = undefined;
  unit.pinned = undefined;
}

/**
 * Finds a walkable tile adjacent (8-connected) to the building footprint to
 * spawn a trained unit on.  Returns the first walkable adjacent tile in
 * row-major ring order, or the building's top-left tile as a fallback (the
 * unit will be displaced by the separation pass eventually).
 */
function spawnTileForBuilding(world: World, building: Building): Vec2 {
  const { tile, footprint } = building;
  const minX = tile.x - 1;
  const maxX = tile.x + footprint.w;
  const minY = tile.y - 1;
  const maxY = tile.y + footprint.h;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Only perimeter cells.
      const onPerimeter =
        x === minX || x === maxX || y === minY || y === maxY;
      if (!onPerimeter) continue;
      if (!world.map.inBounds(x, y)) continue;
      if (!world.map.isTileBlocked(x, y)) return vec(x, y);
    }
  }
  return tile; // fallback
}

/**
 * True iff all required buildings for `unitKind` exist (completed, not dead)
 * in the faction's building set.
 */
function prerequisitesMet(world: World, faction: Faction, unitKind: UnitKind): boolean {
  const required = UNIT_REQUIREMENTS[unitKind];
  for (const reqKind of required) {
    let found = false;
    for (const b of world.buildings.values()) {
      if (b.owner === faction && b.kind === reqKind && b.buildProgress >= 1) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * True iff all required buildings for `buildingKind` exist (completed) in the
 * faction's building set.
 */
function buildingPrerequisitesMet(world: World, faction: Faction, buildingKind: BuildingKind): boolean {
  const required = BUILDING_REQUIREMENTS[buildingKind];
  for (const reqKind of required) {
    let found = false;
    for (const b of world.buildings.values()) {
      if (b.owner === faction && b.kind === reqKind && b.buildProgress >= 1) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Nearest walkable forest tile to `pos`, or null if none exists on the map.
 * Deterministic: scans in row-major order, returns the first tile within a
 * bounded radius that is a `forest` terrain type and not occupied.
 */
function nearestForestTile(world: World, pos: { x: number; y: number }): Vec2 | null {
  // BFS outward in Chebyshev rings is expensive; use a bounded scan instead.
  const MAX_RADIUS = 20;
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  let best: Vec2 | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let dy = -MAX_RADIUS; dy <= MAX_RADIUS; dy++) {
    for (let dx = -MAX_RADIUS; dx <= MAX_RADIUS; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (!world.map.inBounds(tx, ty)) continue;
      if (world.map.tileAt(tx, ty) !== "forest") continue;
      if (world.map.isTileBlocked(tx, ty)) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist < bestDist) {
        bestDist = dist;
        best = vec(tx, ty);
      }
    }
  }
  return best;
}

/**
 * Nearest live gold mine tile to `pos`, or null if none in range.
 */
function nearestGoldMineTile(world: World, pos: { x: number; y: number }): Vec2 | null {
  const MAX_RADIUS = 20;
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  let best: Vec2 | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let dy = -MAX_RADIUS; dy <= MAX_RADIUS; dy++) {
    for (let dx = -MAX_RADIUS; dx <= MAX_RADIUS; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (!world.map.inBounds(tx, ty)) continue;
      if (world.map.tileAt(tx, ty) !== "goldMine") continue;
      if (world.map.goldAt(tx, ty) <= 0) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist < bestDist) {
        bestDist = dist;
        best = vec(tx, ty);
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Supply accounting
// ---------------------------------------------------------------------------

/**
 * Recomputes `supplyCap` for each faction from scratch each tick.  Counts
 * completed Town Halls and Farms; non-supply buildings contribute 0.  This
 * O(buildings) scan eliminates drift from building add/complete/destroy
 * without requiring every path to update it.
 *
 * `supplyUsed` is NOT recomputed here — it is maintained incrementally by
 * `addUnit` (world.ts), the cleanup phase (simulation.ts), and training
 * enqueue/spawn (this module).  Recomputing it here would clobber the supply
 * reserved at training-enqueue time (before the unit actually exists in
 * `world.units`), causing the cap check to allow over-training.
 */
function recomputeSupplyCap(world: World): void {
  for (const faction of ["human", "orc"] as Faction[]) {
    let cap = 0;
    for (const b of world.buildings.values()) {
      if (b.owner !== faction) continue;
      if (b.buildProgress < 1) continue;
      cap += getBuildingStats(faction, b.kind).supplyProvided;
    }
    world.players[faction].supplyCap = cap;
  }
}

// ---------------------------------------------------------------------------
// Harvesting
// ---------------------------------------------------------------------------

/**
 * Core harvest cycle state machine.  Called both when the unit has a `harvest`
 * order (initial dispatch and gather phase) and when the unit has a `move` or
 * `stop` order but still holds harvest scratch state (approach / return legs).
 *
 * The movement phase handles path-following; the economy phase drives phase
 * transitions by checking adjacency each tick.
 */
function runHarvestCycle(world: World, unit: Unit, state: WorkerHarvestState): void {
  // Verify the resource tile is still valid; find a new one if exhausted.
  const tileKind = world.map.tileAt(state.resourceTile.x, state.resourceTile.y);
  const isGoldMine = tileKind === "goldMine" && world.map.goldAt(state.resourceTile.x, state.resourceTile.y) > 0;
  const isForest = tileKind === "forest";
  const resourceValid = isGoldMine || isForest;

  if (!resourceValid && state.phase !== "return" && state.phase !== "deposit") {
    // Current resource exhausted — find a new one.
    const newTile = nearestGoldMineTile(world, unit.pos) ?? nearestForestTile(world, unit.pos);
    if (newTile === null) {
      unit.order = idle();
      unit.harvestState = undefined;
      return;
    }
    state.resourceTile = newTile;
    state.phase = "approach";
    state.gatherTicks = 0;
    orderMoveToTile(unit, newTile);
    return;
  }

  switch (state.phase) {
    case "approach": {
      // Check if we are now adjacent to the resource tile.
      if (isAdjacentToTile(unit, state.resourceTile)) {
        state.phase = "gather";
        state.gatherTicks = 0;
        // Stop the move order so separation/movement don't keep pushing us.
        unit.order = idle();
        unit.path = undefined;
        unit.arrival = undefined;
        unit.pinned = undefined;
      }
      // Otherwise the movement phase is walking us there.
      break;
    }

    case "gather": {
      // Check still adjacent (unit might have been pushed away).
      if (!isAdjacentToTile(unit, state.resourceTile)) {
        state.phase = "approach";
        orderMoveToTile(unit, state.resourceTile);
        break;
      }

      state.gatherTicks++;
      if (state.gatherTicks >= GATHER_TICKS) {
        // Pick up the load.
        const rt = state.resourceTile;
        const tKind = world.map.tileAt(rt.x, rt.y);
        if (tKind === "goldMine") {
          const taken = world.map.extractGold(rt.x, rt.y, GOLD_LOAD);
          unit.carrying = { kind: "gold", amount: taken };
          if (taken === 0) {
            // Mine ran out exactly; find a new one.
            const newMine = nearestGoldMineTile(world, unit.pos);
            if (newMine === null) {
              unit.order = idle();
              unit.harvestState = undefined;
              return;
            }
            state.resourceTile = newMine;
            state.phase = "approach";
            state.gatherTicks = 0;
            orderMoveToTile(unit, newMine);
            break;
          }
        } else if (tKind === "forest") {
          // Deplete the forest tile to dirt.
          unit.carrying = { kind: "wood", amount: WOOD_LOAD };
          world.map.terrain.set(rt.x, rt.y, "dirt");
        } else {
          // Tile changed under us — restart.
          unit.carrying = undefined;
          const newRes = nearestGoldMineTile(world, unit.pos) ?? nearestForestTile(world, unit.pos);
          if (newRes === null) {
            unit.order = idle();
            unit.harvestState = undefined;
            return;
          }
          state.resourceTile = newRes;
          state.phase = "approach";
          state.gatherTicks = 0;
          orderMoveToTile(unit, newRes);
          break;
        }

        // Walk to drop-off.
        const kind = unit.carrying!.kind;
        const dropOff = nearestDropOff(world, unit.owner, kind, unit.pos);
        if (dropOff === null) {
          // No drop-off building — wait in place.
          state.phase = "return";
          break;
        }
        state.phase = "return";
        state.gatherTicks = 0;
        orderMoveToBuilding(unit, dropOff);
      }
      break;
    }

    case "return": {
      if (unit.carrying === undefined) {
        // Carrying was cleared externally — restart.
        state.phase = "approach";
        orderMoveToTile(unit, state.resourceTile);
        break;
      }
      const dropOff = nearestDropOff(world, unit.owner, unit.carrying.kind, unit.pos);
      if (dropOff === null) {
        // Still no drop-off; wait.
        break;
      }
      if (isAdjacentToBuilding(unit, dropOff)) {
        // Arrived at drop-off.
        state.phase = "deposit";
        // Run deposit immediately this tick.
        const player = world.players[unit.owner];
        if (unit.carrying.kind === "gold") {
          player.gold += unit.carrying.amount;
        } else {
          player.wood += unit.carrying.amount;
        }
        unit.carrying = undefined;
        // Go back to resource.
        state.phase = "approach";
        state.gatherTicks = 0;
        orderMoveToTile(unit, state.resourceTile);
      } else {
        // Keep moving toward drop-off.
        if (unit.order.kind !== "move") {
          orderMoveToBuilding(unit, dropOff);
        }
      }
      break;
    }

    case "deposit": {
      // Should not reach here (deposit is handled inline in "return" above),
      // but handle gracefully just in case.
      if (unit.carrying !== undefined) {
        const player = world.players[unit.owner];
        if (unit.carrying.kind === "gold") {
          player.gold += unit.carrying.amount;
        } else {
          player.wood += unit.carrying.amount;
        }
        unit.carrying = undefined;
      }
      state.phase = "approach";
      state.gatherTicks = 0;
      orderMoveToTile(unit, state.resourceTile);
      break;
    }
  }
}

/**
 * Entry point when the unit has a `harvest` order (no existing state → bootstrap;
 * existing state → delegate to cycle).
 */
function tickHarvest(world: World, unit: Unit): void {
  const o = unit.order;
  if (o.kind !== "harvest") return;

  let state = unit.harvestState;

  if (state === undefined) {
    // Bootstrap: find nearest resource and start approach.
    const goldTile = nearestGoldMineTile(world, unit.pos);
    const forestTile = nearestForestTile(world, unit.pos);

    let resourceTile: Vec2 | null = null;
    if (goldTile !== null && forestTile !== null) {
      const goldDist = Math.max(Math.abs(goldTile.x - Math.floor(unit.pos.x)), Math.abs(goldTile.y - Math.floor(unit.pos.y)));
      const forestDist = Math.max(Math.abs(forestTile.x - Math.floor(unit.pos.x)), Math.abs(forestTile.y - Math.floor(unit.pos.y)));
      resourceTile = goldDist <= forestDist ? goldTile : forestTile;
    } else {
      resourceTile = goldTile ?? forestTile;
    }

    if (resourceTile === null) {
      unit.order = idle();
      return;
    }

    state = { phase: "approach", resourceTile, gatherTicks: 0, repairWoodDebt: 0 };
    unit.harvestState = state;
    orderMoveToTile(unit, resourceTile);
    return;
  }

  // Existing state — run the cycle.
  runHarvestCycle(world, unit, state);
}

/**
 * Called when the unit's order is "move" or "stop" but it still has harvest
 * scratch state — i.e. the unit is in the approach or return leg.
 */
function tickHarvestMove(world: World, unit: Unit): void {
  const state = unit.harvestState;
  if (state === undefined) return;
  runHarvestCycle(world, unit, state);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Processes one tick of construction for `unit`.
 */
function tickConstruct(world: World, unit: Unit): void {
  const o = unit.order;
  if (o.kind !== "build") return;

  const targetTile = vec(Math.floor(o.pos.x), Math.floor(o.pos.y));
  let state = unit.buildState;

  if (state === undefined || !state.started) {
    // Check if we are adjacent to the target tile.
    if (!isAdjacentToTile(unit, targetTile)) {
      // Movement phase is walking us there.
      return;
    }

    // Check if a building already exists at this tile (someone else may have
    // started it, or the worker re-issued the order).
    const existingOccupant = world.map.occupant(targetTile.x, targetTile.y);
    if (existingOccupant !== undefined) {
      const existing = world.buildings.get(existingOccupant);
      if (existing !== undefined && existing.kind === o.buildingKind) {
        // A building of the right kind already exists — help build it.
        state = { buildingId: existingOccupant, started: true };
        unit.buildState = state;
        // Fall through to the construction-advance logic.
      } else {
        // Occupied by a different building or destroyed — idle.
        unit.order = idle();
        unit.buildState = undefined;
        return;
      }
    } else {
      // Start construction: deduct cost and place a 0-progress building.
      const bStats = getBuildingStats(unit.owner, o.buildingKind);
      const player = world.players[unit.owner];

      if (player.gold < bStats.goldCost || player.wood < bStats.woodCost) {
        // Cannot afford — idle.
        unit.order = idle();
        unit.buildState = undefined;
        return;
      }

      // Check prerequisites.
      if (!buildingPrerequisitesMet(world, unit.owner, o.buildingKind)) {
        unit.order = idle();
        unit.buildState = undefined;
        return;
      }

      // Check placement validity.
      if (!world.map.canPlaceBuilding(targetTile, bStats.footprint)) {
        unit.order = idle();
        unit.buildState = undefined;
        return;
      }

      // Deduct cost and place building.
      player.gold -= bStats.goldCost;
      player.wood -= bStats.woodCost;

      const building: Building = {
        id: world.nextId(),
        owner: unit.owner,
        kind: o.buildingKind,
        hp: 1, // Starts with 1 hp; grows with buildProgress.
        maxHp: bStats.hp,
        tile: targetTile,
        footprint: bStats.footprint,
        buildProgress: 0,
        trainQueue: [],
      };

      addBuilding(world, building);
      state = { buildingId: building.id, started: true };
      unit.buildState = state;
    }
  }

  // Advance construction.
  const building = world.buildings.get(state.buildingId);
  if (building === undefined) {
    // Building was destroyed.
    unit.order = idle();
    unit.buildState = undefined;
    return;
  }

  if (building.buildProgress >= 1) {
    // Already complete — idle.
    unit.order = idle();
    unit.buildState = undefined;
    return;
  }

  // Check adjacency to the building (worker may have been pushed away).
  if (!isAdjacentToBuilding(unit, building)) {
    orderMoveToBuilding(unit, building);
    return;
  }

  const bStats = getBuildingStats(building.owner, building.kind);
  const buildTime = Math.max(bStats.buildTime, 1);
  const increment = 1 / buildTime;
  building.buildProgress = Math.min(1, building.buildProgress + increment);
  building.hp = Math.max(1, Math.round(building.buildProgress * building.maxHp));

  if (building.buildProgress >= 1) {
    building.buildProgress = 1;
    building.hp = building.maxHp;
    unit.order = idle();
    unit.buildState = undefined;
  }
}

/**
 * Called when the unit's order is "move" or "stop" but it still has build
 * scratch state — the unit is en route to the construction site, or the
 * order was converted to idle/move to reposition.  Advances construction if
 * the building exists and the worker is adjacent.
 */
function tickConstructMove(world: World, unit: Unit): void {
  const state = unit.buildState;
  if (state === undefined || !state.started) return;

  const building = world.buildings.get(state.buildingId);
  if (building === undefined) {
    unit.buildState = undefined;
    return;
  }

  if (building.buildProgress >= 1) {
    unit.buildState = undefined;
    return;
  }

  if (!isAdjacentToBuilding(unit, building)) {
    // Not yet adjacent — re-issue move order.
    orderMoveToBuilding(unit, building);
    return;
  }

  const bStats = getBuildingStats(building.owner, building.kind);
  const buildTime = Math.max(bStats.buildTime, 1);
  building.buildProgress = Math.min(1, building.buildProgress + 1 / buildTime);
  building.hp = Math.max(1, Math.round(building.buildProgress * building.maxHp));

  if (building.buildProgress >= 1) {
    building.buildProgress = 1;
    building.hp = building.maxHp;
    unit.order = idle();
    unit.buildState = undefined;
  } else {
    // Keep idle so movement doesn't interfere (we're constructing in place).
    unit.order = idle();
  }
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/**
 * Processes one tick of repair for `unit`.
 */
function tickRepair(world: World, unit: Unit): void {
  const o = unit.order;
  if (o.kind !== "repair") return;

  const target = world.buildings.get(o.targetId);
  if (target === undefined || target.owner !== unit.owner || target.buildProgress < 1) {
    unit.order = idle();
    return;
  }

  if (target.hp >= target.maxHp) {
    // Already at full hp.
    unit.order = idle();
    return;
  }

  if (!isAdjacentToBuilding(unit, target)) {
    // Movement phase should walk us there via the repair order destination.
    return;
  }

  const player = world.players[unit.owner];
  if (player.wood <= 0) {
    // No wood to repair with — stall.
    return;
  }

  // Accumulate repair state (wood debt) on the worker scratch state.
  let state = unit.harvestState;
  if (state === undefined) {
    // Re-use the worker harvestState for repair wood debt.
    state = {
      phase: "approach",
      resourceTile: target.tile,
      gatherTicks: 0,
      repairWoodDebt: 0,
    };
    unit.harvestState = state;
  }

  // Restore HP and deduct wood proportionally.
  const hpToRestore = Math.min(REPAIR_HP_PER_TICK, target.maxHp - target.hp);
  const woodCost = hpToRestore * REPAIR_WOOD_PER_HP + state.repairWoodDebt;
  const woodToDebit = Math.floor(woodCost);
  state.repairWoodDebt = woodCost - woodToDebit;

  if (woodToDebit > 0 && player.wood < woodToDebit) {
    // Cannot afford this tick's debit — stall.
    return;
  }

  player.wood -= woodToDebit;
  target.hp = Math.min(target.maxHp, target.hp + hpToRestore);
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

/** Kinds of buildings that can train units, and which unit kinds they train. */
const TRAINABLE_UNITS: Partial<Record<BuildingKind, readonly UnitKind[]>> = {
  townHall: ["worker"],
  barracks: ["infantry", "ranged", "heavy"],
};

/**
 * Processes one tick of training for `building`.
 *
 * On a `train` order:
 *   - Check resources, supply headroom, and prerequisites.
 *   - Deduct gold/wood and reserve supply (supplyUsed += supplyCost).
 *   - Enqueue a TrainJob.
 *   - Clear the order so the next tick can re-enqueue another (or idle).
 *
 * The head of the queue is advanced each tick regardless of the current order.
 * When the head completes, a unit is spawned adjacent to the building.
 *
 * If the building's order changes away from `train` while jobs are queued,
 * cancel all jobs and refund costs.
 */
function tickTraining(world: World, building: Building): void {
  if (building.buildProgress < 1) return;

  const trainableKinds = TRAINABLE_UNITS[building.kind];
  if (trainableKinds === undefined) return;

  const player = world.players[building.owner];
  const currentOrderKind = building.order?.kind ?? "stop";

  // --- Cancel / refund on an explicit "hold" order ---
  // "hold" is the cancel signal.  "stop" is the natural post-enqueue idle and
  // does NOT cancel — the queue keeps running silently in the background.
  if (currentOrderKind === "hold") {
    if (building.trainQueue.length > 0) {
      refundTrainQueue(world, building);
    }
    return;
  }

  // --- Advance the head of the queue (regardless of current order kind) ---
  if (building.trainQueue.length > 0) {
    const job = building.trainQueue[0];
    job.progress++;

    if (job.progress >= job.trainTime) {
      // Training complete — spawn the unit.
      building.trainQueue.shift();

      const uStats2 = getUnitStats(building.owner, job.unitKind);
      const spawnTile = spawnTileForBuilding(world, building);
      const unit: Unit = {
        id: world.nextId(),
        owner: building.owner,
        kind: job.unitKind,
        hp: uStats2.hp,
        maxHp: uStats2.hp,
        pos: { x: spawnTile.x + 0.5, y: spawnTile.y + 0.5 },
        order: idle(),
        attackCooldown: 0,
      };

      // addUnit increments supplyUsed — but supply was already reserved at
      // enqueue time.  We subtract it first to avoid double-counting.
      player.supplyUsed -= uStats2.supplyCost;
      addUnit(world, unit);

      // Apply rally point if set.
      if (building.rallyPoint !== undefined) {
        unit.order = {
          kind: "move",
          targetPos: { x: building.rallyPoint.x, y: building.rallyPoint.y },
        };
      }
    }
  }

  // --- Enqueue a new job on an explicit "train" order ---
  if (currentOrderKind !== "train") return;

  const o = building.order!;
  if (o.kind !== "train") return; // narrowing guard
  const unitKind = o.unitKind;

  // Only allow training this unit kind if the building can train it.
  if (!trainableKinds.includes(unitKind)) {
    building.order = idle();
    return;
  }

  const uStats = getUnitStats(building.owner, unitKind);

  // Check prerequisites.
  if (!prerequisitesMet(world, building.owner, unitKind)) {
    building.order = idle();
  } else if (player.gold < uStats.goldCost || player.wood < uStats.woodCost) {
    building.order = idle();
  } else if (player.supplyUsed + uStats.supplyCost > player.supplyCap) {
    // Supply cap reached — training blocked.
    building.order = idle();
  } else {
    // Enqueue and deduct.
    player.gold -= uStats.goldCost;
    player.wood -= uStats.woodCost;
    // Reserve supply immediately.
    player.supplyUsed += uStats.supplyCost;
    building.trainQueue.push({
      unitKind,
      progress: 0,
      trainTime: uStats.trainTime,
    });
    // Clear train order so the next tick can take a fresh order (or idle).
    building.order = idle();
  }
}

/**
 * Refunds all jobs in `building.trainQueue` and releases their reserved supply.
 */
function refundTrainQueue(world: World, building: Building): void {
  const player = world.players[building.owner];
  for (const job of building.trainQueue) {
    const uStats = getUnitStats(building.owner, job.unitKind);
    player.gold += uStats.goldCost;
    player.wood += uStats.woodCost;
    player.supplyUsed -= uStats.supplyCost;
  }
  if (player.supplyUsed < 0) player.supplyUsed = 0;
  building.trainQueue.length = 0;
}

// ---------------------------------------------------------------------------
// Main phase entry point
// ---------------------------------------------------------------------------

/**
 * The economy phase: runs once per tick after combat.
 *
 * 1. Recompute supply (O(buildings + units) — always consistent).
 * 2. For each worker in EntityId order: advance harvest / build / repair.
 * 3. For each building in EntityId order: advance training.
 *
 * Scratch state (harvestState, buildState) lives on the Unit entity, so it is
 * garbage-collected automatically when the unit is removed and cannot
 * cross-contaminate two worlds that share the same EntityId counter.
 */
export function phaseEconomy(world: World): void {
  // 1. Supply cap recomputed from scratch each tick (eliminates drift from
  //    building add/complete/destroy).  supplyUsed is maintained incrementally.
  recomputeSupplyCap(world);

  // Sort for deterministic order.
  const units = [...world.units.values()].sort((a, b) => a.id - b.id);
  const buildings = [...world.buildings.values()].sort((a, b) => a.id - b.id);

  // 2. Workers: harvest / build / repair.
  // Workers may be in "move" order during the approach or return legs of a
  // harvest / build cycle — we continue processing them via their scratch state.
  for (const unit of units) {
    if (unit.kind !== "worker") continue;
    const orderKind = unit.order.kind;
    if (orderKind === "harvest") {
      tickHarvest(world, unit);
    } else if (orderKind === "build") {
      tickConstruct(world, unit);
    } else if (orderKind === "repair") {
      tickRepair(world, unit);
    } else if (orderKind === "move" || orderKind === "stop" || orderKind === "hold") {
      // Continue harvest or build cycle if scratch state exists.
      // "move" = approach/return leg; "stop"/"hold" = gathering in place or
      // waiting for resources.
      if (unit.harvestState !== undefined) {
        tickHarvestMove(world, unit);
      } else if (unit.buildState !== undefined) {
        tickConstructMove(world, unit);
      }
    }
  }

  // 3. Buildings: training.
  for (const building of buildings) {
    tickTraining(world, building);
  }
}
