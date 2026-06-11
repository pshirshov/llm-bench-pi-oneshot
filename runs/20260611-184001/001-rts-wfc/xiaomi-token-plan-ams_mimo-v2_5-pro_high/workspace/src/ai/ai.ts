/**
 * AI opponent: scripted strategy with escalating attacks.
 */
import { Entity, Faction, GameState, TILE_SIZE, BuildingType, UnitType } from '../engine/types.js';
import { getStats } from '../entities/stats.js';
import { createEntity, canPlaceBuilding, canAfford, deductCost, hasPrerequisites } from '../entities/manager.js';
import { tileToPixel } from '../pathfinding/astar.js';
import { PRNG } from '../engine/prng.js';

interface AIBuildOrder {
  building: BuildingType;
  count: number;
}

const BUILD_ORDER: AIBuildOrder[] = [
  { building: 'farm', count: 1 },
  { building: 'barracks', count: 1 },
  { building: 'farm', count: 2 },
  { building: 'lumber_mill', count: 1 },
  { building: 'farm', count: 3 },
  { building: 'guard_tower', count: 1 },
  { building: 'farm', count: 4 },
  { building: 'guard_tower', count: 2 },
];

export class AIController {
  private faction: Faction;
  private difficulty: number;
  private rng: PRNG;
  private lastBuildCheck: number = 0;
  private lastTrainCheck: number = 0;
  private lastAttackCheck: number = 0;
  private attackWaveTimer: number = 0;
  private buildOrderIndex: number = 0;
  private workerAssignments = new Map<number, 'gold' | 'wood'>();

  constructor(faction: Faction, difficulty: number, seed: number) {
    this.faction = faction;
    this.difficulty = Math.max(1, Math.min(5, difficulty));
    this.rng = new PRNG(seed + difficulty * 1000);
  }

  update(state: GameState, dt: number): void {
    if (state.gameOver) return;

    this.lastBuildCheck += dt;
    this.lastTrainCheck += dt;
    this.lastAttackCheck += dt;
    this.attackWaveTimer += dt;

    // Assign idle workers
    this.assignWorkers(state);

    // Build structures
    if (this.lastBuildCheck >= 3000) {
      this.lastBuildCheck = 0;
      this.manageBuildings(state);
    }

    // Train units
    if (this.lastTrainCheck >= 2000) {
      this.lastTrainCheck = 0;
      this.trainUnits(state);
    }

    // Attack waves
    const attackInterval = Math.max(30000, 240000 - this.difficulty * 40000);
    if (this.attackWaveTimer >= attackInterval) {
      this.attackWaveTimer = 0;
      this.launchAttack(state);
    }

    // Defend base
    this.defendBase(state, dt);
  }

  private assignWorkers(state: GameState): void {
    const workers = state.entities.filter(
      e => e.faction === this.faction && e.type === 'worker' && e.state === 'idle'
    );

    let goldWorkers = workers.filter(w => this.workerAssignments.get(w.id) === 'gold').length;

    for (const w of workers) {
      const assigned = this.workerAssignments.get(w.id);
      if (assigned) {
        // Re-issue harvest command
        this.sendHarvest(w, assigned, state);
      } else {
        // Assign: prioritize gold if less than 5 on gold
        if (goldWorkers < 5) {
          this.workerAssignments.set(w.id, 'gold');
          this.sendHarvest(w, 'gold', state);
          goldWorkers++;
        } else {
          this.workerAssignments.set(w.id, 'wood');
          this.sendHarvest(w, 'wood', state);
        }
      }
    }
  }

