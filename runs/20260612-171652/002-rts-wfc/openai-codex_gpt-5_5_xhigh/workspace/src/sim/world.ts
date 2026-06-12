import { AI_THINK_INTERVAL, CORPSE_FADE_TICKS, MAX_ORDER_STALL_TICKS } from './constants';
import { createCampaignMap, levelConfig, mapGrid } from './map/generator';
import { getTile, setTileKind } from './map/tiles';
import { findPath } from './pathfinding';
import { validatePlacement } from './placement';
import { Mulberry32, type Prng } from './prng';
import { BALANCE, buildingStats, unitStats } from './stats';
import type {
  Building, BuildingKind, EntityId, Faction, FogState, GameMap, GameOutcome, PlayerId, PlayerState,
  Point, Projectile, ResourceKind, Unit, UnitKind
} from './types';
import { clamp, distance, inBounds, mustGet, samePoint, spiral, tileKey } from './utils';
import { tickAi } from './systems/ai';
import { tickCombat, tickProjectiles } from './systems/combat';
import { tickFog } from './systems/fog';
import { assertWorldInvariants } from './systems/invariants';
import { tickHarvestAndWork } from './systems/harvest';
import { tickMovement } from './systems/movement';
import { tickProduction } from './systems/production';

export interface WorldOptions { playerFaction?: Faction; aiEnabled?: boolean; bothAi?: boolean; difficulty?: number }

export class World {
  public readonly seed: number; public readonly prng: Prng; public readonly aiEnabled: boolean; public readonly bothAi: boolean;
  public readonly selectedIds = new Set<EntityId>(); public readonly controlGroups = new Map<number, EntityId[]>();
  public readonly units = new Map<EntityId, Unit>(); public readonly buildings = new Map<EntityId, Building>();
  public readonly projectiles: Projectile[] = []; public readonly corpses: { x: number; y: number; remainingTicks: number; owner: PlayerId }[] = [];
  public readonly players = new Map<PlayerId, PlayerState>(); public readonly fog = new Map<PlayerId, FogState>();
  public tickCount = 0; public outcome: GameOutcome = 'playing'; public nextAiThinkTick = 0; private nextId = 1;
  private gridCacheVersion = -1; private gridCacheCount = -1; private gridCache?: ReturnType<typeof mapGrid>;

  public constructor(public readonly map: GameMap, seed: number, options: WorldOptions = {}) {
    this.seed = seed >>> 0;
    this.prng = new Mulberry32(this.seed);
    this.aiEnabled = options.aiEnabled ?? true;
    this.bothAi = options.bothAi ?? false;
    const playerFaction = options.playerFaction ?? 'humans';
    const aiFaction: Faction = playerFaction === 'humans' ? 'orcs' : 'humans';
    const difficulty = options.difficulty ?? levelConfig(map.level).aiDifficulty;
    this.players.set(1, this.createPlayer(1, playerFaction, 1));
    this.players.set(2, this.createPlayer(2, aiFaction, difficulty));
    this.initializeFog();
    this.placeStartingForces();
  }

  public static create(seed: number, level: number, options: WorldOptions = {}): World { return new World(createCampaignMap(seed, level), seed, options); }

  public step(ticks = 1): void {
    for (let i = 0; i < ticks; i += 1) {
      if (this.outcome !== 'playing') {
        return;
      }
      this.tickCount += 1;
      if (this.aiEnabled && this.tickCount >= this.nextAiThinkTick) {
        if (this.bothAi) {
          tickAi(this, 1);
        }
        tickAi(this, 2);
        this.nextAiThinkTick = this.tickCount + AI_THINK_INTERVAL;
      }
      tickProduction(this);
      tickHarvestAndWork(this);
      tickCombat(this);
      tickMovement(this);
      tickProjectiles(this);
      tickFog(this);
      this.tickCorpses();
      this.updateProgressWatchdog();
      this.updateOutcome();
    }
  }

  public assertInvariants(): void { assertWorldInvariants(this); }
  public player(id: PlayerId): PlayerState { return mustGet(this.players, id, 'player'); }
  public enemyOf(owner: PlayerId): PlayerId { return owner === 1 ? 2 : 1; }

