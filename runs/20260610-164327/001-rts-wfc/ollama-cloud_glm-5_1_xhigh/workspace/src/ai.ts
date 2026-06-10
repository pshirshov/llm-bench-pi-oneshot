// ─── AI Opponent ───
// Scripted-strategy AI that harvests, builds, trains, and attacks.

import {
  Faction, UnitType, BuildingType, UnitState, BuildingState, Unit, Building, TileType,
} from './types';
import {
  UNIT_STATS, BUILDING_STATS,
} from './constants';
import {
  issueTrainCommand, issueBuildCommand,
  canPlaceBuilding, findNearestResource, getSupply, distance, GameState,
} from './game';
import { PRNG } from './prng';

interface AIPlan {
  nextBuildOrder: BuildingType | null;
  nextTrainOrder: UnitType | null;
  attackWaveSize: number;
  attackInterval: number; // seconds between waves
  workersPerGold: number;
  workersPerWood: number;
  maxWorkers: number;
}

function getPlan(difficulty: number): AIPlan {
  return {
    nextBuildOrder: null,
    nextTrainOrder: null,
    attackWaveSize: 3 + difficulty * 2,
    attackInterval: Math.max(60, 240 - difficulty * 40), // 4min at diff 1, down to 40s at diff 5
    workersPerGold: 2 + Math.floor(difficulty / 2),
    workersPerWood: 1 + Math.floor(difficulty / 3),
    maxWorkers: 8 + difficulty * 2,
  };
}

export class AIController {
  private faction: Faction;
  private difficulty: number;
  private plan: AIPlan;
  private rng: PRNG;
  private lastAttackTime: number;
  private buildOrderIndex: number;
  private buildOrder: BuildingType[];
  private nextCheckTime: number;
  private harvestAssignments: Map<number, 'gold' | 'wood'>;

  constructor(faction: Faction, difficulty: number, seed: number) {
    this.faction = faction;
    this.difficulty = difficulty;
    this.plan = getPlan(difficulty);
    this.rng = new PRNG(seed);
    this.lastAttackTime = 0;
    this.buildOrderIndex = 0;
    this.nextCheckTime = 5;
    this.harvestAssignments = new Map();
    this.buildOrder = this.createBuildOrder();
  }

  private createBuildOrder(): BuildingType[] {
    // Standard build order: farm, barracks, farm, lumber mill, farm, guard tower, farm, guard tower
    return [
      BuildingType.Farm,
      BuildingType.Barracks,
      BuildingType.Farm,
      BuildingType.LumberMill,
      BuildingType.Farm,
      BuildingType.GuardTower,
      BuildingType.Farm,
      BuildingType.GuardTower,
      BuildingType.Farm,
    ];
  }

  update(state: GameState, _dt: number): void {
    const now = state.time;

    if (now < this.nextCheckTime) return;
    this.nextCheckTime = now + 1; // Check every second

    const myUnits = [...state.units.values()].filter(u => u.faction === this.faction && u.state !== UnitState.Dead);
    const myBuildings = [...state.buildings.values()].filter(b => b.faction === this.faction && b.state !== BuildingState.Destroyed);
    const workers = myUnits.filter(u => u.type === UnitType.Worker);
    const military = myUnits.filter(u => u.type !== UnitType.Worker);

    // 1. Assign idle workers to harvest
    this.assignWorkers(state, workers);

    // 2. Train workers if needed
    this.trainWorkers(state, workers);

    // 3. Build next building
    this.buildNext(state, myBuildings);

    // 4. Train military
    this.trainMilitary(state, military);

    // 5. Attack waves
    this.manageAttacks(state, military);

    // 6. Defend base
    this.defendBase(state, myUnits);
  }

