import { BUILDING_STATS, FACTIONS, UNIT_STATS, displayBuildingName, displayUnitName, isLandTile, tileBlocksMovement } from './data';
import { canAfford, canReserveSupply, calculateSupply, computeDamage, spend } from './mechanics';
import { findNearestPassable, findPath, gridFromMap, indexOf, type Grid } from './pathfinding';
import { SeededRandom, mixSeed } from './random';
import type {
  BuildingType,
  Corpse,
  Entity,
  FactionId,
  GameMap,
  GameStatus,
  PlayerState,
  Point,
  Projectile,
  ResourceKind,
  SideId,
  SupplyState,
  TileType,
  UnitOrder,
  UnitType,
} from './types';
import { generateLevelMap } from './wfc';

const HARVEST_AMOUNT = 10;
const HARVEST_SECONDS = 2.2;
const BUILD_RATE = 1;
const REPAIR_HP_PER_SECOND = 18;
const REPAIR_WOOD_PER_HP = 0.08;
const PROJECTILE_SPEED = 10;
const CORPSE_FADE_SECONDS = 5;
const AI_SIDE: SideId = 1;
const PLAYER_SIDE: SideId = 0;

type CommandResult = { ok: true } | { ok: false; reason: string };

interface AiState {
  base: Point;
  difficulty: number;
  economyTimer: number;
  trainingTimer: number;
  defenseTimer: number;
  waveTimer: number;
  firstWaveSent: boolean;
  desiredWorkers: number;
  nextTowerIndex: number;
}

interface BuildingSnapshot {
  owner: SideId;
  faction: FactionId;
  type: BuildingType;
  x: number;
  y: number;
  width: number;
  height: number;
}

class SpatialIndex {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, Entity[]>();

  public constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  public rebuild(entities: Iterable<Entity>): void {
    this.buckets.clear();
    for (const entity of entities) {
      if (entity.hp <= 0) {
        continue;
      }
      const center = entityCenter(entity);
      const key = this.key(Math.floor(center.x / this.cellSize), Math.floor(center.y / this.cellSize));
      const bucket = this.buckets.get(key);
      if (bucket === undefined) {
        this.buckets.set(key, [entity]);
      } else {
        bucket.push(entity);
      }
    }
  }

  public query(center: Point, radius: number): Entity[] {
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minY = Math.floor((center.y - radius) / this.cellSize);
    const maxY = Math.floor((center.y + radius) / this.cellSize);
    const result: Entity[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const bucket = this.buckets.get(this.key(x, y));
        if (bucket !== undefined) {
          result.push(...bucket);
        }
      }
    }
    return result;
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }
}

export interface NewGameOptions {
  campaignSeed: number;
  level: number;
  playerFaction: FactionId;
}

export class GameSimulation {
  public readonly map: GameMap;
  public readonly players: [PlayerState, PlayerState];
  public readonly campaignSeed: number;
  public readonly level: number;
  public readonly rng: SeededRandom;
  public readonly entities = new Map<number, Entity>();
  public readonly projectiles: Projectile[] = [];
  public readonly corpses: Corpse[] = [];
  public readonly fog: [Uint8Array, Uint8Array];
  public readonly lastSeenBuildings: [Map<number, BuildingSnapshot>, Map<number, BuildingSnapshot>];
  public elapsed = 0;
  public status: GameStatus = 'playing';
  public message = '';

  private readonly spatial = new SpatialIndex(4);
  private readonly ai: AiState;
  private nextEntityId = 1;
  private nextProjectileId = 1;

  public constructor(options: NewGameOptions) {
    this.campaignSeed = options.campaignSeed >>> 0;
    this.level = options.level;
    this.map = generateLevelMap(this.campaignSeed, options.level);
    this.rng = new SeededRandom(mixSeed(this.campaignSeed, 77_000 + options.level));
    const aiFaction: FactionId = options.playerFaction === 'humans' ? 'orcs' : 'humans';
    const difficulty = options.level;
    this.players = [
      {
        side: PLAYER_SIDE,
        faction: options.playerFaction,
        resources: { gold: 700, wood: 420 },
        aiHarvestBonus: 1,
      },
      {
        side: AI_SIDE,
        faction: aiFaction,
        resources: { gold: 760 + difficulty * 150, wood: 500 + difficulty * 120 },
        aiHarvestBonus: 1 + difficulty * 0.1,
      },
    ];
    this.fog = [new Uint8Array(this.map.width * this.map.height), new Uint8Array(this.map.width * this.map.height)];
    this.lastSeenBuildings = [new Map<number, BuildingSnapshot>(), new Map<number, BuildingSnapshot>()];
    const aiStart = this.map.starts[1];
    this.ai = {
      base: { x: aiStart.x, y: aiStart.y },
      difficulty,
      economyTimer: 0,
      trainingTimer: 0,
      defenseTimer: 0,
      waveTimer: 230 - difficulty * 18,
      firstWaveSent: false,
      desiredWorkers: 8 + difficulty * 2,
      nextTowerIndex: 0,
    };
    this.placeStartingBase(PLAYER_SIDE, this.map.starts[0]);
    this.placeStartingBase(AI_SIDE, this.map.starts[1]);
    this.spatial.rebuild(this.entities.values());
    this.updateFog();
  }

  public update(dt: number): void {
    if (this.status !== 'playing') {
      return;
    }
    this.elapsed += dt;
    this.aiUpdate(dt);
    this.spatial.rebuild(this.entities.values());
    this.updateTraining(dt);
    this.updateOrders(dt);
    this.updateAttacks(dt);
    this.updateProjectiles(dt);
    this.updateCorpses(dt);
    this.removeDeadEntities();
    this.updateFog();
    this.updateWinLoss();
  }

  public getSupply(side: SideId): SupplyState {
    return calculateSupply(this.players[side], this.entities.values());
  }

  public entitiesForSide(side: SideId): Entity[] {
    return [...this.entities.values()].filter((entity) => entity.owner === side && entity.hp > 0);
  }

