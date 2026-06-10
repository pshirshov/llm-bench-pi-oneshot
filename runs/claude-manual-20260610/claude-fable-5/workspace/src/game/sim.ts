import { idx, inBounds } from '../map/gamemap';
import { Tile } from '../map/tiles';
import {
  BUILDING_STATS,

  CHOP_PER_SECOND,
  computeDamage,
  CORPSE_FADE_TIME,

  HARVEST_AMOUNT,
  HARVEST_TIME,
  REPAIR_GOLD_PER_SECOND,
  REPAIR_HP_PER_SECOND,
  UNIT_RADIUS,
  UNIT_STATS,
  UnitType,
} from './data';
import { updateFog } from './fog';
import {
  destroyBuilding,
  findFreeSpotNear,
  nearestDropOff,
  nearestTileOfKind,
  recomputeSupply,
  requestPath,
  spawnUnit,
  tileIndexAt,
} from './commands';
import {
  Building,
  buildingCenter,
  distToBuilding,
  findBuilding,
  findUnit,
  GameState,
  playerOf,
  TICK_DT,
  Unit,
} from './state';
import { SpatialHash } from './spatial';

const PROJECTILE_SPEED = 11; // tiles per second
const DEPOSIT_RANGE = 1.0;
const BUILD_RANGE = 1.0;
const GATHER_RANGE = 1.45; // from unit centre to resource tile centre
const ACQUIRE_INTERVAL_TICKS = 8;
const REPATH_INTERVAL = 0.6;
const STUCK_SETTLE_TIME = 1.2;
const SETTLE_NEAR_GOAL_DIST = 3.0;
const FOG_INTERVAL_TICKS = 5;

export interface SimContext {
  spatial: SpatialHash;
}

export function createSimContext(state: GameState): SimContext {
  return { spatial: new SpatialHash(state.map.width, state.map.height) };
}

export function tickGame(state: GameState, ctx: SimContext): void {
  if (state.result !== 'playing') return;
  const dt = TICK_DT;
  state.tick++;
  state.time += dt;

  ctx.spatial.rebuild(state.units);

  for (const u of state.units) {
    u.prevX = u.x;
    u.prevY = u.y;
    updateUnit(state, ctx, u, dt);
  }
  resolveUnitCollisions(state, ctx);
  // Crowd-stuck detection has to run after collision separation: a unit can
  // move freely toward its goal each tick yet be pushed straight back by the
  // crowd. Without this, groups shove forever and never settle.
  for (const u of state.units) {
    detectCrowdStuck(state, ctx, u, dt);
  }
  for (const b of state.buildings) {
    updateBuilding(state, ctx, b, dt);
  }
  updateProjectiles(state, dt);
  sweepDead(state);

  for (const c of state.corpses) c.age += dt;
  state.corpses = state.corpses.filter((c) => c.age < CORPSE_FADE_TIME);

  recomputeSupply(state);
  if (state.tick % FOG_INTERVAL_TICKS === 1) {
    updateFog(state, state.players[0]);
  }
  checkGameOver(state);
}

// ---------------------------------------------------------------------------
// Units