  public spawnUnit(owner: PlayerId, kind: UnitKind, tile: Point, chargeSupply = true): EntityId {
    const player = this.player(owner);
    const stats = unitStats(player.faction, kind);
    const id = this.nextId;
    this.nextId += 1;
    const unit: Unit = {
      id, type: 'unit', owner, faction: player.faction, kind, hp: stats.hp, tile: { ...tile }, x: tile.x + 0.5, y: tile.y + 0.5,
      order: { kind: 'idle' }, path: [], pathVersion: this.map.walkVersion, pathReachable: true, attackCooldown: 0,
      blockedTicks: 0, repathAttempts: 0, lastProgressTick: this.tickCount, lastProgressSignature: ''
    };
    unit.lastProgressSignature = this.progressSignature(unit);
    this.units.set(id, unit);
    if (chargeSupply) {
      player.supplyUsed += stats.supply;
    }
    return id;
  }

  public spawnBuilding(owner: PlayerId, kind: BuildingKind, site: Point, complete = true): EntityId {
    const player = this.player(owner);
    const stats = buildingStats(kind);
    const id = this.nextId;
    this.nextId += 1;
    const building: Building = {
      id, type: 'building', owner, faction: player.faction, kind, hp: complete ? stats.hp : Math.max(1, Math.floor(stats.hp * 0.12)),
      x: site.x, y: site.y, w: stats.footprint.w, h: stats.footprint.h, complete, queue: [], attackCooldown: 0
    };
    this.buildings.set(id, building);
    this.recalculateSupply(owner);
    this.map.walkVersion += 1;
    return id;
  }

  public issueMove(ids: EntityId[], target: Point): void {
    const slots = this.allocateGroupSlots(target, ids.length);
    ids.forEach((id, index) => {
      const unit = this.units.get(id);
      const slot = slots[index] ?? target;
      if (unit !== undefined) {
        this.replaceOrder(unit, { kind: 'move', target: slot, reachable: true });
        this.setDestination(unit, slot);
      }
    });
  }

  public issueAttack(unitId: EntityId, targetId: EntityId): void {
    const unit = this.units.get(unitId);
    if (unit !== undefined && this.entityOwner(targetId) !== unit.owner) {
      this.replaceOrder(unit, { kind: 'attack', targetId });
      unit.destination = undefined;
      unit.path = [];
    }
  }

  public issueAttackMove(ids: EntityId[], target: Point): void {
    const slots = this.allocateGroupSlots(target, ids.length);
    ids.forEach((id, index) => {
      const unit = this.units.get(id);
      const slot = slots[index] ?? target;
      if (unit !== undefined) {
        this.replaceOrder(unit, { kind: 'attackMove', target: slot, reachable: true });
        this.setDestination(unit, slot);
      }
    });
  }

  public issueHarvest(unitId: EntityId, source: Point): void {
    const unit = this.units.get(unitId);
    if (unit === undefined || unit.kind !== 'worker') {
      return;
    }
    const tile = getTile(this.map, source.x, source.y);
    if (tile.kind !== 'goldMine' && tile.kind !== 'forest') {
      return;
    }
    const resource: ResourceKind = tile.kind === 'goldMine' ? 'gold' : 'wood';
    this.replaceOrder(unit, { kind: 'harvest', resource, source: { ...source }, phase: 'toSource', gatherTicks: 0 });
  }

  public issueBuild(workerId: EntityId, kind: BuildingKind, site: Point): EntityId | undefined {
    const worker = this.units.get(workerId);
    if (worker === undefined || worker.kind !== 'worker') {
      return undefined;
    }
    const result = validatePlacement({ map: this.map, buildings: this.buildings.values(), units: this.units.values() }, kind, site);
    if (!result.ok || !this.payCost(worker.owner, buildingStats(kind).cost)) {
      return undefined;
    }
    const buildingId = this.spawnBuilding(worker.owner, kind, site, false);
    const building = this.requireBuilding(buildingId);
    building.build = { remainingTicks: buildingStats(kind).buildTicks, totalTicks: buildingStats(kind).buildTicks, workerId };
    this.replaceOrder(worker, { kind: 'build', building: kind, site: { ...site }, phase: 'toSite' });
    return buildingId;
  }

  public issueRepair(workerId: EntityId, targetId: EntityId): void {
    const worker = this.units.get(workerId);
    const target = this.buildings.get(targetId);
    if (worker !== undefined && target !== undefined && worker.kind === 'worker' && worker.owner === target.owner) {
      this.replaceOrder(worker, { kind: 'repair', targetId, phase: 'toTarget' });
    }
  }