  public buildingsForSide(side: SideId): Entity[] {
    return this.entitiesForSide(side).filter((entity) => entity.kind === 'building');
  }

  public unitsForSide(side: SideId): Entity[] {
    return this.entitiesForSide(side).filter((entity) => entity.kind === 'unit');
  }

  public visibleEnemyEntities(side: SideId): Entity[] {
    return [...this.entities.values()].filter((entity) => entity.owner !== side && this.isEntityVisibleToSide(entity, side));
  }

  public entityAtWorld(point: Point, sidePerspective: SideId): Entity | null {
    const candidates = [...this.entities.values()].filter((entity) => {
      if (entity.hp <= 0) {
        return false;
      }
      if (entity.owner !== sidePerspective && !this.isEntityVisibleToSide(entity, sidePerspective)) {
        return false;
      }
      if (entity.kind === 'building' && entity.building !== undefined) {
        return point.x >= entity.x && point.y >= entity.y && point.x < entity.x + entity.building.footprint.width && point.y < entity.y + entity.building.footprint.height;
      }
      return distance(point, entityCenter(entity)) <= entity.radius + 0.35;
    });
    candidates.sort((a, b) => (a.kind === 'unit' ? -1 : 1) - (b.kind === 'unit' ? -1 : 1));
    return candidates[0] ?? null;
  }