function updateUnit(state: GameState, ctx: SimContext, u: Unit, dt: number): void {
  if (u.hp <= 0) return;
  if (u.cooldown > 0) u.cooldown -= dt;
  if (u.repathCooldown > 0) u.repathCooldown -= dt;

  const order = u.order;
  switch (order.kind) {
    case 'idle': {
      u.settled = true;
      if (u.type !== UnitType.Worker) {
        maybeAutoAcquire(state, ctx, u);
        if (u.autoTargetId !== null) {
          const res = engage(state, u, u.autoTargetId, dt);
          if (res === 'gone') u.autoTargetId = null;
        }
      }
      break;
    }
    case 'move': {
      const goal = tileIndexAt(state.map, order.x, order.y);
      if (!u.path && !requestPath(state, u, goal, true)) {
        u.order = { kind: 'idle' };
        break;
      }
      const status = followPath(state, ctx, u, dt);
      if (status === 'arrived') {
        u.order = { kind: 'idle' };
        u.lastGoalX = order.x;
        u.lastGoalY = order.y;
      } else maybeSettleNear(state, u, order.x, order.y, status);
      break;
    }
    case 'attackMove': {
      if (u.autoTargetId === null && state.tick % ACQUIRE_INTERVAL_TICKS === u.id % ACQUIRE_INTERVAL_TICKS) {
        u.autoTargetId = acquireTarget(state, ctx, u, true);
        if (u.autoTargetId !== null) u.path = null;
      }
      if (u.autoTargetId !== null) {
        const res = engage(state, u, u.autoTargetId, dt);
        if (res === 'gone') {
          u.autoTargetId = null;
          u.path = null;
        }
        break;
      }
      const goal = tileIndexAt(state.map, order.x, order.y);
      if (!u.path && !requestPath(state, u, goal, true)) {
        u.order = { kind: 'idle' };
        break;
      }
      const status = followPath(state, ctx, u, dt);
      if (status === 'arrived') {
        u.order = { kind: 'idle' };
        u.lastGoalX = order.x;
        u.lastGoalY = order.y;
      } else maybeSettleNear(state, u, order.x, order.y, status);
      break;
    }
    case 'attack': {
      const res = engage(state, u, order.targetId, dt);
      if (res === 'gone') u.order = { kind: 'idle' };
      break;
    }
    case 'harvestGold':
      updateHarvestGold(state, u, order.tile, dt);
      break;
    case 'harvestWood':
      updateHarvestWood(state, u, order.tile, dt);
      break;
    case 'build': {
      const b = findBuilding(state, order.buildingId);
      if (!b || b.faction !== u.faction) {
        u.order = { kind: 'idle' };
        break;
      }
      if (b.constructed) {
        u.order = { kind: 'idle' };
        break;
      }
      if (distToBuilding(b, u.x, u.y) <= BUILD_RANGE) {
        u.path = null;
        const stats = BUILDING_STATS[b.type];
        b.buildProgress += dt;
        b.hp = Math.min(stats.hp, b.hp + (stats.hp * 0.9 * dt) / stats.buildTime);
        b.builderId = u.id;
        if (b.buildProgress >= stats.buildTime) {
          b.constructed = true;
          b.hp = stats.hp;
          b.builderId = null;
          u.order = { kind: 'idle' };
        }
      } else {
        approachBuilding(state, ctx, u, b, dt);
      }
      break;
    }
    case 'repair': {
      const b = findBuilding(state, order.buildingId);
      const stats = b ? BUILDING_STATS[b.type] : null;
      if (!b || !stats || b.faction !== u.faction || (b.constructed && b.hp >= stats.hp)) {
        u.order = { kind: 'idle' };
        break;
      }
      if (!b.constructed) {
        // Repairing a construction site means helping build it.
        u.order = { kind: 'build', buildingId: b.id };
        break;
      }
      if (distToBuilding(b, u.x, u.y) <= BUILD_RANGE) {
        u.path = null;
        const player = playerOf(state, u.faction);
        if (player.gold > 0) {
          b.hp = Math.min(stats.hp, b.hp + REPAIR_HP_PER_SECOND * dt);
          player.gold = Math.max(0, player.gold - REPAIR_GOLD_PER_SECOND * dt);
        }
      } else {
        approachBuilding(state, ctx, u, b, dt);
      }
      break;
    }
  }
}

/** Returns 'gone' when the target no longer exists. */
function engage(state: GameState, u: Unit, targetId: number, dt: number): 'gone' | 'busy' {
  const stats = UNIT_STATS[u.type];
  const targetUnit = findUnit(state, targetId);
  const targetBuilding = targetUnit ? undefined : findBuilding(state, targetId);
  if ((!targetUnit || targetUnit.hp <= 0) && !targetBuilding) return 'gone';

  let dist: number;
  let aimX: number;
  let aimY: number;
  if (targetUnit) {
    dist = Math.hypot(targetUnit.x - u.x, targetUnit.y - u.y) - UNIT_RADIUS;
    aimX = targetUnit.x;
    aimY = targetUnit.y;
  } else {
    dist = distToBuilding(targetBuilding!, u.x, u.y);
    const c = buildingCenter(targetBuilding!);
    aimX = c.x;
    aimY = c.y;
  }

  if (dist <= stats.range) {
    u.path = null;
    u.stuckTime = 0;
    if (u.cooldown <= 0) {
      u.cooldown = stats.cooldown;
      if (stats.range > 2) {
        state.projectiles.push({
          x: u.x,
          y: u.y,
          targetId,
          targetIsBuilding: !targetUnit,
          speed: PROJECTILE_SPEED,
          damage: stats.damage,
          faction: u.faction,
        });
      } else if (targetUnit) {
        applyDamageToUnit(state, targetUnit, stats.damage, u.id);
      } else {
        applyDamageToBuilding(state, targetBuilding!, stats.damage);
      }
    }
    return 'busy';
  }

  // Chase.
  if (!u.path || u.repathCooldown <= 0) {
    const goal = tileIndexAt(state.map, aimX, aimY);
    u.repathCooldown = REPATH_INTERVAL;
    requestPath(state, u, goal, true);
  }
  followPathRaw(state, u, dt);
  return 'busy';
}