  public enqueueTraining(buildingId: EntityId, kind: UnitKind): boolean {
    const building = this.buildings.get(buildingId);
    if (building === undefined || !building.complete) {
      return false;
    }
    const stats = unitStats(building.faction, kind);
    const bstats = buildingStats(building.kind);
    const player = this.player(building.owner);
    if (!bstats.trains.includes(kind) || building.queue.length >= BALANCE.maxQueue || !this.hasRequirements(building.owner, stats.requires)) {
      return false;
    }
    if (player.supplyUsed + stats.supply > player.supplyCap || !this.payCost(building.owner, stats.cost)) {
      return false;
    }
    player.supplyUsed += stats.supply;
    building.queue.push({ kind, remainingTicks: stats.trainingTicks, totalTicks: stats.trainingTicks });
    return true;
  }

  public setStockpile(owner: PlayerId, gold: number, wood: number): void { const player = this.player(owner); player.gold = gold; player.wood = wood; }

  public damageEntity(id: EntityId, amount: number): void {
    const unit = this.units.get(id);
    if (unit !== undefined) {
      unit.hp = Math.max(0, unit.hp - amount);
      if (unit.hp <= 0) {
        this.destroyEntity(id);
      }
      return;
    }
    const building = this.buildings.get(id);
    if (building !== undefined) {
      building.hp = Math.max(0, building.hp - amount);
      if (building.hp <= 0) {
        this.destroyEntity(id);
      }
    }
  }

  public destroyEntity(id: EntityId): void {
    const unit = this.units.get(id);
    if (unit !== undefined) {
      this.units.delete(id);
      this.player(unit.owner).supplyUsed = Math.max(0, this.player(unit.owner).supplyUsed - unitStats(unit.faction, unit.kind).supply);
      this.corpses.push({ x: unit.x, y: unit.y, remainingTicks: CORPSE_FADE_TICKS, owner: unit.owner });
      return;
    }
    const building = this.buildings.get(id);
    if (building !== undefined) {
      for (const item of building.queue) {
        this.player(building.owner).supplyUsed = Math.max(0, this.player(building.owner).supplyUsed - unitStats(building.faction, item.kind).supply);
      }
      this.buildings.delete(id);
      this.map.walkVersion += 1;
      this.recalculateSupply(building.owner);
      this.corpses.push({ x: building.x + building.w / 2, y: building.y + building.h / 2, remainingTicks: CORPSE_FADE_TICKS, owner: building.owner });
    }
  }

  public setDestination(unit: Unit, target: Point): void {
    const resolved = this.findNearestFreeWalkable(target, 10, unit.id) ?? target;
    const result = findPath(this.staticGrid(), unit.tile, resolved);
    unit.desiredDestination = { ...target };
    unit.destination = result.destination;
    unit.path = result.path;
    unit.pathVersion = this.map.walkVersion;
    unit.pathReachable = result.reachable && samePoint(result.destination, target);
    unit.blockedTicks = 0;
    unit.repathAttempts = 0;
  }

  public staticGrid(): ReturnType<typeof mapGrid> {
    if (this.gridCache !== undefined && this.gridCacheVersion === this.map.walkVersion && this.gridCacheCount === this.buildings.size) { return this.gridCache; }
    const base = mapGrid(this.map);
    const blocked = new Set<string>();
    for (const building of this.buildings.values()) {
      for (let y = building.y; y < building.y + building.h; y += 1) { for (let x = building.x; x < building.x + building.w; x += 1) { blocked.add(tileKey(x, y)); } }
    }
    this.gridCache = { width: this.map.width, height: this.map.height, isBlocked: (x, y) => base.isBlocked(x, y) || blocked.has(tileKey(x, y)) };
    this.gridCacheVersion = this.map.walkVersion; this.gridCacheCount = this.buildings.size; return this.gridCache;
  }

  public buildingAtTile(x: number, y: number): Building | undefined {
    for (const building of this.buildings.values()) {
      if (x >= building.x && x < building.x + building.w && y >= building.y && y < building.y + building.h) {
        return building;
      }
    }
    return undefined;
  }

  public unitAtTile(x: number, y: number, exceptId?: EntityId): Unit | undefined {
    for (const unit of this.units.values()) {
      const reserves = unit.tile.x === x && unit.tile.y === y || (unit.move !== undefined && unit.move.to.x === x && unit.move.to.y === y);
      if (unit.id !== exceptId && reserves) { return unit; }
    }
    return undefined;
  }

  public findNearestFreeWalkable(target: Point, radius: number, exceptId?: EntityId): Point | undefined {
    for (const point of spiral(target, radius)) {
      if (inBounds(this.map.width, this.map.height, point.x, point.y) && !this.staticGrid().isBlocked(point.x, point.y)
        && this.unitAtTile(point.x, point.y, exceptId) === undefined) {
        return point;
      }
    }
    return undefined;
  }