  private assignWorkers(state: GameState, workers: Unit[]): void {
    const goldWorkers = workers.filter(w => this.harvestAssignments.get(w.id) === 'gold');
    const woodWorkers = workers.filter(w => this.harvestAssignments.get(w.id) === 'wood');
    const idleWorkers = workers.filter(w =>
      w.state === UnitState.Idle ||
      (w.carryingAmount === 0 && w.state !== UnitState.Harvesting && w.state !== UnitState.Returning)
    );

    const plan = this.plan;

    for (const worker of idleWorkers) {
      if (goldWorkers.length < plan.workersPerGold) {
        this.harvestAssignments.set(worker.id, 'gold');
        this.sendToHarvest(state, worker, 'gold');
        goldWorkers.push(worker);
      } else if (woodWorkers.length < plan.workersPerWood + plan.workersPerGold) {
        this.harvestAssignments.set(worker.id, 'wood');
        this.sendToHarvest(state, worker, 'wood');
        woodWorkers.push(worker);
      } else if (workers.length >= plan.maxWorkers) {
        // Already have enough workers, send to gold
        this.harvestAssignments.set(worker.id, 'gold');
        this.sendToHarvest(state, worker, 'gold');
      }
    }
  }

  private sendToHarvest(state: GameState, worker: Unit, resource: 'gold' | 'wood'): void {
    const tileType = resource === 'gold' ? 'gold_mine' : 'forest';
    const target = findNearestResource(state, { x: worker.x, y: worker.y }, tileType as TileType);
    if (target) {
      worker.targetPos = target;
      worker.path = [];
      worker.state = UnitState.Moving;
      worker.targetId = null;
    }
  }

  private trainWorkers(state: GameState, workers: Unit[]): void {
    const supply = getSupply(state, this.faction);
    if (workers.length >= this.plan.maxWorkers) return;
    if (supply.used >= supply.cap) return;

    const townHalls = [...state.buildings.values()].filter(
      b => b.faction === this.faction && b.type === BuildingType.TownHall && b.state === BuildingState.Complete
    );

    for (const hall of townHalls) {
      if (hall.trainingQueue.length < 1) {
        const stats = UNIT_STATS[UnitType.Worker];
        if (state.resources[this.faction].gold >= stats.goldCost) {
          issueTrainCommand(state, hall.id, UnitType.Worker);
        }
      }
    }
  }

  private buildNext(state: GameState, myBuildings: Building[]): void {
    if (this.buildOrderIndex >= this.buildOrder.length) {
      // After build order, keep building farms and towers
      const supply = getSupply(state, this.faction);
      if (supply.used >= supply.cap - 2) {
        this.tryBuild(state, BuildingType.Farm, myBuildings);
      }
      if (myBuildings.filter(b => b.type === BuildingType.GuardTower).length < 2 + this.difficulty) {
        this.tryBuild(state, BuildingType.GuardTower, myBuildings);
      }
      return;
    }

    const nextType = this.buildOrder[this.buildOrderIndex];

    // Check if we already have this building
    const existing = myBuildings.filter(b => b.type === nextType && b.state !== BuildingState.Destroyed).length;

    if (existing > 0 && nextType !== BuildingType.Farm) {
      this.buildOrderIndex++;
      return;
    }

    // Check prerequisites
    if (nextType === BuildingType.LumberMill) {
      const hasBarracks = myBuildings.some(b => b.type === BuildingType.Barracks && b.state === BuildingState.Complete);
      if (!hasBarracks) return;
    }

    // Check resources
    const stats = BUILDING_STATS[nextType];
    if (state.resources[this.faction].gold < stats.goldCost || state.resources[this.faction].wood < stats.woodCost) {
      return;
    }

    if (this.tryBuild(state, nextType, myBuildings)) {
      this.buildOrderIndex++;
    }
  }