function maybeAutoAcquire(state: GameState, ctx: SimContext, u: Unit): void {
  if (u.autoTargetId !== null) return;
  if (state.tick % ACQUIRE_INTERVAL_TICKS !== u.id % ACQUIRE_INTERVAL_TICKS) return;
  u.autoTargetId = acquireTarget(state, ctx, u, false);
}

/** Nearest visible enemy unit (and optionally building) within sight. */
function acquireTarget(
  state: GameState,
  ctx: SimContext,
  u: Unit,
  includeBuildings: boolean,
): number | null {
  const sight = UNIT_STATS[u.type].sight;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const other of ctx.spatial.query(u.x, u.y, sight)) {
    if (other.faction === u.faction || other.hp <= 0) continue;
    const d = Math.hypot(other.x - u.x, other.y - u.y);
    if (d < bestDist) {
      bestDist = d;
      best = other.id;
    }
  }
  if (best === null && includeBuildings) {
    for (const b of state.buildings) {
      if (b.faction === u.faction) continue;
      const d = distToBuilding(b, u.x, u.y);
      if (d <= sight && d < bestDist) {
        bestDist = d;
        best = b.id;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Harvesting

function updateHarvestGold(state: GameState, u: Unit, mineTile: number, dt: number): void {
  if (u.carrying && u.carrying.amount >= HARVEST_AMOUNT) {
    returnResource(state, u, dt);
    return;
  }
  const { map } = state;
  if ((map.tiles[mineTile] as Tile) !== Tile.GoldMine) {
    const tx = (mineTile % map.width) + 0.5;
    const ty = Math.floor(mineTile / map.width) + 0.5;
    const next = nearestTileOfKind(state, tx, ty, Tile.GoldMine, 16);
    if (next !== null) {
      u.order = { kind: 'harvestGold', tile: next };
      u.path = null;
    } else if (u.carrying && u.carrying.amount > 0) {
      returnResource(state, u, dt);
    } else {
      u.order = { kind: 'idle' };
    }
    return;
  }
  const mx = (mineTile % map.width) + 0.5;
  const my = Math.floor(mineTile / map.width) + 0.5;
  if (Math.hypot(mx - u.x, my - u.y) <= GATHER_RANGE) {
    u.path = null;
    u.harvestTimer += dt;
    if (u.harvestTimer >= HARVEST_TIME) {
      u.harvestTimer = 0;
      const take = Math.min(HARVEST_AMOUNT, map.gold[mineTile]);
      map.gold[mineTile] -= take;
      u.carrying = { kind: 'gold', amount: take };
      if (map.gold[mineTile] <= 0) {
        map.tiles[mineTile] = Tile.Dirt;
        state.blocked[mineTile] = 0;
      }
    }
  } else {
    moveTowardTile(state, u, mineTile, dt);
  }
}

function updateHarvestWood(state: GameState, u: Unit, woodTile: number, dt: number): void {
  if (u.carrying && u.carrying.amount >= HARVEST_AMOUNT) {
    returnResource(state, u, dt);
    return;
  }
  const { map } = state;
  if ((map.tiles[woodTile] as Tile) !== Tile.Forest) {
    const tx = (woodTile % map.width) + 0.5;
    const ty = Math.floor(woodTile / map.width) + 0.5;
    const next = nearestTileOfKind(state, tx, ty, Tile.Forest, 12) ??
      nearestTileOfKind(state, u.x, u.y, Tile.Forest, 12);
    if (next !== null) {
      u.order = { kind: 'harvestWood', tile: next };
      u.path = null;
    } else if (u.carrying && u.carrying.amount > 0) {
      returnResource(state, u, dt);
    } else {
      u.order = { kind: 'idle' };
    }
    return;
  }
  const wx = (woodTile % map.width) + 0.5;
  const wy = Math.floor(woodTile / map.width) + 0.5;
  if (Math.hypot(wx - u.x, wy - u.y) <= GATHER_RANGE) {
    u.path = null;
    if (!u.carrying || u.carrying.kind !== 'wood') u.carrying = { kind: 'wood', amount: 0 };
    const take = Math.min(CHOP_PER_SECOND * dt, map.wood[woodTile], HARVEST_AMOUNT - u.carrying.amount);
    u.carrying.amount += take;
    map.wood[woodTile] -= take;
    if (map.wood[woodTile] <= 0) {
      map.tiles[woodTile] = Tile.Dirt;
      state.blocked[woodTile] = 0;
    }
  } else {
    moveTowardTile(state, u, woodTile, dt);
  }
}

/** Walk to the nearest drop-off and deposit, then resume the current order. */
function returnResource(state: GameState, u: Unit, dt: number): void {
  if (!u.carrying || u.carrying.amount <= 0) return;
  const drop = nearestDropOff(state, u, u.carrying.kind);
  if (!drop) {
    // No drop-off left; hold the load and wait.
    u.path = null;
    return;
  }
  if (distToBuilding(drop, u.x, u.y) <= DEPOSIT_RANGE) {
    const player = playerOf(state, u.faction);
    const amount = u.carrying.amount * player.harvestBonus;
    if (u.carrying.kind === 'gold') player.gold += amount;
    else player.wood += amount;
    u.carrying = null;
    u.path = null;
    return;
  }
  approachBuildingRaw(state, u, drop, dt);
}

// ---------------------------------------------------------------------------
// Path following & local avoidance

function moveTowardTile(state: GameState, u: Unit, tile: number, dt: number): void {
  if (!u.path) {
    if (!requestPath(state, u, tile, true)) {
      u.order = { kind: 'idle' };
      return;
    }
  }
  followPathRaw(state, u, dt);
}

function approachBuilding(state: GameState, ctx: SimContext, u: Unit, b: Building, dt: number): void {
  void ctx;
  approachBuildingRaw(state, u, b, dt);
}

function approachBuildingRaw(state: GameState, u: Unit, b: Building, dt: number): void {
  if (!u.path || u.repathCooldown <= 0) {
    const c = buildingCenter(b);
    u.repathCooldown = REPATH_INTERVAL * 2;
    requestPath(state, u, tileIndexAt(state.map, c.x, c.y), true);
  }
  followPathRaw(state, u, dt);
}

type PathStatus = 'none' | 'moving' | 'arrived' | 'stuck';

/** Follow the current path; handles stuck detection and re-pathing. */
function followPath(state: GameState, ctx: SimContext, u: Unit, dt: number): PathStatus {
  void ctx;
  return followPathRaw(state, u, dt);
}

function followPathRaw(state: GameState, u: Unit, dt: number): PathStatus {
  if (!u.path || u.pathStep >= u.path.length) {
    u.path = null;
    return 'arrived';
  }
  const speed = UNIT_STATS[u.type].speed;
  const step = speed * dt;
  const wp = u.path[u.pathStep];
  const wx = (wp % state.map.width) + 0.5;
  const wy = Math.floor(wp / state.map.width) + 0.5;

  // If the next waypoint tile got blocked (new building / regrown forest),
  // drop the path; the order handler will re-request one.
  if (state.blocked[wp]) {
    u.path = null;
    return 'stuck';
  }

  const dx = wx - u.x;
  const dy = wy - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= Math.max(step, 0.12)) {
    u.x = wx;
    u.y = wy;
    u.pathStep++;
    if (u.pathStep >= u.path.length) {
      u.path = null;
      return 'arrived';
    }
    return 'moving';
  }
  const nx = u.x + (dx / dist) * step;
  const ny = u.y + (dy / dist) * step;
  const moved = tryMove(state, u, nx, ny);
  if (moved < step * 0.25) {
    u.stuckTime += dt;
    if (u.stuckTime > STUCK_SETTLE_TIME) {
      u.stuckTime = 0;
      u.path = null;
      return 'stuck';
    }
  } else {
    u.stuckTime = Math.max(0, u.stuckTime - dt * 0.5);
  }
  return 'moving';
}

/**
 * Net-displacement watchdog evaluated after collision resolution. A unit
 * with a movement-type order that barely moved this tick accumulates stuck
 * time; once over the threshold it settles (if near its goal) or re-paths.
 */
function detectCrowdStuck(_state: GameState, ctx: SimContext, u: Unit, dt: number): void {
  const order = u.order;
  if (order.kind !== 'move' && order.kind !== 'attackMove') return;
  if (u.autoTargetId !== null || !u.path) return;
  const expected = UNIT_STATS[u.type].speed * dt;
  const moved = Math.hypot(u.x - u.prevX, u.y - u.prevY);
  if (moved < expected * 0.3) {
    u.stuckTime += dt;
    if (u.stuckTime > STUCK_SETTLE_TIME) {
      u.stuckTime = 0;
      const d = Math.hypot(order.x - u.x, order.y - u.y);
      // Big groups pack into wide rings: every group-mate that already
      // settled on the same goal pushes the acceptable arrival distance out
      // a little. Unrelated idle units (e.g. workers) do not count.
      const settledNear = ctx.spatial
        .query(u.x, u.y, 2.5)
        .filter(
          (v) =>
            v !== u &&
            v.settled &&
            v.faction === u.faction &&
            v.lastGoalX !== null &&
            v.lastGoalY !== null &&
            Math.hypot(v.lastGoalX - order.x, v.lastGoalY - order.y) < 2.5,
        ).length;
      if (d <= SETTLE_NEAR_GOAL_DIST + 0.4 * settledNear) {
        u.order = { kind: 'idle' };
        u.settled = true;
        u.path = null;
        u.lastGoalX = order.x;
        u.lastGoalY = order.y;
      } else {
        u.path = null; // re-path around the obstruction next tick
      }
    }
  } else {
    u.stuckTime = Math.max(0, u.stuckTime - dt);
  }
}

/**
 * A move/attack-move unit blocked near a crowded destination settles instead
 * of shoving forever: this is what lets groups arrive without oscillation.
 */
function maybeSettleNear(state: GameState, u: Unit, gx: number, gy: number, status: PathStatus): void {
  if (status !== 'stuck') return;
  const d = Math.hypot(gx - u.x, gy - u.y);
  if (d <= SETTLE_NEAR_GOAL_DIST) {
    u.order = { kind: 'idle' };
    u.settled = true;
    u.path = null;
    u.lastGoalX = gx;
    u.lastGoalY = gy;
  }
  // Otherwise leave the order; a fresh path will be requested next tick.
  void state;
}

/** Axis-sliding move that never enters blocked tiles. Returns distance moved. */
function tryMove(state: GameState, u: Unit, nx: number, ny: number): number {
  const ox = u.x;
  const oy = u.y;
  const apply = (x: number, y: number): boolean => {
    const cx = Math.min(Math.max(x, UNIT_RADIUS), state.map.width - UNIT_RADIUS);
    const cy = Math.min(Math.max(y, UNIT_RADIUS), state.map.height - UNIT_RADIUS);
    if (state.blocked[idx(state.map, Math.floor(cx), Math.floor(cy))]) return false;
    u.x = cx;
    u.y = cy;
    return true;
  };
  if (!apply(nx, ny) && !apply(nx, oy) && !apply(ox, ny)) {
    return 0;
  }
  return Math.hypot(u.x - ox, u.y - oy);
}

/** Pairwise separation so units do not stack; settled units yield less. */
function resolveUnitCollisions(state: GameState, ctx: SimContext): void {
  const minDist = UNIT_RADIUS * 2;
  for (const u of state.units) {
    const neighbours = ctx.spatial.query(u.x, u.y, minDist + 0.2);
    for (const v of neighbours) {
      if (v.id <= u.id) continue;
      let dx = v.x - u.x;
      let dy = v.y - u.y;
      let d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      if (d < 1e-4) {
        // Perfectly stacked: split along a deterministic pseudo-random axis.
        const ang = ((u.id * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      }
      const overlap = (minDist - d) / 2;
      const px = (dx / d) * overlap;
      const py = (dy / d) * overlap;
      nudge(state, u, -px, -py);
      nudge(state, v, px, py);
    }
  }
}

function nudge(state: GameState, u: Unit, dx: number, dy: number): void {
  const nx = u.x + dx;
  const ny = u.y + dy;
  const cx = Math.min(Math.max(nx, UNIT_RADIUS), state.map.width - UNIT_RADIUS);
  const cy = Math.min(Math.max(ny, UNIT_RADIUS), state.map.height - UNIT_RADIUS);
  if (!state.blocked[idx(state.map, Math.floor(cx), Math.floor(cy))]) {
    u.x = cx;
    u.y = cy;
  }
}

// ---------------------------------------------------------------------------
// Buildings

function updateBuilding(state: GameState, ctx: SimContext, b: Building, dt: number): void {
  if (!b.constructed) return;
  const stats = BUILDING_STATS[b.type];

  // Training.
  if (b.trainQueue.length > 0) {
    const head = b.trainQueue[0];
    head.remaining -= dt;
    if (head.remaining <= 0) {
      b.trainQueue.shift();
      const c = buildingCenter(b);
      const spot = findFreeSpotNear(state, c.x, c.y + stats.height / 2 + 0.5);
      spawnUnit(state, b.faction, head.unit, spot.x, spot.y);
    }
  }

  // Tower combat.
  if (stats.damage > 0) {
    if (b.cooldown > 0) b.cooldown -= dt;
    if (b.cooldown <= 0) {
      const c = buildingCenter(b);
      let best: Unit | null = null;
      let bestDist = Infinity;
      for (const enemy of ctx.spatial.query(c.x, c.y, stats.range + 1)) {
        if (enemy.faction === b.faction || enemy.hp <= 0) continue;
        const d = distToBuilding(b, enemy.x, enemy.y);
        if (d <= stats.range && d < bestDist) {
          bestDist = d;
          best = enemy;
        }
      }
      if (best) {
        b.cooldown = stats.cooldown;
        state.projectiles.push({
          x: c.x,
          y: c.y,
          targetId: best.id,
          targetIsBuilding: false,
          speed: PROJECTILE_SPEED,
          damage: stats.damage,
          faction: b.faction,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Projectiles, damage, death

function updateProjectiles(state: GameState, dt: number): void {
  const survivors: typeof state.projectiles = [];
  for (const p of state.projectiles) {
    let tx: number;
    let ty: number;
    const targetUnit = p.targetIsBuilding ? undefined : findUnit(state, p.targetId);
    const targetBuilding = p.targetIsBuilding ? findBuilding(state, p.targetId) : undefined;
    if (targetUnit && targetUnit.hp > 0) {
      tx = targetUnit.x;
      ty = targetUnit.y;
    } else if (targetBuilding) {
      const c = buildingCenter(targetBuilding);
      tx = c.x;
      ty = c.y;
    } else {
      continue; // target gone; the projectile dissipates
    }
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (dist <= Math.max(step, 0.35)) {
      if (targetUnit) applyDamageToUnit(state, targetUnit, p.damage, null);
      else if (targetBuilding) applyDamageToBuilding(state, targetBuilding, p.damage);
      continue;
    }
    p.x += (dx / dist) * step;
    p.y += (dy / dist) * step;
    survivors.push(p);
  }
  state.projectiles = survivors;
}

export function applyDamageToUnit(
  _state: GameState,
  target: Unit,
  rawDamage: number,
  attackerId: number | null,
): void {
  target.hp -= computeDamage(rawDamage, UNIT_STATS[target.type].armor);
  // Idle military units fight back when hit.
  if (
    attackerId !== null &&
    target.hp > 0 &&
    target.type !== UnitType.Worker &&
    target.order.kind === 'idle' &&
    target.autoTargetId === null
  ) {
    target.autoTargetId = attackerId;
  }
}

export function applyDamageToBuilding(state: GameState, target: Building, rawDamage: number): void {
  target.hp -= computeDamage(rawDamage, BUILDING_STATS[target.type].armor);
  void state;
}

function sweepDead(state: GameState): void {
  for (let i = state.units.length - 1; i >= 0; i--) {
    const u = state.units[i];
    if (u.hp > 0) continue;
    state.corpses.push({ x: u.x, y: u.y, faction: u.faction, unitType: u.type, age: 0 });
    state.units.splice(i, 1);
  }
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    const b = state.buildings[i];
    if (b.hp > 0) continue;
    destroyBuilding(state, b);
  }
}

function checkGameOver(state: GameState): void {
  const playerHas = state.buildings.some((b) => b.faction === state.players[0].faction);
  const aiHas = state.buildings.some((b) => b.faction === state.players[1].faction);
  if (!playerHas) state.result = 'defeat';
  else if (!aiHas) state.result = 'victory';
}

// ---------------------------------------------------------------------------
// Convenience for spawning around buildings (used by tests/AI)

export function adjacentFreeTile(state: GameState, b: Building): { x: number; y: number } | null {
  const stats = BUILDING_STATS[b.type];
  for (let y = b.ty - 1; y <= b.ty + stats.height; y++) {
    for (let x = b.tx - 1; x <= b.tx + stats.width; x++) {
      if (!inBounds(state.map, x, y)) continue;
      if (!state.blocked[idx(state.map, x, y)]) return { x: x + 0.5, y: y + 0.5 };
    }
  }
  return null;
}
