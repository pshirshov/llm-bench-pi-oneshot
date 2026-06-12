/** Production system: training units and building construction. */

import type { Building, Unit, Faction, UnitType, BuildingType } from "./types";
import { UNIT_STATS, BUILDING_STATS } from "./stats";
import { createUnit, createBuilding } from "./entity";
import { dist } from "./helpers";
import { GameMap } from "./map";

/** Process building training queues. Returns newly created units. */
export function processTraining(
  buildings: Building[], faction: Faction, resources: { gold: number; wood: number },
  supplyUsed: number, supplyCap: number, map: GameMap, units: Unit[]
): Unit[] {
  const newUnits: Unit[] = [];

  for (const b of buildings) {
    if (!b.isComplete || b.hp <= 0 || b.trainingQueue.length === 0) continue;
    if (b.type !== "town_hall" && b.type !== "barracks") continue;

    const item = b.trainingQueue[0];
    const stats = UNIT_STATS[item.unitType];

    // Check supply cap
    if (supplyUsed + stats.supplyCost > supplyCap) continue;

    item.progress++;
    if (item.progress >= stats.trainTime) {
      // Unit trained — find spawn location
      const spawnPos = findSpawnPosition(b, map, units);
      const unit = createUnit(item.unitType, faction, spawnPos.x, spawnPos.y);
      newUnits.push(unit);
      b.trainingQueue.shift();

      // Start next in queue if any
      if (b.trainingQueue.length > 0) {
        const nextType = b.trainingQueue[0].unitType;
        const nextStats = UNIT_STATS[nextType];
        resources.gold -= nextStats.goldCost;
        resources.wood -= nextStats.woodCost;
      }
    }
  }

  return newUnits;
}

/** Find a valid spawn position adjacent to a building. */
function findSpawnPosition(
  building: Building, map: GameMap, units: Unit[]
): { x: number; y: number } {
  const bStats = BUILDING_STATS[building.type];
  // Check all tiles adjacent to the building
  const candidates: { x: number; y: number }[] = [];
  for (let dr = -1; dr <= bStats.height; dr++) {
    for (let dc = -1; dc <= bStats.width; dc++) {
      const c = building.col + dc;
      const r = building.row + dr;
      // Skip corners and tiles inside the building
      if (dc >= 0 && dc < bStats.width && dr >= 0 && dr < bStats.height) continue;
      // Skip diagonals that are too close to building
      if (!map.isWalkable(c, r)) continue;
      // Check no other unit is too close
      const cx = c + 0.5;
      const cy = r + 0.5;
      const occupied = units.some(u => dist(cx, cy, u.x, u.y) < 0.5);
      if (!occupied) {
        candidates.push({ x: cx, y: cy });
      }
    }
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  // If no adjacent tile is free, find nearest walkable tile (C6)
  return findNearestFreeTile(building.col + Math.floor(bStats.width / 2), building.row + bStats.height, map, units);
}

function findNearestFreeTile(
  startCol: number, startRow: number, map: GameMap, units: Unit[]
): { x: number; y: number } {
  // BFS outward from start
  const visited = new Set<string>();
  const queue: { col: number; row: number }[] = [{ col: startCol, row: startRow }];
  visited.add(`${startCol},${startRow}`);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    if (map.isWalkable(cur.col, cur.row)) {
      const cx = cur.col + 0.5;
      const cy = cur.row + 0.5;
      const occupied = units.some(u => dist(cx, cy, u.x, u.y) < 0.5);
      if (!occupied) return { x: cx, y: cy };
    }
    for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]] as [number,number][]) {
      const nc = cur.col + dc;
      const nr = cur.row + dr;
      const key = `${nc},${nr}`;
      if (!visited.has(key) && map.inBounds(nc, nr)) {
        visited.add(key);
        queue.push({ col: nc, row: nr });
      }
    }
  }
  // Fallback: just place at start (should not happen in practice)
  return { x: startCol + 0.5, y: startRow + 0.5 };
}

/** Validate building placement. Returns true if the placement is valid. */
export function validatePlacement(
  buildingType: BuildingType, col: number, row: number,
  map: GameMap, buildings: Building[], units: Unit[]
): boolean {
  const bStats = BUILDING_STATS[buildingType];
  // Check all tiles in the building footprint
  for (let dr = 0; dr < bStats.height; dr++) {
    for (let dc = 0; dc < bStats.width; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (!map.inBounds(c, r)) return false;
      if (!map.isBuildable(c, r)) return false;
      // Check for other buildings
      for (const b of buildings) {
        const bs = BUILDING_STATS[b.type];
        if (c >= b.col && c < b.col + bs.width && r >= b.row && r < b.row + bs.height) {
          return false;
        }
      }
      // Check for units (buildings can't overlap with units)
      for (const u of units) {
        if (Math.floor(u.x) === c && Math.floor(u.y) === r) return false;
      }
    }
  }
  return true;
}

/** Start building construction. Deducts resources and creates the building entity. */
export function startConstruction(
  buildingType: BuildingType, col: number, row: number, faction: Faction,
  resources: { gold: number; wood: number }, buildings: Building[]
): Building | null {
  const bStats = BUILDING_STATS[buildingType];
  if (resources.gold < bStats.goldCost || resources.wood < bStats.woodCost) return null;
  resources.gold -= bStats.goldCost;
  resources.wood -= bStats.woodCost;
  const building = createBuilding(buildingType, faction, col, row, false);
  building.hp = 1; // Starts with 1 HP, built up over time
  building.buildProgress = 0;
  buildings.push(building);
  return building;
}

/** Enqueue unit training. Returns true if training was started. */
export function enqueueTraining(
  building: Building, unitType: UnitType,
  resources: { gold: number; wood: number },
  supplyUsed: number, supplyCap: number
): boolean {
  const stats = UNIT_STATS[unitType];
  // Check prerequisites
  if (unitType === "ranged" || unitType === "heavy") {
    // Need lumber mill — checked externally
  }
  if (resources.gold < stats.goldCost || resources.wood < stats.woodCost) return false;
  if (supplyUsed + stats.supplyCost > supplyCap) return false;

  resources.gold -= stats.goldCost;
  resources.wood -= stats.woodCost;
  building.trainingQueue.push({ unitType, progress: 0 });
  return true;
}

/** Calculate supply counts. */
export function calculateSupply(units: Unit[], buildings: Building[], faction: Faction): { used: number; cap: number } {
  let used = 0;
  let cap = 0;
  for (const u of units) {
    if (u.faction === faction) used += UNIT_STATS[u.type].supplyCost;
  }
  for (const b of buildings) {
    if (b.faction === faction && b.isComplete && b.hp > 0) {
      cap += BUILDING_STATS[b.type].supplyProvided;
    }
  }
  return { used, cap };
}