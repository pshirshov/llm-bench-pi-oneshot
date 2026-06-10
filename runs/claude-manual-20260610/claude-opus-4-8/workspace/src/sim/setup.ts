import { deriveSeed } from "../core/rng.js";
import type { TileCoord, Vec2 } from "../core/vec.js";
import { generateMap, type MapReport } from "../wfc/mapgen.js";
import { AiController } from "./ai.js";
import { buildingCenter, createUnit, resetIds } from "./entity.js";
import { GameMap } from "./gamemap.js";
import { orderHarvest } from "./orders.js";
import { BUILDING_STATS, BuildingRole, enemyOf, Faction, UNIT_STATS, UnitRole } from "./stats.js";
import { World } from "./world.js";

export interface GameConfig {
  /** Map seed (campaign seed already mixed with level by the caller). */
  seed: number;
  width: number;
  height: number;
  playerFaction: Faction;
  difficulty: number;
}

export interface GameInit {
  world: World;
  playerStart: Vec2;
  aiStart: Vec2;
  report: MapReport;
}

const STARTING_WORKERS = 4;
const PLAYER_START_GOLD = 600;
const PLAYER_START_WOOD = 250;

/** Build a ready-to-play World from a config. Deterministic in `seed`. */
export function createGame(config: GameConfig): GameInit {
  resetIds();
  const { tiles, starts, report } = generateMap(config.seed, config.width, config.height);
  const map = new GameMap(tiles);
  const simSeed = deriveSeed(config.seed, 0x5151);
  const world = new World(map, config.playerFaction, simSeed);
  world.aiDifficulty = config.difficulty;

  const aiFaction = enemyOf(config.playerFaction);
  const playerHall = placeTownHall(world, config.playerFaction, starts[0]);
  const aiHall = placeTownHall(world, aiFaction, starts[1]);

  spawnStartingWorkers(world, config.playerFaction, playerHall.origin);
  spawnStartingWorkers(world, aiFaction, aiHall.origin);

  // Starting resources.
  const player = world.factions[config.playerFaction];
  player.gold = PLAYER_START_GOLD;
  player.wood = PLAYER_START_WOOD;

  const ai = world.factions[aiFaction];
  const d = config.difficulty;
  ai.gold = PLAYER_START_GOLD + d * 150;
  ai.wood = PLAYER_START_WOOD + d * 60;
  ai.harvestMultiplier = 1 + d * 0.08;

  world.ai = new AiController(aiFaction, d);
  world.recomputeSupply();
  world.markStarted();

  // Initial fog reveal so the player's base is visible before the first step.
  for (const u of world.units.values()) {
    if (u.faction === config.playerFaction) world.fog.reveal(u.pos, UNIT_STATS[u.role].sight);
  }
  for (const b of world.buildings.values()) {
    if (b.faction === config.playerFaction) {
      world.fog.reveal(buildingCenter(b), BUILDING_STATS[b.role].sight);
    }
  }

  return {
    world,
    playerStart: buildingCenter(playerHall),
    aiStart: buildingCenter(aiHall),
    report,
  };
}

function placeTownHall(world: World, faction: Faction, start: TileCoord) {
  const { w, h } = BUILDING_STATS[BuildingRole.TownHall].footprint;
  // Prefer centring the footprint on the start clearing.
  const preferred: TileCoord = { tx: start.tx - (w >> 1), ty: start.ty - (h >> 1) };
  let origin = preferred;
  if (!world.map.canPlace(origin.tx, origin.ty, w, h)) {
    origin = searchPlacement(world, start, w, h) ?? preferred;
  }
  return world.spawnBuilding(faction, BuildingRole.TownHall, origin, true);
}

function searchPlacement(world: World, near: TileCoord, w: number, h: number): TileCoord | null {
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = near.tx - (w >> 1) + dx;
        const ty = near.ty - (h >> 1) + dy;
        if (world.map.canPlace(tx, ty, w, h)) return { tx, ty };
      }
    }
  }
  return null;
}

function spawnStartingWorkers(world: World, faction: Faction, hallOrigin: TileCoord): void {
  const { w, h } = BUILDING_STATS[BuildingRole.TownHall].footprint;
  const center: Vec2 = { x: hallOrigin.tx + w / 2, y: hallOrigin.ty + h / 2 };
  let placed = 0;
  for (let r = 1; r <= 8 && placed < STARTING_WORKERS; r++) {
    for (let dy = -r; dy <= h - 1 + r && placed < STARTING_WORKERS; dy++) {
      for (let dx = -r; dx <= w - 1 + r && placed < STARTING_WORKERS; dx++) {
        const onRing = dx === -r || dy === -r || dx === w - 1 + r || dy === h - 1 + r;
        if (!onRing) continue;
        const tx = hallOrigin.tx + dx;
        const ty = hallOrigin.ty + dy;
        if (!world.map.isPassable(tx, ty)) continue;
        const u = createUnit(faction, UnitRole.Worker, { x: tx + 0.5, y: ty + 0.5 });
        world.addUnit(u);
        // First half to gold, rest to wood, to demonstrate both economies.
        if (placed < STARTING_WORKERS / 2) {
          const gold = world.findGoldMineNear(center, 24);
          if (gold) orderHarvest(world, u, gold, "gold");
        } else {
          const forest = world.findForestNear(center, 24);
          if (forest) orderHarvest(world, u, forest, "wood");
        }
        placed++;
      }
    }
  }
}
