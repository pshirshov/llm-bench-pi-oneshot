import { buildingCenter } from "./entity.js";
import {
  updateBuilding,
  updateCorpses,
  updateProjectiles,
  updateUnit,
} from "./behaviors.js";
import { resolveSeparation } from "./movement.js";
import { BUILDING_STATS, UNIT_STATS } from "./stats.js";
import type { World } from "./world.js";

/**
 * Advance the whole simulation by one fixed timestep. Pure with respect to the
 * `world` argument: all mutation happens on `world`. Rendering and input never
 * call into this beyond passing the fixed dt.
 */
export function stepWorld(world: World, dt: number): void {
  if (world.status !== "playing") return;
  world.tick++;
  world.time += dt;

  // Rebuild spatial index from current unit positions.
  world.spatial.clear();
  for (const u of world.units.values()) world.spatial.insert(u.id, u.pos);

  // Derived resource/supply state, so this tick's decisions see fresh numbers.
  world.recomputeSupply();

  // Scripted opponent.
  if (world.ai) world.ai.update(world, dt);

  // Unit behaviour FSMs (movement integrated inside).
  for (const u of [...world.units.values()]) updateUnit(world, u, dt);

  // Resolve unit overlaps once, globally, after movement.
  resolveSeparation(world);

  // Buildings after units so construction sees this tick's worker presence.
  for (const b of [...world.buildings.values()]) updateBuilding(world, b, dt);

  updateProjectiles(world, dt);
  updateCorpses(world, dt);

  updateFog(world);
  checkVictory(world);
}

function updateFog(world: World): void {
  const fog = world.fog;
  fog.beginFrame();
  for (const u of world.units.values()) {
    if (u.faction === world.playerFaction) fog.reveal(u.pos, UNIT_STATS[u.role].sight);
  }
  for (const b of world.buildings.values()) {
    if (b.faction === world.playerFaction) {
      fog.reveal(buildingCenter(b), BUILDING_STATS[b.role].sight);
    }
  }
}

function checkVictory(world: World): void {
  if (!world.hasStarted()) return;
  const player = world.livingBuildings(world.playerFaction);
  const ai = world.livingBuildings(world.aiFaction);
  if (player === 0) world.status = "lost";
  else if (ai === 0) world.status = "won";
}