  private sendHarvest(worker: Entity, resource: 'gold' | 'wood', state: GameState): void {
    const tx = Math.floor(worker.x / TILE_SIZE);
    const ty = Math.floor(worker.y / TILE_SIZE);
    const targetType = resource === 'gold' ? 'gold_mine' : 'forest';

    // Find nearest resource tile
    let bestDist = Infinity;
    let bestX = -1, bestY = -1;

    for (let y = 0; y < state.mapHeight; y++) {
      for (let x = 0; x < state.mapWidth; x++) {
        if (state.tiles[y][x].type !== targetType) continue;
        if (state.tiles[y][x].resource <= 0) continue;
        const dist = Math.abs(x - tx) + Math.abs(y - ty);
        if (dist < bestDist) {
          bestDist = dist;
          bestX = x;
          bestY = y;
        }
      }
    }

    if (bestX >= 0) {
      worker.harvestTileX = bestX;
      worker.harvestTileY = bestY;
      worker.carrying = null;
      worker.carryAmount = 0;
      worker.state = 'harvesting';
      const target = tileToPixel(bestX, bestY);
      worker.targetX = target.px;
      worker.targetY = target.py;
      worker.path = [];
      worker.pathIndex = 0;
    }
  }

  private manageBuildings(state: GameState): void {
    const townHalls = state.entities.filter(
      e => e.faction === this.faction && e.type === 'town_hall' && e.state !== 'dead'
    );
    if (townHalls.length === 0) return;

    const th = townHalls[0];
    const [gold] = state.resources[this.faction];

    // Check if we need more supply
    const supplyUsed = state.resources[this.faction][2];
    const supplyCap = state.resources[this.faction][3];

    if (supplyUsed >= supplyCap - 2 && canAfford('farm', this.faction, state)) {
      this.tryBuildNear('farm', th.tileX, th.tileY, state);
      return;
    }

    // Follow build order
    if (this.buildOrderIndex < BUILD_ORDER.length) {
      const order = BUILD_ORDER[this.buildOrderIndex];
      const existing = state.entities.filter(
        e => e.faction === this.faction && e.type === order.building && e.state !== 'dead'
      ).length;

      if (existing < order.count && canAfford(order.building, this.faction, state)) {
        if (hasPrerequisites(order.building, this.faction, state)) {
          if (this.tryBuildNear(order.building, th.tileX, th.tileY, state)) {
            this.buildOrderIndex++;
          }
        }
      } else {
        this.buildOrderIndex++;
      }
    }

    // Repair damaged buildings
    for (const e of state.entities) {
      if (e.faction !== this.faction || e.state === 'dead' || e.stats.isUnit) continue;
      if (e.hp < e.maxHp * 0.5 && gold >= 50) {
        // Find idle worker to repair
        const worker = state.entities.find(
          w => w.faction === this.faction && w.type === 'worker' && w.state === 'idle'
        );
        if (worker) {
          worker.state = 'repairing';
          worker.attackTarget = e.id;
          worker.targetX = e.x;
          worker.targetY = e.y;
        }
      }
    }
  }

