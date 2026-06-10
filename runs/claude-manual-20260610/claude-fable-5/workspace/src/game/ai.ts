import { idx } from '../map/gamemap';
import { Tile } from '../map/tiles';
import {
  canPlaceBuilding,
  issueOrder,
  nearestTileOfKind,
  placeBuilding,
  trainUnit,
} from './commands';
import { BUILDING_STATS, BuildingType, Faction, UnitType } from './data';
import {
  Building,
  buildingCenter,
  distToBuilding,
  GameState,
  playerOf,
  Unit,
} from './state';

const THINK_INTERVAL = 1.0; // seconds between AI decision passes
const DEFEND_RADIUS = 12; // enemies this close to an AI building are threats
const DEFENSE_PULL_RADIUS = 40;
const FIRST_WAVE_TIME = 235; // seconds; difficulty shortens this further

export interface AiState {
  faction: Faction;
  nextThink: number;
  nextWave: number;
  waveNumber: number;
}

export function createAi(state: GameState): AiState {
  const d = state.difficulty;
  return {
    faction: state.players[1].faction,
    nextThink: 1,
    nextWave: FIRST_WAVE_TIME / (1 + 0.18 * (d - 1)),
    waveNumber: 0,
  };
}

export function tickAi(state: GameState, ai: AiState): void {
  if (state.result !== 'playing') return;
  if (state.time < ai.nextThink) return;
  ai.nextThink = state.time + THINK_INTERVAL;

  const myUnits = state.units.filter((u) => u.faction === ai.faction);
  const myBuildings = state.buildings.filter((b) => b.faction === ai.faction);
  const workers = myUnits.filter((u) => u.type === UnitType.Worker);
  const military = myUnits.filter((u) => u.type !== UnitType.Worker);
  const hall = myBuildings.find((b) => b.type === BuildingType.TownHall && b.constructed);
  const home = hall ? buildingCenter(hall) : myBuildings[0] ? buildingCenter(myBuildings[0]) : null;
  if (!home) return; // nothing left to manage; defeat is imminent

  defendBase(state, ai, myBuildings, military);
  manageWorkers(state, workers, home);
  manageConstruction(state, ai, myBuildings, workers, home);
  manageTraining(state, myBuildings, workers);
  manageWaves(state, ai, military);
}

// --- defense ---------------------------------------------------------------

function defendBase(state: GameState, ai: AiState, myBuildings: Building[], military: Unit[]): void {
  let threat: Unit | null = null;
  let threatDist = Infinity;
  for (const enemy of state.units) {
    if (enemy.faction === ai.faction) continue;
    for (const b of myBuildings) {
      const d = distToBuilding(b, enemy.x, enemy.y);
      if (d < DEFEND_RADIUS && d < threatDist) {
        threatDist = d;
        threat = enemy;
      }
    }
  }
  if (!threat) return;
  for (const u of military) {
    const d = Math.hypot(u.x - threat.x, u.y - threat.y);
    if (d > DEFENSE_PULL_RADIUS) continue;
    const busy = u.order.kind === 'attack' || u.autoTargetId !== null;
    if (!busy) issueOrder(state, u, { kind: 'attack', targetId: threat.id });
  }
}

// --- economy ---------------------------------------------------------------

function manageWorkers(state: GameState, workers: Unit[], home: { x: number; y: number }): void {
  const d = state.difficulty;
  const goldTarget = 4 + Math.ceil(d / 2);
  const woodTarget = 3 + Math.floor(d / 2);

  let onGold = 0;
  let onWood = 0;
  const idle: Unit[] = [];
  for (const w of workers) {
    if (w.order.kind === 'harvestGold') onGold++;
    else if (w.order.kind === 'harvestWood') onWood++;
    else if (w.order.kind === 'idle') idle.push(w);
  }
  for (const w of idle) {
    if (onGold < goldTarget) {
      const mine = nearestTileOfKind(state, home.x, home.y, Tile.GoldMine, 24);
      if (mine !== null) {
        issueOrder(state, w, { kind: 'harvestGold', tile: mine });
        onGold++;
        continue;
      }
    }
    if (onWood < woodTarget) {
      const forest = nearestTileOfKind(state, home.x, home.y, Tile.Forest, 24);
      if (forest !== null) {
        issueOrder(state, w, { kind: 'harvestWood', tile: forest });
        onWood++;
        continue;
      }
    }
    // Saturated: put extras on gold anyway.
    const mine = nearestTileOfKind(state, home.x, home.y, Tile.GoldMine, 30);
    if (mine !== null) issueOrder(state, w, { kind: 'harvestGold', tile: mine });
  }
}

// --- construction ----------------------------------------------------------

function manageConstruction(
  state: GameState,
  ai: AiState,
  myBuildings: Building[],
  workers: Unit[],
  home: { x: number; y: number },
): void {
  const player = playerOf(state, ai.faction);
  const underConstruction = myBuildings.some((b) => !b.constructed);
  if (underConstruction) {
    // Make sure an abandoned site gets a builder again.
    const site = myBuildings.find((b) => !b.constructed);
    if (site && !workers.some((w) => w.order.kind === 'build' && w.order.buildingId === site.id)) {
      const w = pickBuilder(workers);
      if (w) issueOrder(state, w, { kind: 'build', buildingId: site.id });
    }
    return; // one construction project at a time
  }

  const count = (t: BuildingType): number => myBuildings.filter((b) => b.type === t).length;
  const d = state.difficulty;

  const want = decideNextBuilding(state, player.supplyUsed, player.supplyCap, count, d);
  if (!want) return;

  const stats = BUILDING_STATS[want];
  if (player.gold < stats.goldCost || player.wood < stats.woodCost) return;
  const builder = pickBuilder(workers);
  if (!builder) return;
  const spot = findBuildSpot(state, want, home);
  if (!spot) return;
  placeBuilding(state, builder, want, spot.x, spot.y);
}

