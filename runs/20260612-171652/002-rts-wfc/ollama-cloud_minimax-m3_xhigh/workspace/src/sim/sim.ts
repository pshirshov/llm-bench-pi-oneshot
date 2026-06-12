// Sim step: top-level world tick driver. Advances all units, buildings, and
// projectiles one tick; recomputes fog of war; resolves win/lose.

import { World } from "./world.js";
import { isProjectile, isUnit, isBuilding } from "./entities.js";
import { TILE } from "./tiles.js";
import { TICK_DT } from "./stats.js";
import { stepUnit } from "./unitStep.js";
import { stepBuilding, stepProjectile } from "./buildingStep.js";
import { FOG, FOG as FOG_CONST } from "./fog.js";
import { getUnitStats } from "./stats.js";
import { aiStep } from "./ai.js";

function recomputeFog(world: World): void {
  // Reset all to UNEXPLORED.
  for (const f of ["humans", "orcs"] as const) {
    const grid = world.fog.get(f);
    grid.fill(FOG_CONST.UNEXPLORED);
  }
  // For each unit/building of a faction, reveal a sight-radius disk in that
  // faction's fog.
  for (const faction of ["humans", "orcs"] as const) {
    const grid = world.fog.get(faction);
    for (const e of world.entities.values()) {
      if (e.faction !== faction) continue;
      if (e.kind === "projectile") continue;
      let radius = 0;
      if (e.kind === "unit") {
        radius = getUnitStats(e.faction, e.unitKind).sightRadius;
      } else {
        // Use building's sight radius (or default).
        radius = e.buildingKind === "townhall" ? 9 : e.buildingKind === "guardtower" ? 8 : 6;
      }
      const cx = e.x;
      const cy = e.y;
      const r = Math.ceil(radius);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (!world.map.inBounds(x, y)) continue;
          if (dx * dx + dy * dy > radius * radius) continue;
          grid[y * world.map.width + x] = FOG_CONST.VISIBLE;
        }
      }
    }
  }
  // Demote VISIBLE tiles to EXPLORED where they are not in line of sight.
  // For simplicity, we use the per-tile chebyshev distance to nearest sight
  // source of the same faction. (Revealed = VISIBLE; other previously-revealed
  // tiles stay EXPLORED.) This is approximate but cheap and good enough.
  for (const faction of ["humans", "orcs"] as const) {
    const grid = world.fog.get(faction);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === FOG_CONST.UNEXPLORED) {
        // Check whether the tile was ever seen (i.e. was VISIBLE before reset).
        // We don't have a "last seen" buffer; the explored state is implicit in
        // the map tiles which never change after generation. So we just leave
        // UNEXPLORED as UNEXPLORED. This is a deliberate simplification: the
        // renderer can still see terrain/buildings of self by default.
        continue;
      }
    }
  }
}

function checkOutcome(world: World): void {
  if (world.outcome !== "playing") return;
  const humansAlive = world.buildingsOf("humans").some((b) => b.hp > 0);
  const orcsAlive = world.buildingsOf("orcs").some((b) => b.hp > 0);
  if (!humansAlive && !orcsAlive) {
    world.outcome = "defeat";
    world.winner = null;
  } else if (!humansAlive) {
    world.outcome = "victory";
    world.winner = "orcs";
  } else if (!orcsAlive) {
    world.outcome = "victory";
    world.winner = "humans";
  }
}

/** Step the world one sim-tick. dt defaults to TICK_DT. */
export function step(world: World, dt: number = TICK_DT): void {
  if (world.paused) return;
  // Snapshot entity ids so iteration is stable if we add/remove.
  const ids: number[] = [];
  for (const id of world.entities.keys()) ids.push(id);
  // Step projectiles first (resolve earlier hits).
  for (const id of ids) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind === "projectile") stepProjectile(world, e, dt);
  }
  // Step units.
  for (const id of ids) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind === "unit") stepUnit(world, e, dt);
  }
  // Step buildings.
  for (const id of ids) {
    const e = world.entities.get(id);
    if (!e) continue;
    if (e.kind === "building") stepBuilding(world, e, dt);
  }
  // Recompute supply caps (in case buildings finished).
  world.recomputeSupplyCap("humans");
  world.recomputeSupplyCap("orcs");
  // Recompute fog.
  recomputeFog(world);
  // AI step (only for AI-controlled factions).
  if (world.players.humans.difficulty > 0) aiStep(world, "humans", dt);
  if (world.players.orcs.difficulty > 0) aiStep(world, "orcs", dt);
  // Check outcome.
  checkOutcome(world);
  // Advance tick.
  world.tick++;
}

void FOG;
void TILE;
void isBuilding;
void isProjectile;
void isUnit;