  public findSpawnTile(building: Building): Point | undefined {
    const center = { x: Math.floor(building.x + building.w / 2), y: Math.floor(building.y + building.h / 2) };
    for (const point of spiral(center, 20)) {
      const outside = point.x < building.x || point.x >= building.x + building.w || point.y < building.y || point.y >= building.y + building.h;
      if (outside && inBounds(this.map.width, this.map.height, point.x, point.y) && !this.staticGrid().isBlocked(point.x, point.y)
        && this.unitAtTile(point.x, point.y) === undefined) {
        return point;
      }
    }
    return undefined;
  }

  public nearestDropoff(owner: PlayerId, resource: ResourceKind, from: Point): Building | undefined {
    let best: Building | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const building of this.buildings.values()) {
      if (building.owner !== owner || !building.complete || !buildingStats(building.kind).dropoff.includes(resource)) {
        continue;
      }
      const tile = this.nearestAdjacentToBuilding(building, from);
      if (tile !== undefined) {
        const d = distance(from, tile);
        if (d < bestDistance) { best = building; bestDistance = d; }
      }
    }
    return best;
  }

  public nearestAdjacentToBuilding(building: Building, from: Point): Point | undefined {
    let best: Point | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = building.y - 1; y <= building.y + building.h; y += 1) {
      for (let x = building.x - 1; x <= building.x + building.w; x += 1) {
        const edge = x < building.x || x >= building.x + building.w || y < building.y || y >= building.y + building.h;
        if (edge && inBounds(this.map.width, this.map.height, x, y) && !this.staticGrid().isBlocked(x, y)) {
          const d = distance(from, { x, y });
          if (d < bestDistance) {
            best = { x, y };
            bestDistance = d;
          }
        }
      }
    }
    return best;
  }

  public nearestResource(resource: ResourceKind, from: Point): Point | undefined {
    let best: Point | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        const tile = getTile(this.map, x, y);
        const matches = resource === 'gold' ? tile.kind === 'goldMine' && tile.gold > 0 : tile.kind === 'forest' && tile.wood > 0;
        if (matches) {
          const adjacent = this.nearestAdjacentToTile({ x, y }, from);
          if (adjacent !== undefined) {
            const d = distance(from, adjacent);
            if (d < bestDistance) {
              best = { x, y };
              bestDistance = d;
            }
          }
        }
      }
    }
    return best;
  }

  public nearestAdjacentToTile(source: Point, from: Point): Point | undefined {
    let best: Point | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let y = source.y - 1; y <= source.y + 1; y += 1) {
      for (let x = source.x - 1; x <= source.x + 1; x += 1) {
        if ((x !== source.x || y !== source.y) && inBounds(this.map.width, this.map.height, x, y) && !this.staticGrid().isBlocked(x, y)) {
          const d = distance(from, { x, y });
          if (d < bestDistance) {
            best = { x, y };
            bestDistance = d;
          }
        }
      }
    }
    return best;
  }

  public requireBuilding(id: EntityId): Building { return mustGet(this.buildings, id, 'building'); }

  public canSee(player: PlayerId, x: number, y: number): boolean { return mustGet(this.fog, player, 'fog').visible[y * this.map.width + x] === 1; }

  public markTileChanged(point: Point, kind: 'forest' | 'goldMine'): void {
    const tile = getTile(this.map, point.x, point.y);
    if (kind === 'forest' && tile.wood <= 0) { setTileKind(this.map, point.x, point.y, 'grass'); }
    if (kind === 'goldMine' && tile.gold <= 0) { setTileKind(this.map, point.x, point.y, 'depletedMine'); }
  }

  public entityOwner(id: EntityId): PlayerId | undefined { return this.units.get(id)?.owner ?? this.buildings.get(id)?.owner; }

  public payCost(owner: PlayerId, cost: { gold: number; wood: number }): boolean {
    const player = this.player(owner);
    if (player.gold < cost.gold || player.wood < cost.wood) { return false; }
    player.gold -= cost.gold; player.wood -= cost.wood; return true;
  }

  public hasRequirements(owner: PlayerId, requirements: BuildingKind[]): boolean { return requirements.every(kind => Array.from(this.buildings.values()).some(b => b.owner === owner && b.kind === kind && b.complete)); }

  public completeBuilding(building: Building): void { building.complete = true; building.build = undefined; building.hp = buildingStats(building.kind).hp; this.recalculateSupply(building.owner); }

  public replaceOrder(unit: Unit, order: Unit['order']): void {
    unit.order = order;
    unit.destination = undefined;
    unit.desiredDestination = undefined;
    unit.path = [];
    unit.blockedTicks = 0;
    unit.repathAttempts = 0;
    unit.lastProgressTick = this.tickCount;
    unit.lastProgressSignature = this.progressSignature(unit);
  }

  private createPlayer(id: PlayerId, faction: Faction, difficulty: number): PlayerState {
    const bonusGold = id === 2 ? BALANCE.aiStartingBonusGoldPerDifficulty * difficulty : 0;
    const bonusWood = id === 2 ? BALANCE.aiStartingBonusWoodPerDifficulty * difficulty : 0;
    return { id, faction, gold: BALANCE.startingGold + bonusGold, wood: BALANCE.startingWood + bonusWood, supplyUsed: 0, supplyCap: 0, aiDifficulty: difficulty, wavesLaunched: 0, unlockedLevel: 1 };
  }

  private initializeFog(): void {
    for (const id of [1, 2] as const) { this.fog.set(id, { explored: new Uint8Array(this.map.width * this.map.height), visible: new Uint8Array(this.map.width * this.map.height) }); }
  }

  private placeStartingForces(): void {
    for (const start of this.map.starts) {
      const hallSite = { x: start.x - 1, y: start.y - 1 };
      this.spawnBuilding(start.player, 'townHall', hallSite, true);
      const workerTiles = [{ x: start.x - 2, y: start.y + 2 }, { x: start.x - 1, y: start.y + 2 }, { x: start.x + 1, y: start.y + 2 }, { x: start.x + 2, y: start.y + 2 }];
      for (let i = 0; i < BALANCE.startingWorkers; i += 1) {
        this.spawnUnit(start.player, 'worker', workerTiles[i]);
      }
      this.recalculateSupply(start.player);
    }
  }

  private recalculateSupply(owner: PlayerId): void {
    let cap = 0;
    for (const building of this.buildings.values()) {
      if (building.owner === owner && building.complete) {
        cap += buildingStats(building.kind).supplyProvided;
      }
    }
    this.player(owner).supplyCap = cap;
  }

  private allocateGroupSlots(target: Point, count: number): Point[] {
    const slots: Point[] = [];
    for (const point of spiral(target, Math.max(4, Math.ceil(Math.sqrt(count)) + 4))) {
      if (slots.length >= count) {
        break;
      }
      if (inBounds(this.map.width, this.map.height, point.x, point.y) && !this.staticGrid().isBlocked(point.x, point.y)) {
        slots.push(point);
      }
    }
    return slots;
  }

  private progressSignature(unit: Unit): string {
    const cargo = unit.cargo === undefined ? 'none' : `${unit.cargo.kind}:${unit.cargo.amount}`;
    const phase = unit.order.kind === 'harvest' ? unit.order.phase : unit.order.kind;
    return [unit.tile.x, unit.tile.y, unit.move?.progress.toFixed(2) ?? 's', phase, cargo, Math.round(unit.attackCooldown)].join('|');
  }

  private updateProgressWatchdog(): void {
    for (const unit of this.units.values()) {
      if (unit.order.kind === 'idle') {
        unit.lastProgressTick = this.tickCount;
        unit.lastProgressSignature = this.progressSignature(unit);
        continue;
      }
      const signature = this.progressSignature(unit);
      if (signature !== unit.lastProgressSignature) {
        unit.lastProgressSignature = signature;
        unit.lastProgressTick = this.tickCount;
      } else if (this.tickCount - unit.lastProgressTick > MAX_ORDER_STALL_TICKS) {
        this.replaceOrder(unit, { kind: 'idle', reason: 'stalled' });
      }
    }
  }

  private tickCorpses(): void {
    for (const corpse of this.corpses) {
      corpse.remainingTicks -= 1;
    }
    for (let i = this.corpses.length - 1; i >= 0; i -= 1) {
      if (this.corpses[i].remainingTicks <= 0) {
        this.corpses.splice(i, 1);
      }
    }
  }

  private updateOutcome(): void {
    const playerBuildings = Array.from(this.buildings.values()).some(b => b.owner === 1);
    const aiBuildings = Array.from(this.buildings.values()).some(b => b.owner === 2);
    if (!playerBuildings) { this.outcome = 'defeat'; } else if (!aiBuildings) { this.outcome = 'victory'; this.player(1).unlockedLevel = clamp(this.map.level + 1, 1, 5); }
  }
}