  public entitiesInWorldRect(rect: { x1: number; y1: number; x2: number; y2: number }, side: SideId): Entity[] {
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);
    return this.entitiesForSide(side).filter((entity) => {
      const center = entityCenter(entity);
      return center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
    });
  }

  public canPlaceBuilding(side: SideId, buildingType: BuildingType, tileX: number, tileY: number): boolean {
    const stats = BUILDING_STATS[buildingType];
    for (let y = tileY; y < tileY + stats.footprint.height; y += 1) {
      for (let x = tileX; x < tileX + stats.footprint.width; x += 1) {
        if (!this.inBounds(x, y) || !isLandTile(this.map.tiles[indexOf(x, y, this.map.width)]!)) {
          return false;
        }
      }
    }
    for (const entity of this.entities.values()) {
      if (entity.hp <= 0 || entity.kind !== 'building' || entity.building === undefined) {
        continue;
      }
      if (rectsOverlap(tileX, tileY, stats.footprint.width, stats.footprint.height, entity.x, entity.y, entity.building.footprint.width, entity.building.footprint.height)) {
        return false;
      }
    }
    return true;
  }

  public placeBuilding(workerId: number, buildingType: BuildingType, tileX: number, tileY: number): CommandResult {
    const worker = this.entities.get(workerId);
    if (worker === undefined || worker.kind !== 'unit' || worker.unit === undefined || worker.type !== 'worker') {
      return { ok: false, reason: 'Select a worker to construct buildings.' };
    }
    const player = this.players[worker.owner];
    const stats = BUILDING_STATS[buildingType];
    if (!canAfford(player.resources, stats.goldCost, stats.woodCost)) {
      return { ok: false, reason: `Need ${stats.goldCost} gold and ${stats.woodCost} wood.` };
    }
    if (!this.canPlaceBuilding(worker.owner, buildingType, tileX, tileY)) {
      return { ok: false, reason: 'That building cannot be placed there.' };
    }
    spend(player.resources, stats.goldCost, stats.woodCost);
    const building = this.spawnBuilding(worker.owner, buildingType, tileX, tileY, false);
    worker.unit.order = { kind: 'build', buildingId: building.id };
    worker.unit.path = [];
    worker.unit.workProgress = 0;
    return { ok: true };
  }

  public queueTraining(buildingId: number, unitType: UnitType): CommandResult {
    const building = this.entities.get(buildingId);
    if (building === undefined || building.kind !== 'building' || building.building === undefined) {
      return { ok: false, reason: 'Select a completed training building.' };
    }
    if (!building.completed) {
      return { ok: false, reason: 'Construction must finish first.' };
    }
    const buildingStats = BUILDING_STATS[building.type as BuildingType];
    if (!buildingStats.trains.includes(unitType)) {
      return { ok: false, reason: `${displayBuildingName(building.faction, buildingStats.type)} cannot train ${displayUnitName(building.faction, unitType)}.` };
    }
    if ((unitType === 'ranged' || unitType === 'heavy') && !this.hasCompletedBuilding(building.owner, 'lumberMill')) {
      return { ok: false, reason: 'Requires a Lumber Mill / War Mill.' };
    }
    const unitStats = UNIT_STATS[unitType];
    const player = this.players[building.owner];
    if (!canReserveSupply(player, this.entities.values(), unitType)) {
      return { ok: false, reason: 'Supply cap reached. Build more Farms.' };
    }
    if (!canAfford(player.resources, unitStats.goldCost, unitStats.woodCost)) {
      return { ok: false, reason: `Need ${unitStats.goldCost} gold and ${unitStats.woodCost} wood.` };
    }
    spend(player.resources, unitStats.goldCost, unitStats.woodCost);
    building.building.trainQueue.push({ unitType, remaining: unitStats.trainingTime, total: unitStats.trainingTime });
    return { ok: true };
  }

  public issueMove(entityIds: readonly number[], target: Point, attackMove: boolean): void {
    const selectedUnits = this.unitsFromIds(entityIds);
    const formation = formationOffsets(selectedUnits.length);
    selectedUnits.forEach((entity, index) => {
      if (entity.unit === undefined) {
        return;
      }
      const offset = formation[index] ?? { x: 0, y: 0 };
      entity.unit.formationOffset = offset;
      const destination = { x: target.x + offset.x, y: target.y + offset.y };
      entity.unit.order = { kind: 'move', target: destination, attackMove };
      entity.unit.path = [];
      entity.unit.pathIndex = 0;
    });
  }

  public issueAttack(entityIds: readonly number[], targetId: number): void {
    for (const entity of this.unitsFromIds(entityIds)) {
      if (entity.unit === undefined) {
        continue;
      }
      entity.unit.order = { kind: 'attack', targetId, attackMove: false };
      entity.unit.path = [];
    }
  }

  public issueHarvest(entityIds: readonly number[], resource: ResourceKind, target: Point): void {
    for (const entity of this.unitsFromIds(entityIds).filter((unit) => unit.type === 'worker')) {
      if (entity.unit === undefined) {
        continue;
      }
      entity.unit.order = { kind: 'harvest', resource, target, returnAfterDropoff: true };
      entity.unit.path = [];
      entity.unit.workProgress = 0;
    }
  }

  public issueRepair(entityIds: readonly number[], targetId: number): void {
    for (const entity of this.unitsFromIds(entityIds).filter((unit) => unit.type === 'worker')) {
      if (entity.unit === undefined) {
        continue;
      }
      entity.unit.order = { kind: 'repair', targetId };
      entity.unit.path = [];
      entity.unit.workProgress = 0;
    }
  }

  public issueStop(entityIds: readonly number[]): void {
    for (const entity of this.unitsFromIds(entityIds)) {
      if (entity.unit === undefined) {
        continue;
      }
      entity.unit.order = { kind: 'idle' };
      entity.unit.path = [];
    }
  }

  public setTile(tileX: number, tileY: number, tile: TileType): void {
    if (!this.inBounds(tileX, tileY)) {
      throw new Error(`tile ${tileX},${tileY} outside map`);
    }
    const index = indexOf(tileX, tileY, this.map.width);
    this.map.tiles[index] = tile;
    this.map.wood[index] = tile === 'forest' ? Math.max(this.map.wood[index]!, 90) : 0;
    this.map.gold[index] = tile === 'gold' ? Math.max(this.map.gold[index]!, 2600) : 0;
  }

  private updateTraining(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.hp <= 0 || entity.kind !== 'building' || entity.building === undefined || !entity.completed) {
        continue;
      }
      const first = entity.building.trainQueue[0];
      if (first === undefined) {
        continue;
      }
      first.remaining -= dt;
      if (first.remaining <= 0) {
        entity.building.trainQueue.shift();
        const spawn = this.findSpawnPoint(entity);
        this.spawnUnit(entity.owner, first.unitType, spawn.x + 0.5, spawn.y + 0.5);
      }
    }
  }

  private updateOrders(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.hp <= 0 || entity.kind !== 'unit' || entity.unit === undefined) {
        continue;
      }
      if (entity.cooldownRemaining > 0) {
        entity.cooldownRemaining = Math.max(0, entity.cooldownRemaining - dt);
      }
      const acquired = this.maybeAutoAcquire(entity);
      if (acquired) {
        continue;
      }
      switch (entity.unit.order.kind) {
        case 'idle':
          break;
        case 'move':
          this.updateMoveOrder(entity, dt, entity.unit.order);
          break;
        case 'attack':
          this.updateAttackOrder(entity, dt, entity.unit.order);
          break;
        case 'harvest':
          this.updateHarvestOrder(entity, dt, entity.unit.order);
          break;
        case 'returnResources':
          this.updateReturnResourcesOrder(entity, dt, entity.unit.order);
          break;
        case 'build':
          this.updateBuildOrder(entity, dt, entity.unit.order);
          break;
        case 'repair':
          this.updateRepairOrder(entity, dt, entity.unit.order);
          break;
      }
    }
  }

  private updateAttacks(dt: number): void {
    for (const entity of this.entities.values()) {
      if (entity.hp <= 0) {
        continue;
      }
      if (entity.kind === 'building' && entity.cooldownRemaining > 0) {
        entity.cooldownRemaining = Math.max(0, entity.cooldownRemaining - dt);
      }
      if (entity.attackDamage <= 0 || !entity.completed) {
        continue;
      }
      if (entity.kind === 'building') {
        const target = this.findClosestEnemy(entity, entity.attackRange);
        if (target !== null) {
          this.tryPerformAttack(entity, target);
        }
      }
    }
  }

  private updateMoveOrder(entity: Entity, dt: number, order: Extract<UnitOrder, { kind: 'move' }>): void {
    if (order.attackMove) {
      const target = this.findClosestEnemy(entity, entity.sight);
      if (target !== null && entity.unit !== undefined) {
        entity.unit.order = { kind: 'attack', targetId: target.id, attackMove: true };
        entity.unit.path = [];
        return;
      }
    }
    this.moveToward(entity, order.target, dt, 0.2);
  }

  private updateAttackOrder(entity: Entity, dt: number, order: Extract<UnitOrder, { kind: 'attack' }>): void {
    const target = this.entities.get(order.targetId);
    if (target === undefined || target.hp <= 0 || target.owner === entity.owner) {
      if (entity.unit !== undefined) {
        entity.unit.order = { kind: 'idle' };
      }
      return;
    }
    if (this.inAttackRange(entity, target)) {
      this.tryPerformAttack(entity, target);
      return;
    }
    const center = entityCenter(target);
    this.moveToward(entity, center, dt, Math.max(0.9, entity.attackRange * 0.75));
  }

  private updateHarvestOrder(entity: Entity, dt: number, order: Extract<UnitOrder, { kind: 'harvest' }>): void {
    if (entity.unit === undefined) {
      return;
    }
    const tileX = Math.floor(order.target.x);
    const tileY = Math.floor(order.target.y);
    if (!this.inBounds(tileX, tileY)) {
      entity.unit.order = { kind: 'idle' };
      return;
    }
    const targetIndex = indexOf(tileX, tileY, this.map.width);
    const tile = this.map.tiles[targetIndex]!;
    if ((order.resource === 'gold' && (tile !== 'gold' || this.map.gold[targetIndex]! <= 0)) || (order.resource === 'wood' && (tile !== 'forest' || this.map.wood[targetIndex]! <= 0))) {
      const replacement = this.findNearestResource(order.resource, entityCenter(entity), 12);
      if (replacement === null) {
        entity.unit.order = { kind: 'idle' };
        return;
      }
      entity.unit.order = { kind: 'harvest', resource: order.resource, target: replacement, returnAfterDropoff: true };
      entity.unit.path = [];
      return;
    }
    const targetCenter = { x: tileX + 0.5, y: tileY + 0.5 };
    if (distance(entityCenter(entity), targetCenter) > 1.25) {
      this.moveToward(entity, targetCenter, dt, 1.05);
      return;
    }
    entity.unit.workProgress += dt;
    if (entity.unit.workProgress < HARVEST_SECONDS) {
      return;
    }
    entity.unit.workProgress = 0;
    const available = order.resource === 'gold' ? this.map.gold[targetIndex]! : this.map.wood[targetIndex]!;
    const amount = Math.min(HARVEST_AMOUNT, available);
    if (amount <= 0) {
      return;
    }
    if (order.resource === 'gold') {
      this.map.gold[targetIndex] = this.map.gold[targetIndex]! - amount;
      if (this.map.gold[targetIndex]! <= 0) {
        this.setTile(tileX, tileY, 'dirt');
      }
    } else {
      this.map.wood[targetIndex] = this.map.wood[targetIndex]! - amount;
      if (this.map.wood[targetIndex]! <= 0) {
        this.setTile(tileX, tileY, 'grass');
      }
    }
    entity.unit.carried = { kind: order.resource, amount };
    entity.unit.order = { kind: 'returnResources', resource: order.resource, harvestTarget: { x: tileX, y: tileY } };
    entity.unit.path = [];
  }

  private updateReturnResourcesOrder(entity: Entity, dt: number, order: Extract<UnitOrder, { kind: 'returnResources' }>): void {
    if (entity.unit === undefined || entity.unit.carried === null) {
      return;
    }
    const dropoff = this.findNearestDropoff(entity.owner, order.resource, entityCenter(entity));
    if (dropoff === null) {
      entity.unit.order = { kind: 'idle' };
      return;
    }
    if (distanceToEntity(entityCenter(entity), dropoff) > 1.2) {
      this.moveToward(entity, entityCenter(dropoff), dt, 1.05);
      return;
    }
    const carried = entity.unit.carried;
    const multiplier = this.players[entity.owner].aiHarvestBonus;
    const delivered = Math.floor(carried.amount * multiplier);
    if (carried.kind === 'gold') {
      this.players[entity.owner].resources.gold += delivered;
    } else {
      this.players[entity.owner].resources.wood += delivered;
    }
    entity.unit.carried = null;
    entity.unit.order = { kind: 'harvest', resource: order.resource, target: order.harvestTarget, returnAfterDropoff: true };
    entity.unit.path = [];
  }

  private updateBuildOrder(entity: Entity, dt: number, order: Extract<UnitOrder, { kind: 'build' }>): void {
    if (entity.unit === undefined) {
      return;
    }
    const building = this.entities.get(order.buildingId);
    if (building === undefined || building.hp <= 0 || building.kind !== 'building') {
      entity.unit.order = { kind: 'idle' };
      return;
    }
    if (building.completed) {
      entity.unit.order = { kind: 'idle' };
      return;
    }
    if (distanceToEntity(entityCenter(entity), building) > 1.15) {
      this.moveToward(entity, entityCenter(building), dt, 1.0);
      return;
    }
    building.buildProgress += dt * BUILD_RATE;
    building.hp = Math.min(building.maxHp, Math.max(1, Math.floor((building.buildProgress / building.buildTime) * building.maxHp)));
    if (building.buildProgress >= building.buildTime) {
      building.completed = true;
      building.hp = building.maxHp;
      entity.unit.order = { kind: 'idle' };
    }
  }

  private updateRepairOrder(entity: Entity, dt: number, order: Extract<UnitOrder, { kind: 'repair' }>): void {
    if (entity.unit === undefined) {
      return;
    }
    const target = this.entities.get(order.targetId);
    if (target === undefined || target.hp <= 0 || target.owner !== entity.owner || target.hp >= target.maxHp) {
      entity.unit.order = { kind: 'idle' };
      return;
    }
    if (distanceToEntity(entityCenter(entity), target) > 1.1) {
      this.moveToward(entity, entityCenter(target), dt, 1.0);
      return;
    }
    const player = this.players[entity.owner];
    const desiredHp = REPAIR_HP_PER_SECOND * dt;
    const affordableHp = player.resources.wood / REPAIR_WOOD_PER_HP;
    const hp = Math.min(desiredHp, affordableHp, target.maxHp - target.hp);
    if (hp <= 0) {
      entity.unit.order = { kind: 'idle' };
      return;
    }
    player.resources.wood -= Math.ceil(hp * REPAIR_WOOD_PER_HP);
    target.hp = Math.min(target.maxHp, target.hp + hp);
  }

  private moveToward(entity: Entity, target: Point, dt: number, stopDistance: number): boolean {
    if (entity.unit === undefined) {
      return true;
    }
    const current = entityCenter(entity);
    if (distance(current, target) <= stopDistance) {
      entity.unit.path = [];
      entity.unit.pathIndex = 0;
      if (entity.unit.order.kind === 'move') {
        entity.unit.order = { kind: 'idle' };
      }
      return true;
    }
    if (entity.unit.path.length === 0 || entity.unit.pathIndex >= entity.unit.path.length) {
      const grid = this.pathGrid();
      const passable = findNearestPassable(grid, target, 8);
      if (passable === null) {
        entity.unit.order = { kind: 'idle' };
        return true;
      }
      const start = findNearestPassable(grid, current, 2);
      if (start === null) {
        entity.unit.order = { kind: 'idle' };
        return true;
      }
      entity.unit.path = findPath(grid, start, passable);
      entity.unit.pathIndex = entity.unit.path.length > 1 ? 1 : 0;
      if (entity.unit.path.length === 0) {
        entity.unit.order = { kind: 'idle' };
        return true;
      }
    }
    const waypoint = entity.unit.path[entity.unit.pathIndex];
    if (waypoint === undefined) {
      entity.unit.path = [];
      return false;
    }
    const desired = { x: waypoint.x + 0.5, y: waypoint.y + 0.5 };
    if (distance(current, desired) < 0.12) {
      entity.unit.pathIndex += 1;
      return false;
    }
    const steer = normalized({ x: desired.x - current.x, y: desired.y - current.y });
    const separation = this.separationVector(entity);
    const vx = steer.x + separation.x;
    const vy = steer.y + separation.y;
    const velocity = normalized({ x: vx, y: vy });
    const step = entity.unit.speed * dt;
    const next = { x: entity.x + velocity.x * step, y: entity.y + velocity.y * step };
    if (this.canUnitOccupy(next.x, next.y)) {
      entity.x = next.x;
      entity.y = next.y;
      entity.unit.stuckTime = 0;
    } else {
      entity.unit.path = [];
      entity.unit.stuckTime += dt;
      if (entity.unit.stuckTime > 1.2) {
        entity.unit.order = { kind: 'idle' };
      }
    }
    return false;
  }

  private separationVector(entity: Entity): Point {
    const center = entityCenter(entity);
    let x = 0;
    let y = 0;
    for (const other of this.spatial.query(center, 1.1)) {
      if (other.id === entity.id || other.kind !== 'unit' || other.hp <= 0) {
        continue;
      }
      const otherCenter = entityCenter(other);
      const dx = center.x - otherCenter.x;
      const dy = center.y - otherCenter.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.0001 && d2 < 0.7) {
        const strength = (0.7 - d2) / 0.7;
        x += (dx / Math.sqrt(d2)) * strength * 0.75;
        y += (dy / Math.sqrt(d2)) * strength * 0.75;
      }
    }
    return { x, y };
  }

  private canUnitOccupy(x: number, y: number): boolean {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    if (!this.inBounds(tileX, tileY)) {
      return false;
    }
    if (tileBlocksMovement(this.map.tiles[indexOf(tileX, tileY, this.map.width)]!)) {
      return false;
    }
    for (const entity of this.entities.values()) {
      if (entity.kind !== 'building' || entity.building === undefined || entity.hp <= 0) {
        continue;
      }
      if (x >= entity.x - 0.05 && y >= entity.y - 0.05 && x <= entity.x + entity.building.footprint.width + 0.05 && y <= entity.y + entity.building.footprint.height + 0.05) {
        return false;
      }
    }
    return true;
  }

  private tryPerformAttack(attacker: Entity, target: Entity): void {
    if (attacker.cooldownRemaining > 0 || !this.inAttackRange(attacker, target) || attacker.attackDamage <= 0) {
      return;
    }
    attacker.cooldownRemaining = attacker.attackCooldown;
    if (attacker.projectileAttack) {
      const from = entityCenter(attacker);
      this.projectiles.push({
        id: this.nextProjectileId,
        owner: attacker.owner,
        source: from,
        x: from.x,
        y: from.y,
        targetId: target.id,
        damage: attacker.attackDamage,
        speed: PROJECTILE_SPEED,
        color: FACTIONS[attacker.faction].accent,
      });
      this.nextProjectileId += 1;
    } else {
      this.applyDamage(target, attacker.attackDamage);
    }
  }

  private applyDamage(target: Entity, attackDamage: number): void {
    target.hp -= computeDamage(attackDamage, target.armor);
    if (target.hp <= 0) {
      target.hp = 0;
      this.corpses.push({
        x: entityCenter(target).x,
        y: entityCenter(target).y,
        radius: target.radius,
        color: FACTIONS[target.faction].dark,
        remaining: CORPSE_FADE_SECONDS,
        total: CORPSE_FADE_SECONDS,
      });
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i]!;
      const target = this.entities.get(projectile.targetId);
      if (target === undefined || target.hp <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const targetCenter = entityCenter(target);
      const dx = targetCenter.x - projectile.x;
      const dy = targetCenter.y - projectile.y;
      const d = Math.hypot(dx, dy);
      const step = projectile.speed * dt;
      if (d <= step || d <= 0.05) {
        this.applyDamage(target, projectile.damage);
        this.projectiles.splice(i, 1);
      } else {
        projectile.x += (dx / d) * step;
        projectile.y += (dy / d) * step;
      }
    }
  }

  private updateCorpses(dt: number): void {
    for (let i = this.corpses.length - 1; i >= 0; i -= 1) {
      const corpse = this.corpses[i]!;
      corpse.remaining -= dt;
      if (corpse.remaining <= 0) {
        this.corpses.splice(i, 1);
      }
    }
  }

  private removeDeadEntities(): void {
    for (const [id, entity] of this.entities) {
      if (entity.hp > 0) {
        continue;
      }
      this.entities.delete(id);
      for (const other of this.entities.values()) {
        if (other.kind === 'unit' && other.unit !== undefined) {
          const order = other.unit.order;
          if ((order.kind === 'attack' || order.kind === 'repair') && order.targetId === id) {
            other.unit.order = { kind: 'idle' };
          }
          if (order.kind === 'build' && order.buildingId === id) {
            other.unit.order = { kind: 'idle' };
          }
        }
      }
    }
  }

  private maybeAutoAcquire(entity: Entity): boolean {
    if (entity.kind !== 'unit' || entity.unit === undefined || entity.attackDamage <= 0) {
      return false;
    }
    const order = entity.unit.order;
    if (order.kind !== 'idle' && !(order.kind === 'move' && order.attackMove)) {
      return false;
    }
    const target = this.findClosestEnemy(entity, entity.sight);
    if (target === null) {
      return false;
    }
    entity.unit.order = { kind: 'attack', targetId: target.id, attackMove: order.kind === 'move' && order.attackMove };
    entity.unit.path = [];
    return true;
  }

  private findClosestEnemy(source: Entity, radius: number): Entity | null {
    const center = entityCenter(source);
    let best: Entity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of this.spatial.query(center, radius + 3)) {
      if (candidate.owner === source.owner || candidate.hp <= 0 || !candidate.completed) {
        continue;
      }
      const d = distanceToEntity(center, candidate);
      if (d <= radius && d < bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
    return best;
  }

  private inAttackRange(attacker: Entity, target: Entity): boolean {
    return distanceToEntity(entityCenter(attacker), target) <= attacker.attackRange + attacker.radius;
  }

  private updateFog(): void {
    for (let side: SideId = 0; side <= 1; side = (side + 1) as SideId) {
      const fog = this.fog[side];
      for (let i = 0; i < fog.length; i += 1) {
        if (fog[i] === 2) {
          fog[i] = 1;
        }
      }
      for (const entity of this.entities.values()) {
        if (entity.owner !== side || entity.hp <= 0 || !entity.completed) {
          continue;
        }
        const center = entityCenter(entity);
        this.revealCircle(fog, center, entity.sight);
      }
      for (let i = 0; i < fog.length; i += 1) {
        if (fog[i] === 2) {
          this.lastSeenBuildings[side].delete(i);
        }
      }
      for (const entity of this.entities.values()) {
        if (entity.kind !== 'building' || entity.building === undefined || entity.hp <= 0 || !this.isEntityVisibleToSide(entity, side)) {
          continue;
        }
        const snapshot: BuildingSnapshot = {
          owner: entity.owner,
          faction: entity.faction,
          type: entity.type as BuildingType,
          x: entity.x,
          y: entity.y,
          width: entity.building.footprint.width,
          height: entity.building.footprint.height,
        };
        const minX = Math.floor(entity.x);
        const minY = Math.floor(entity.y);
        for (let y = minY; y < minY + snapshot.height; y += 1) {
          for (let x = minX; x < minX + snapshot.width; x += 1) {
            if (this.inBounds(x, y)) {
              this.lastSeenBuildings[side].set(indexOf(x, y, this.map.width), snapshot);
            }
          }
        }
      }
    }
  }

  private revealCircle(fog: Uint8Array, center: Point, radius: number): void {
    const minX = Math.max(0, Math.floor(center.x - radius));
    const maxX = Math.min(this.map.width - 1, Math.ceil(center.x + radius));
    const minY = Math.max(0, Math.floor(center.y - radius));
    const maxY = Math.min(this.map.height - 1, Math.ceil(center.y + radius));
    const r2 = radius * radius;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        if (dx * dx + dy * dy <= r2) {
          fog[indexOf(x, y, this.map.width)] = 2;
        }
      }
    }
  }

  public isEntityVisibleToSide(entity: Entity, side: SideId): boolean {
    if (entity.owner === side) {
      return true;
    }
    const center = entityCenter(entity);
    const tileX = Math.floor(center.x);
    const tileY = Math.floor(center.y);
    if (!this.inBounds(tileX, tileY)) {
      return false;
    }
    return this.fog[side][indexOf(tileX, tileY, this.map.width)] === 2;
  }

  public fogAt(side: SideId, x: number, y: number): number {
    if (!this.inBounds(x, y)) {
      return 0;
    }
    return this.fog[side][indexOf(x, y, this.map.width)]!;
  }

  public snapshotAt(side: SideId, x: number, y: number): BuildingSnapshot | undefined {
    if (!this.inBounds(x, y)) {
      return undefined;
    }
    return this.lastSeenBuildings[side].get(indexOf(x, y, this.map.width));
  }

  private updateWinLoss(): void {
    const playerBuildings = this.buildingsForSide(PLAYER_SIDE).filter((entity) => entity.hp > 0);
    const aiBuildings = this.buildingsForSide(AI_SIDE).filter((entity) => entity.hp > 0);
    if (playerBuildings.length === 0) {
      this.status = 'defeat';
      this.message = 'Defeat — all of your buildings have fallen.';
    } else if (aiBuildings.length === 0) {
      this.status = 'victory';
      this.message = 'Victory — the enemy base has been destroyed.';
    }
  }

  private aiUpdate(dt: number): void {
    this.ai.economyTimer -= dt;
    this.ai.trainingTimer -= dt;
    this.ai.defenseTimer -= dt;
    this.ai.waveTimer -= dt;
    if (this.ai.economyTimer <= 0) {
      this.ai.economyTimer = 3;
      this.aiMaintainEconomy();
    }
    if (this.ai.trainingTimer <= 0) {
      this.ai.trainingTimer = 4;
      this.aiTrainArmy();
    }
    if (this.ai.defenseTimer <= 0) {
      this.ai.defenseTimer = 2;
      this.aiDefendBase();
    }
    if (this.ai.waveTimer <= 0) {
      this.aiSendWave();
      const cadence = Math.max(55, 135 - this.ai.difficulty * 13);
      this.ai.waveTimer = cadence;
      this.ai.firstWaveSent = true;
    }
  }

  private aiMaintainEconomy(): void {
    const workers = this.unitsForSide(AI_SIDE).filter((entity) => entity.type === 'worker');
    const townHalls = this.buildingsForSide(AI_SIDE).filter((entity) => entity.type === 'townHall' && entity.completed);
    const barracks = this.buildingsForSide(AI_SIDE).filter((entity) => entity.type === 'barracks' && entity.completed);
    const lumberMills = this.buildingsForSide(AI_SIDE).filter((entity) => entity.type === 'lumberMill' && entity.completed);
    if (townHalls.length > 0 && workers.length < this.ai.desiredWorkers) {
      this.queueTraining(townHalls[0]!.id, 'worker');
    }
    for (const worker of workers) {
      if (worker.unit === undefined || worker.unit.order.kind !== 'idle') {
        continue;
      }
      const goldWorkers = workers.filter((candidate) => candidate.unit?.order.kind === 'harvest' && candidate.unit.order.resource === 'gold').length;
      const resource: ResourceKind = goldWorkers < Math.ceil(workers.length * 0.58) ? 'gold' : 'wood';
      const target = this.findNearestResource(resource, this.ai.base, 18);
      if (target !== null) {
        this.issueHarvest([worker.id], resource, target);
      }
    }
    const supply = this.getSupply(AI_SIDE);
    if (supply.cap - supply.used < 4) {
      this.aiTryBuild('farm');
    }
    if (barracks.length === 0) {
      this.aiTryBuild('barracks');
    }
    if (barracks.length > 0 && lumberMills.length === 0) {
      this.aiTryBuild('lumberMill');
    }
    const towers = this.buildingsForSide(AI_SIDE).filter((entity) => entity.type === 'guardTower').length;
    if (lumberMills.length > 0 && towers < Math.min(2 + Math.floor(this.ai.difficulty / 2), 4)) {
      this.aiTryBuild('guardTower');
    }
    if (townHalls.length === 0) {
      this.aiTryBuild('townHall');
    }
  }

  private aiTrainArmy(): void {
    const barracks = this.buildingsForSide(AI_SIDE).filter((entity) => entity.type === 'barracks' && entity.completed && entity.building !== undefined);
    for (const building of barracks) {
      if (building.building === undefined || building.building.trainQueue.length > 1) {
        continue;
      }
      const roll = this.rng.next();
      const hasMill = this.hasCompletedBuilding(AI_SIDE, 'lumberMill');
      const unit: UnitType = hasMill && roll > 0.72 ? 'heavy' : hasMill && roll > 0.42 ? 'ranged' : 'melee';
      const result = this.queueTraining(building.id, unit);
      if (!result.ok && result.reason.includes('Supply')) {
        this.aiTryBuild('farm');
      }
    }
  }

  private aiDefendBase(): void {
    const threats = this.entitiesForSide(PLAYER_SIDE).filter((entity) => distance(entityCenter(entity), this.ai.base) < 13 && entity.completed);
    if (threats.length === 0) {
      return;
    }
    const defenders = this.unitsForSide(AI_SIDE).filter((entity) => entity.type !== 'worker');
    const target = threats[0]!;
    for (const defender of defenders) {
      this.issueAttack([defender.id], target.id);
    }
  }

  private aiSendWave(): void {
    const military = this.unitsForSide(AI_SIDE).filter((entity) => entity.type !== 'worker');
    const needed = this.ai.firstWaveSent ? 4 + this.ai.difficulty * 2 : 3 + this.ai.difficulty;
    if (military.length < Math.min(needed, 18)) {
      this.ai.waveTimer = 25;
      return;
    }
    const wave = military.slice(0, Math.min(military.length, needed + Math.floor(this.elapsed / 240)));
    const playerBase = this.map.starts[0];
    this.issueMove(wave.map((entity) => entity.id), { x: playerBase.x, y: playerBase.y }, true);
  }

  private aiTryBuild(buildingType: BuildingType): boolean {
    const worker = this.unitsForSide(AI_SIDE).find((entity) => entity.type === 'worker' && entity.unit !== undefined && entity.unit.order.kind !== 'build');
    if (worker === undefined) {
      return false;
    }
    const stats = BUILDING_STATS[buildingType];
    if (!canAfford(this.players[AI_SIDE].resources, stats.goldCost, stats.woodCost)) {
      return false;
    }
    for (const point of this.aiBuildSpiral(buildingType)) {
      if (this.canPlaceBuilding(AI_SIDE, buildingType, point.x, point.y)) {
        return this.placeBuilding(worker.id, buildingType, point.x, point.y).ok;
      }
    }
    return false;
  }

  private aiBuildSpiral(buildingType: BuildingType): Point[] {
    const stats = BUILDING_STATS[buildingType];
    const points: Point[] = [];
    const towerOffsets: readonly Point[] = [
      { x: -5, y: -5 },
      { x: -5, y: 5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
    ];
    if (buildingType === 'guardTower') {
      const offset = towerOffsets[this.ai.nextTowerIndex % towerOffsets.length]!;
      this.ai.nextTowerIndex += 1;
      points.push({ x: Math.floor(this.ai.base.x + offset.x), y: Math.floor(this.ai.base.y + offset.y) });
    }
    for (let radius = 4; radius < 15; radius += 1) {
      for (let y = -radius; y <= radius; y += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          if (Math.abs(x) !== radius && Math.abs(y) !== radius) {
            continue;
          }
          points.push({
            x: Math.floor(this.ai.base.x + x - stats.footprint.width / 2),
            y: Math.floor(this.ai.base.y + y - stats.footprint.height / 2),
          });
        }
      }
    }
    return points;
  }

  private placeStartingBase(side: SideId, start: Point): void {
    const townHall = this.spawnBuilding(side, 'townHall', start.x - 2, start.y - 2, true);
    townHall.hp = townHall.maxHp;
    const workers = side === AI_SIDE ? 6 + this.level : 5;
    const offsets = formationOffsets(workers);
    for (let i = 0; i < workers; i += 1) {
      const offset = offsets[i] ?? { x: 0, y: 0 };
      const worker = this.spawnUnit(side, 'worker', start.x + 3 + offset.x, start.y + offset.y + 0.5);
      const resource: ResourceKind = i < Math.ceil(workers * 0.6) ? 'gold' : 'wood';
      const target = this.findNearestResource(resource, start, 14);
      if (target !== null) {
        this.issueHarvest([worker.id], resource, target);
      }
    }
  }

  private spawnUnit(side: SideId, unitType: UnitType, x: number, y: number): Entity {
    const stats = UNIT_STATS[unitType];
    const faction = this.players[side].faction;
    const entity: Entity = {
      id: this.nextEntityId,
      owner: side,
      kind: 'unit',
      type: unitType,
      faction,
      x,
      y,
      radius: unitType === 'heavy' ? 0.38 : 0.32,
      hp: stats.hp,
      maxHp: stats.hp,
      armor: stats.armor,
      sight: stats.sight,
      completed: true,
      buildProgress: stats.trainingTime,
      buildTime: stats.trainingTime,
      attackDamage: stats.damage,
      attackRange: stats.range,
      attackCooldown: stats.cooldown,
      cooldownRemaining: 0,
      projectileAttack: stats.projectile,
      unit: {
        speed: stats.speed,
        supplyCost: stats.supplyCost,
        carried: null,
        order: { kind: 'idle' },
        path: [],
        pathIndex: 0,
        stuckTime: 0,
        workProgress: 0,
        formationOffset: { x: 0, y: 0 },
      },
    };
    this.nextEntityId += 1;
    this.entities.set(entity.id, entity);
    return entity;
  }

  private spawnBuilding(side: SideId, buildingType: BuildingType, tileX: number, tileY: number, completed: boolean): Entity {
    const stats = BUILDING_STATS[buildingType];
    const faction = this.players[side].faction;
    const entity: Entity = {
      id: this.nextEntityId,
      owner: side,
      kind: 'building',
      type: buildingType,
      faction,
      x: tileX,
      y: tileY,
      radius: Math.max(stats.footprint.width, stats.footprint.height) / 2,
      hp: completed ? stats.hp : 1,
      maxHp: stats.hp,
      armor: stats.armor,
      sight: stats.sight,
      completed,
      buildProgress: completed ? stats.buildTime : 0,
      buildTime: stats.buildTime,
      attackDamage: stats.attackDamage,
      attackRange: stats.attackRange,
      attackCooldown: stats.attackCooldown,
      cooldownRemaining: 0,
      projectileAttack: stats.attackDamage > 0,
      building: {
        footprint: stats.footprint,
        supplyProvided: stats.supplyProvided,
        trainQueue: [],
      },
    };
    this.nextEntityId += 1;
    this.entities.set(entity.id, entity);
    return entity;
  }

  private findSpawnPoint(building: Entity): Point {
    const grid = this.pathGrid();
    if (building.building === undefined) {
      return { x: Math.floor(building.x), y: Math.floor(building.y) };
    }
    const minX = Math.floor(building.x) - 1;
    const maxX = Math.floor(building.x + building.building.footprint.width);
    const minY = Math.floor(building.y) - 1;
    const maxY = Math.floor(building.y + building.building.footprint.height);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if ((x === minX || x === maxX || y === minY || y === maxY) && this.inBounds(x, y) && grid.isPassable(x, y)) {
          return { x, y };
        }
      }
    }
    return { x: Math.floor(entityCenter(building).x), y: Math.floor(entityCenter(building).y + building.radius + 1) };
  }

  private pathGrid(): Grid {
    return gridFromMap(this.map, this.buildingBlockedTiles());
  }

  private buildingBlockedTiles(): ReadonlySet<number> {
    const blocked = new Set<number>();
    for (const entity of this.entities.values()) {
      if (entity.kind !== 'building' || entity.building === undefined || entity.hp <= 0) {
        continue;
      }
      for (let y = Math.floor(entity.y); y < Math.floor(entity.y) + entity.building.footprint.height; y += 1) {
        for (let x = Math.floor(entity.x); x < Math.floor(entity.x) + entity.building.footprint.width; x += 1) {
          if (this.inBounds(x, y)) {
            blocked.add(indexOf(x, y, this.map.width));
          }
        }
      }
    }
    return blocked;
  }

  private findNearestResource(resource: ResourceKind, origin: Point, maxRadius: number): Point | null {
    let best: Point | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = Math.max(0, Math.floor(origin.y - maxRadius)); y <= Math.min(this.map.height - 1, Math.ceil(origin.y + maxRadius)); y += 1) {
      for (let x = Math.max(0, Math.floor(origin.x - maxRadius)); x <= Math.min(this.map.width - 1, Math.ceil(origin.x + maxRadius)); x += 1) {
        const idx = indexOf(x, y, this.map.width);
        const available = resource === 'gold' ? this.map.gold[idx]! : this.map.wood[idx]!;
        const tileMatches = resource === 'gold' ? this.map.tiles[idx] === 'gold' : this.map.tiles[idx] === 'forest';
        if (!tileMatches || available <= 0) {
          continue;
        }
        const d = distance(origin, { x: x + 0.5, y: y + 0.5 });
        if (d < bestDistance) {
          bestDistance = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  private findNearestDropoff(side: SideId, resource: ResourceKind, origin: Point): Entity | null {
    let best: Entity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entity of this.buildingsForSide(side)) {
      if (!entity.completed) {
        continue;
      }
      if (entity.type !== 'townHall' && !(resource === 'wood' && entity.type === 'lumberMill')) {
        continue;
      }
      const d = distance(origin, entityCenter(entity));
      if (d < bestDistance) {
        best = entity;
        bestDistance = d;
      }
    }
    return best;
  }

  private hasCompletedBuilding(side: SideId, buildingType: BuildingType): boolean {
    return this.buildingsForSide(side).some((entity) => entity.type === buildingType && entity.completed);
  }

  private unitsFromIds(entityIds: readonly number[]): Entity[] {
    return entityIds
      .map((id) => this.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined && entity.kind === 'unit' && entity.unit !== undefined && entity.hp > 0);
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height;
  }
}

export function entityCenter(entity: Entity): Point {
  if (entity.kind === 'building' && entity.building !== undefined) {
    return { x: entity.x + entity.building.footprint.width / 2, y: entity.y + entity.building.footprint.height / 2 };
  }
  return { x: entity.x, y: entity.y };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToEntity(point: Point, entity: Entity): number {
  return Math.max(0, distance(point, entityCenter(entity)) - entity.radius);
}

function normalized(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0.000001) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function formationOffsets(count: number): Point[] {
  const offsets: Point[] = [];
  if (count <= 0) {
    return offsets;
  }
  offsets.push({ x: 0, y: 0 });
  let radius = 1;
  while (offsets.length < count) {
    for (let y = -radius; y <= radius && offsets.length < count; y += 1) {
      for (let x = -radius; x <= radius && offsets.length < count; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) {
          continue;
        }
        offsets.push({ x: x * 0.85, y: y * 0.85 });
      }
    }
    radius += 1;
  }
  return offsets;
}