  private tryBuild(state: GameState, type: BuildingType, myBuildings: Building[]): boolean {
    // Find an idle worker
    const workers = [...state.units.values()].filter(
      u => u.faction === this.faction && u.type === UnitType.Worker && u.state !== UnitState.Dead
    );
    if (workers.length === 0) return false;

    const worker = workers[0];

    // Find a valid position near the AI base
    const aiBuilding = myBuildings.find(b => b.type === BuildingType.TownHall);
    if (!aiBuilding) return false;

    const baseX = aiBuilding.tileX;
    const baseY = aiBuilding.tileY;

    // Search for a valid build location
    for (let r = 3; r < 15; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = baseX + dx;
          const ty = baseY + dy;
          if (canPlaceBuilding(state, type, tx, ty, this.faction)) {
            issueBuildCommand(state, worker.id, type, tx, ty);
            return true;
          }
        }
      }
    }

    return false;
  }

  private trainMilitary(state: GameState, _military: Unit[]): void {
    const supply = getSupply(state, this.faction);
    const barracks = [...state.buildings.values()].filter(
      b => b.faction === this.faction && b.type === BuildingType.Barracks && b.state === BuildingState.Complete
    );

    const hasLumberMill = [...state.buildings.values()].some(
      b => b.faction === this.faction && b.type === BuildingType.LumberMill && b.state === BuildingState.Complete
    );

    for (const barrack of barracks) {
      if (barrack.trainingQueue.length >= 2) continue;

      // Decide what to train
      let unitType: UnitType;
      const rng = this.rng.next();

      if (hasLumberMill) {
        if (rng < 0.3) unitType = UnitType.Infantry;
        else if (rng < 0.6) unitType = UnitType.Ranged;
        else unitType = UnitType.Heavy;
      } else {
        unitType = UnitType.Infantry;
      }

      const stats = UNIT_STATS[unitType];
      if (state.resources[this.faction].gold >= stats.goldCost &&
        state.resources[this.faction].wood >= stats.woodCost &&
        supply.used + stats.supplyCost <= supply.cap) {
        issueTrainCommand(state, barrack.id, unitType);
      }
    }

    // Also train from Town Hall if we need more workers
    const workers = [...state.units.values()].filter(
      u => u.faction === this.faction && u.type === UnitType.Worker && u.state !== UnitState.Dead
    );
    if (workers.length < this.plan.maxWorkers) {
      const townHalls = [...state.buildings.values()].filter(
        b => b.faction === this.faction && b.type === BuildingType.TownHall && b.state === BuildingState.Complete
      );
      for (const hall of townHalls) {
        if (hall.trainingQueue.length < 1) {
          const wStats = UNIT_STATS[UnitType.Worker];
          if (state.resources[this.faction].gold >= wStats.goldCost && supply.used < supply.cap) {
            issueTrainCommand(state, hall.id, UnitType.Worker);
          }
        }
      }
    }
  }

  private manageAttacks(state: GameState, military: Unit[]): void {
    const now = state.time;

    if (now - this.lastAttackTime < this.plan.attackInterval) return;

    // Only attack if we have enough military
    const idleMilitary = military.filter(u =>
      u.state === UnitState.Idle || u.state === UnitState.Moving
    );

    if (idleMilitary.length < this.plan.attackWaveSize) return;

    // Find player base location
    const playerBuilding = [...state.buildings.values()].find(
      b => b.faction !== this.faction && b.state !== BuildingState.Destroyed
    );

    if (!playerBuilding) return;

    // Send attack force
    const attackForce = idleMilitary.slice(0, this.plan.attackWaveSize);
    const targetX = playerBuilding.tileX;
    const targetY = playerBuilding.tileY;

    for (const unit of attackForce) {
      unit.targetPos = { x: targetX, y: targetY };
      unit.path = [];
      unit.state = UnitState.Moving;
      unit.targetId = null;
    }

    this.lastAttackTime = now;
  }

  private defendBase(state: GameState, myUnits: Unit[]): void {
    // Check if any enemy units are near our buildings
    const myBuildings = [...state.buildings.values()].filter(
      b => b.faction === this.faction && b.state !== BuildingState.Destroyed
    );

    for (const building of myBuildings) {
      const bStats = BUILDING_STATS[building.type];
      const cx = building.tileX + bStats.footprintW / 2;
      const cy = building.tileY + bStats.footprintH / 2;

      // Find nearby enemy units
      for (const unit of state.units.values()) {
        if (unit.faction !== this.faction || unit.state === UnitState.Dead) continue;
        const dist = distance(unit.x, unit.y, cx, cy);
        if (dist <= 10) {
          // Threat detected — pull idle military to defend
          const idleMilitary = myUnits.filter(u =>
            u.type !== UnitType.Worker && (u.state === UnitState.Idle || u.state === UnitState.Moving) && !u.targetId
          );

          for (const defender of idleMilitary) {
            defender.targetId = unit.id;
            defender.state = UnitState.Attacking;
          }
          break;
        }
      }
    }
  }
}