  private tryBuildNear(type: BuildingType, nearX: number, nearY: number, state: GameState): boolean {
    const stats = getStats(type, this.faction);

    // Search in expanding radius
    for (let r = 3; r <= 12; r++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const angle = this.rng.next() * Math.PI * 2;
        const bx = nearX + Math.round(Math.cos(angle) * r);
        const by = nearY + Math.round(Math.sin(angle) * r);

        if (canPlaceBuilding(type, bx, by, state, this.faction)) {
          // Find idle worker
          const worker = state.entities.find(
            e => e.faction === this.faction && e.type === 'worker' && e.state === 'idle'
          );
          if (worker) {
            deductCost(type, this.faction, state);
            worker.buildingType = type;
            worker.buildProgress = 0;
            worker.state = 'building';
            worker.targetX = bx * TILE_SIZE + (stats.width * TILE_SIZE) / 2;
            worker.targetY = by * TILE_SIZE + (stats.height * TILE_SIZE) / 2;
            worker.tileX = bx;
            worker.tileY = by;
            // Place a "ghost" building
            const ghost = createEntity(type, this.faction, bx, by, state);
            ghost.hp = 1; // Under construction
            ghost.state = 'building';
            return true;
          }
        }
      }
    }
    return false;
  }

  private trainUnits(state: GameState): void {
    // Train workers from town halls
    const townHalls = state.entities.filter(
      e => e.faction === this.faction && e.type === 'town_hall' && e.state !== 'dead'
    );
    for (const th of townHalls) {
      const workerCount = state.entities.filter(
        e => e.faction === this.faction && e.type === 'worker' && e.state !== 'dead'
      ).length;
      if (workerCount < 8 && th.trainQueue.length < 2 && canAfford('worker', this.faction, state)) {
        deductCost('worker', this.faction, state);
        th.trainQueue.push({ type: 'worker', progress: 0 });
      }
    }

    // Train military from barracks
    const barracksList = state.entities.filter(
      e => e.faction === this.faction && e.type === 'barracks' && e.state !== 'dead'
    );
    for (const barracks of barracksList) {
      if (barracks.trainQueue.length >= 3) continue;

      // Choose unit type based on what we have
      const hasLumberMill = state.entities.some(
        e => e.faction === this.faction && e.type === 'lumber_mill' && e.state !== 'dead'
      );

      let unitType: UnitType;
      const r = this.rng.next();
      if (hasLumberMill && r < 0.3) {
        unitType = 'ranged';
      } else if (hasLumberMill && r < 0.5) {
        unitType = 'heavy';
      } else {
        unitType = 'melee';
      }

      if (canAfford(unitType, this.faction, state) && hasPrerequisites(unitType, this.faction, state)) {
        deductCost(unitType, this.faction, state);
        barracks.trainQueue.push({ type: unitType, progress: 0 });
      }
    }
  }

  private launchAttack(state: GameState): void {
    const military = state.entities.filter(
      e => e.faction === this.faction && !e.stats.isUnit === false &&
      (e.type === 'melee' || e.type === 'ranged' || e.type === 'heavy') &&
      e.state !== 'dead'
    );

    if (military.length < 3 + this.difficulty) return;

    // Find player's base
    const playerBuildings = state.entities.filter(
      e => e.faction !== this.faction && !e.stats.isUnit && e.state !== 'dead'
    );
    if (playerBuildings.length === 0) return;

    const target = playerBuildings[0];

    // Send wave: size based on difficulty
    const waveSize = Math.min(military.length, 3 + this.difficulty * 2);
    const wave = military.slice(0, waveSize);

    for (const unit of wave) {
      unit.attackTarget = null;
      unit.targetX = target.x + (this.rng.next() - 0.5) * 100;
      unit.targetY = target.y + (this.rng.next() - 0.5) * 100;
      unit.state = 'moving';
      unit.path = [];
      unit.pathIndex = 0;
    }
  }

  private defendBase(state: GameState, _dt: number): void {
    // Check for enemy units near our base
    const ourBuildings = state.entities.filter(
      e => e.faction === this.faction && !e.stats.isUnit && e.state !== 'dead'
    );
    if (ourBuildings.length === 0) return;

    const baseCenter = ourBuildings.reduce(
      (acc, b) => ({ x: acc.x + b.x, y: acc.y + b.y }),
      { x: 0, y: 0 }
    );
    baseCenter.x /= ourBuildings.length;
    baseCenter.y /= ourBuildings.length;

    // Find nearby enemies
    const nearbyEnemies = state.entities.filter(
      e => e.faction !== this.faction && e.state !== 'dead' &&
      Math.hypot(e.x - baseCenter.x, e.y - baseCenter.y) < 300
    );

    if (nearbyEnemies.length > 0) {
      // Pull idle military to defend
      const idleMilitary = state.entities.filter(
        e => e.faction === this.faction && !e.stats.isUnit &&
        (e.type === 'melee' || e.type === 'ranged' || e.type === 'heavy') &&
        e.state === 'idle'
      );

      const target = nearbyEnemies[0];
      for (const unit of idleMilitary) {
        unit.attackTarget = target.id;
        unit.state = 'attacking';
        unit.targetX = target.x;
        unit.targetY = target.y;
      }
    }
  }
}