function decideNextBuilding(
  state: GameState,
  supplyUsed: number,
  supplyCap: number,
  count: (t: BuildingType) => number,
  difficulty: number,
): BuildingType | null {
  // Rebuild the hall first if it was destroyed.
  if (count(BuildingType.TownHall) === 0) return BuildingType.TownHall;
  // Stay ahead of supply demand.
  if (supplyCap < 50 && supplyUsed + 3 >= supplyCap) return BuildingType.Farm;
  if (count(BuildingType.Barracks) < 1) return BuildingType.Barracks;
  if (count(BuildingType.LumberMill) < 1) return BuildingType.LumberMill;
  if (count(BuildingType.Tower) < Math.max(1, difficulty - 1)) return BuildingType.Tower;
  if (count(BuildingType.Barracks) < (difficulty >= 3 ? 2 : 1)) return BuildingType.Barracks;
  void state;
  return null;
}

function pickBuilder(workers: Unit[]): Unit | null {
  return (
    workers.find((w) => w.order.kind === 'idle') ??
    workers.find((w) => w.order.kind === 'harvestWood') ??
    workers.find((w) => w.order.kind === 'harvestGold') ??
    null
  );
}

/** Ring-scan around the base for a legal placement with breathing room. */
function findBuildSpot(
  state: GameState,
  type: BuildingType,
  home: { x: number; y: number },
): { x: number; y: number } | null {
  const stats = BUILDING_STATS[type];
  const hx = Math.floor(home.x);
  const hy = Math.floor(home.y);
  let fallback: { x: number; y: number } | null = null;
  for (let r = 2; r <= 16; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = hx + dx;
        const ty = hy + dy;
        if (!canPlaceBuilding(state, type, tx, ty)) continue;
        if (roomy(state, tx, ty, stats.width, stats.height)) return { x: tx, y: ty };
        if (!fallback) fallback = { x: tx, y: ty };
      }
    }
  }
  return fallback;
}

/** Prefer spots whose 1-tile border is open so buildings do not wall units in. */
function roomy(state: GameState, tx: number, ty: number, w: number, h: number): boolean {
  for (let y = ty - 1; y <= ty + h; y++) {
    for (let x = tx - 1; x <= tx + w; x++) {
      if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return false;
      if (x >= tx && x < tx + w && y >= ty && y < ty + h) continue;
      if (state.blocked[idx(state.map, x, y)]) return false;
    }
  }
  return true;
}

// --- training --------------------------------------------------------------

function manageTraining(state: GameState, myBuildings: Building[], workers: Unit[]): void {
  const d = state.difficulty;
  const workerTarget = 8 + d;

  for (const b of myBuildings) {
    if (!b.constructed || b.trainQueue.length > 0) continue;
    if (b.type === BuildingType.TownHall && workers.length < workerTarget) {
      trainUnit(state, b, UnitType.Worker);
    } else if (b.type === BuildingType.Barracks) {
      const hasMill = myBuildings.some((x) => x.type === BuildingType.LumberMill && x.constructed);
      const roll = state.rng.next();
      let pick: UnitType = UnitType.Melee;
      if (hasMill && d >= 2 && roll > 0.75) pick = UnitType.Heavy;
      else if (hasMill && roll > 0.45) pick = UnitType.Ranged;
      if (!trainUnit(state, b, pick)) {
        // Cheaper fallback keeps production rolling.
        trainUnit(state, b, UnitType.Melee);
      }
    }
  }
}

// --- attack waves ----------------------------------------------------------

function manageWaves(state: GameState, ai: AiState, military: Unit[]): void {
  if (state.time < ai.nextWave) return;
  const d = state.difficulty;
  const waveSize = 2 + d + ai.waveNumber * 2;
  const reserve = Math.max(1, Math.floor(d / 2));
  const available = military.filter(
    (u) => u.order.kind === 'idle' && u.autoTargetId === null,
  );
  if (available.length < Math.min(waveSize, 3)) {
    // Not enough soldiers yet; check again soon.
    ai.nextWave = state.time + 20;
    return;
  }
  const target = pickWaveTarget(state, ai);
  if (!target) return;
  const attackers = available.slice(0, Math.max(available.length - reserve, 3));
  for (const u of attackers) {
    issueOrder(state, u, { kind: 'attackMove', x: target.x, y: target.y });
  }
  ai.waveNumber++;
  const cadence = Math.max(70, 170 - 18 * d);
  ai.nextWave = state.time + cadence;
}

function pickWaveTarget(state: GameState, ai: AiState): { x: number; y: number } | null {
  // March on the enemy's town hall, or any remaining enemy building.
  let target: Building | null = null;
  for (const b of state.buildings) {
    if (b.faction === ai.faction) continue;
    if (b.type === BuildingType.TownHall) {
      target = b;
      break;
    }
    target = target ?? b;
  }
  if (target) return buildingCenter(target);
  // No buildings visible: head for the opposing start location.
  const start = state.map.starts[0];
  return { x: start.x + 0.5, y: start.y + 0.5 };
}
