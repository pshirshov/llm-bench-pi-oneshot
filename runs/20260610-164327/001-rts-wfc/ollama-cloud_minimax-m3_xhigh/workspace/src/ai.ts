// Scripted-strategy AI for the opposing faction.
//
// Strategy:
//   - Maintain ~3-4 workers on gold and ~2 on wood (decided by need).
//   - Build order: supply ahead of demand, barracks, lumber mill, tower defense.
//   - Train a mixed army continuously; on cooldown, the AI sends escalating
//     attack waves at the player's base (first wave within ~4 minutes at
//     difficulty 1).
//   - Defend by pulling military units to threats.
//   - Rebuild destroyed buildings.

import { type World, type UnitEntity, type BuildingEntity } from './state.js';
import { TILES, type BuildingKind, type UnitKind, UNIT_STATS, type FactionId } from './data.js';
import { dist2, chebyshev } from './math.js';
import { canTrain, orderAttack, tryQueueBuilding, pathToTile, isBuildable, tick as simTick } from './sim.js';
// Many imports retained for potential future expansion; mark intentionally unused
// ones as type-only or void them at module load to satisfy strict noUnused.
void TILES; void dist2; void simTick;

interface AIState {
  // Track per-wave: last wave time, wave number
  lastWaveTime: number;
  waveNumber: number;
  // Per-spawn: build queue for the AI
  buildPlan: { kind: BuildingKind; priority: number; queued: boolean }[];
  // Defensive tower positions to maintain
  towerPlanned: number;
  // Resource thresholds to maintain
  // Throttle for refreshBuildPlan
  planTickStamp: number;
  // Throttle: last sim time we ran strategic decisions
  lastStrategicTime: number;
}

const AI_STATES = new WeakMap<World, Map<FactionId, AIState>>();

function getState(w: World, faction: FactionId): AIState {
  let m = AI_STATES.get(w);
  if (!m) { m = new Map(); AI_STATES.set(w, m); }
  let s = m.get(faction);
  if (!s) {
    s = {
      lastWaveTime: 0,
      waveNumber: 0,
      buildPlan: [],
      towerPlanned: 0,
      planTickStamp: -1,
      lastStrategicTime: -1,
    };
    m.set(faction, s);
  }
  return s;
}

const TARGET_POP = { 1: 16, 2: 22, 3: 28, 4: 36, 5: 48 } as const;
const WAVE_DELAY = { 1: 240, 2: 200, 3: 160, 4: 120, 5: 90 } as const; // seconds between waves
const WAVE_FIRST = { 1: 220, 2: 180, 3: 150, 4: 120, 5: 90 } as const;  // first wave at this time

function countUnits(w: World, faction: FactionId): Record<UnitKind, number> {
  const r: Record<UnitKind, number> = { worker: 0, melee: 0, ranged: 0, heavy: 0 };
  for (const u of w.units.values()) {
    if (u.faction !== faction || u.hp <= 0) continue;
    r[u.unitKind]++;
  }
  return r;
}

function countBuildings(w: World, faction: FactionId, bk: BuildingKind): number {
  let n = 0;
  for (const b of w.buildings.values()) if (b.faction === faction && b.buildingKind === bk) n++;
  return n;
}

function nearestEnemyBase(w: World, faction: FactionId): { x: number; y: number } | null {
  // pick a random surviving enemy building
  const enemies: BuildingEntity[] = [];
  for (const b of w.buildings.values()) {
    if (b.faction === faction || b.hp <= 0) continue;
    enemies.push(b);
  }
  if (enemies.length === 0) return null;
  // pick the one that's structurally most important: a town hall if any
  const th = enemies.find((b) => b.buildingKind === 'townhall');
  if (th) return { x: th.pos.x + th.size.w / 2, y: th.pos.y + th.size.h / 2 };
  const e = enemies[Math.floor(Math.random() * enemies.length)] as BuildingEntity;
  return { x: e.pos.x + e.size.w / 2, y: e.pos.y + e.size.h / 2 };
}
function pickBuildSpot(w: World, faction: FactionId, bk: BuildingKind): { x: number; y: number } | null {
  // walk through tiles near the AI's town hall, find a buildable one
  let th: BuildingEntity | null = null;
  for (const b of w.buildings.values()) {
    if (b.faction === faction && b.buildingKind === 'townhall') { th = b; break; }
  }
  if (!th) return null;
  type Size = { w: number; h: number };
  const sizes: Record<BuildingKind, Size> = {
    farm: { w: 2, h: 2 },
    barracks: { w: 3, h: 2 },
    mill: { w: 2, h: 2 },
    tower: { w: 1, h: 1 },
    townhall: { w: 3, h: 3 },
  };
  const stats = sizes[bk];
  // try an expanding ring of positions around the town hall
  for (let r = 4; r < 12; r++) {
    for (let dy = -r; dy <= r; dy += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        const x = Math.floor(th.pos.x + th.size.w / 2) + dx;
        const y = Math.floor(th.pos.y + th.size.h / 2) + dy;
        if (isBuildable(w, x, y, stats.w, stats.h)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

function armyComposition(difficulty: number, wave: number): { melee: number; ranged: number; heavy: number } {
  const base = { melee: 2, ranged: 1, heavy: 0 };
  // Scale by difficulty
  const d = Math.min(5, Math.max(1, difficulty));
  const scale = 1 + (d - 1) * 0.5;
  let { melee, ranged, heavy } = base;
  melee = Math.round(melee * scale + wave * 0.5);
  ranged = Math.round(ranged * scale + wave * 0.3);
  heavy = Math.round((wave >= 2 ? 1 : 0) + wave * 0.2);
  return { melee, ranged, heavy };
}

function refreshBuildPlan(w: World, faction: FactionId, difficulty: number, s: AIState): void {
  // Cache: only refresh every 5 sim seconds
  if (s.planTickStamp >= 0 && w.time - s.planTickStamp < 5) return;
  s.planTickStamp = w.time;
  const counts = countBuildings(w, faction, 'townhall');
  if (counts === 0) {
    s.buildPlan = [];
    return;
  }
  const supplyCap = w.factions[faction].supplyCap;
  const supplyUsed = w.factions[faction].supplyUsed;
  const plan: { kind: BuildingKind; priority: number; queued: boolean }[] = [];
  // Supply ahead of demand
  if (supplyCap - supplyUsed < 6) plan.push({ kind: 'farm', priority: 100, queued: false });
  // Barracks
  if (countBuildings(w, faction, 'barracks') < 1) plan.push({ kind: 'barracks', priority: 90, queued: false });
  else if (countBuildings(w, faction, 'barracks') < 2 && difficulty >= 3) plan.push({ kind: 'barracks', priority: 50, queued: false });
  // Mill (required for ranged/heavy)
  if (countBuildings(w, faction, 'mill') < 1) plan.push({ kind: 'mill', priority: 80, queued: false });
  else if (countBuildings(w, faction, 'mill') < 2 && difficulty >= 4) plan.push({ kind: 'mill', priority: 40, queued: false });
  // Defense towers
  const desiredTowers = Math.min(2, 1 + Math.floor((difficulty - 1) / 2));
  if (s.towerPlanned < desiredTowers) plan.push({ kind: 'tower', priority: 30, queued: false });
  plan.sort((a, b) => b.priority - a.priority);
  s.buildPlan = plan;
}

function maintainBuildOrder(w: World, faction: FactionId, difficulty: number, s: AIState): void {
  refreshBuildPlan(w, faction, difficulty, s);
  // Try to place one building per tick
  for (const item of s.buildPlan) {
    if (item.queued) continue;
    type Cost = { gold: number; wood: number };
    const costs: Record<BuildingKind, Cost> = {
      farm: { gold: 400, wood: 50 },
      barracks: { gold: 700, wood: 200 },
      mill: { gold: 500, wood: 100 },
      tower: { gold: 600, wood: 100 },
      townhall: { gold: 0, wood: 0 },
    };
    const stats = costs[item.kind];
    const f = w.factions[faction];
    if (f.gold < stats.gold || f.wood < stats.wood) continue;
    const spot = pickBuildSpot(w, faction, item.kind);
    if (!spot) continue;
    const b = tryQueueBuilding(w, faction, item.kind, spot.x, spot.y);
    if (b) {
      item.queued = true;
      if (item.kind === 'tower') s.towerPlanned++;
    }
  }
  // Rebuild any destroyed town hall / mill if they were destroyed
  for (const item of [...s.buildPlan]) {
    if (!item.queued) continue;
    const exists = Array.from(w.buildings.values()).some((b) => b.faction === faction && b.buildingKind === item.kind);
    if (!exists) item.queued = false; // re-queue
  }
}

function ensureWorkerSaturation(w: World, faction: FactionId): void {
  const counts = countUnits(w, faction);
  const desiredWorkers = 6 + Math.min(4, Math.floor((w.factions[faction].supplyCap - 10) / 4));
  if (counts.worker >= desiredWorkers) return;
  // train a worker at the town hall
  for (const b of w.buildings.values()) {
    if (b.faction !== faction || b.buildingKind !== 'townhall' || b.underConstruction) continue;
    if (b.trainQueue.length >= 2) continue;
    if (!canTrain(w, faction, 'worker')) continue;
    // manually queue
    if (b.trainQueue.length === 0 || b.trainQueue[0] !== 'worker') {
      const stats = UNIT_STATS.worker;
      w.factions[faction].gold -= stats.cost.gold;
      w.factions[faction].wood -= stats.cost.wood;
      b.trainQueue.push('worker');
    }
  }
}

function maintainTraining(w: World, faction: FactionId, difficulty: number, _s: AIState): void {
  const target = TARGET_POP[difficulty as 1 | 2 | 3 | 4 | 5] ?? 16;
  // Count supplyUsed
  const used = w.factions[faction].supplyUsed;
  if (used >= target) return;
  // Pick a building to train at
  const candidates: BuildingEntity[] = [];
  for (const b of w.buildings.values()) {
    if (b.faction !== faction || b.underConstruction) continue;
    if (b.buildingKind === 'townhall' || b.buildingKind === 'barracks') candidates.push(b);
  }
  if (candidates.length === 0) return;
  // Decide what to train: 60% melee, 30% ranged, 10% heavy (if mill built)
  const hasMill = countBuildings(w, faction, 'mill') > 0;
  const _pick: UnitKind = (() => {
    const r = Math.random();
    if (hasMill && r < 0.15) return 'heavy';
    if (hasMill && r < 0.45) return 'ranged';
    return 'melee';
  })();
  void _pick;
  // try queue — for each candidate barracks, queue whatever we can afford
  let queued = false;
  for (const b of candidates) {
    if (queued) break;
    if (b.trainQueue.length >= 2) continue;
    if (b.buildingKind !== 'barracks') continue;
    // Pick a unit kind that this building can actually train right now
    const opts: UnitKind[] = hasMill ? ['melee', 'ranged', 'heavy'] : ['melee'];
    for (const k of opts) {
      if (!canTrain(w, faction, k)) continue;
      const stats = UNIT_STATS[k];
      w.factions[faction].gold -= stats.cost.gold;
      w.factions[faction].wood -= stats.cost.wood;
      b.trainQueue.push(k);
      queued = true;
      break;
    }
  }
}

function maybeSendWave(w: World, faction: FactionId, difficulty: number, s: AIState): void {
  if (s.waveNumber === 0) {
    if (w.time < WAVE_FIRST[difficulty as 1 | 2 | 3 | 4 | 5]) return;
  } else {
    if (w.time - s.lastWaveTime < WAVE_DELAY[difficulty as 1 | 2 | 3 | 4 | 5]) return;
  }
  const comp = armyComposition(difficulty, s.waveNumber + 1);
  const required = comp.melee + comp.ranged + comp.heavy;
  // gather idle military units
  const mil: UnitEntity[] = [];
  for (const u of w.units.values()) {
    if (u.faction !== faction || u.hp <= 0) continue;
    if (u.unitKind === 'worker') continue;
    mil.push(u);
  }
  if (mil.length < Math.max(1, Math.floor(required * 0.6))) return; // not enough yet
  // send the mil that aren't in combat
  const target = nearestEnemyBase(w, faction);
  if (!target) return;
  for (const u of mil) {
    u.order = { kind: 'attackMove', tx: target.x, ty: target.y };
    pathToTile(w, u, Math.floor(target.x), Math.floor(target.y));
  }
  s.waveNumber++;
  s.lastWaveTime = w.time;
}

function defendBase(w: World, faction: FactionId): void {
  // pull military units toward the nearest threat if any
  let th: BuildingEntity | null = null;
  for (const b of w.buildings.values()) {
    if (b.faction === faction && b.buildingKind === 'townhall') { th = b; break; }
  }
  if (!th) return;
  // find any enemy unit within 12 tiles of our town hall
  const cx = th.pos.x + th.size.w / 2;
  const cy = th.pos.y + th.size.h / 2;
  let threat: UnitEntity | null = null;
  let bestD = Infinity;
  for (const u of w.units.values()) {
    if (u.faction === faction || u.hp <= 0) continue;
    const d = chebyshev(Math.floor(cx), Math.floor(cy), u.occ.x, u.occ.y);
    if (d <= 12 && d < bestD) { bestD = d; threat = u; }
  }
  if (!threat) return;
  // pull idle military
  for (const u of w.units.values()) {
    if (u.faction !== faction || u.hp <= 0 || u.unitKind === 'worker') continue;
    if (u.order.kind !== 'idle' && u.order.kind !== 'move') continue;
    orderAttack(w, [u], threat.id);
  }
}

export function aiTick(w: World, faction: FactionId, difficulty: number, _rng: ReturnType<typeof import('./rng.js').makeRng>): void {
  if (faction === 'human' && w.factions.human.faction !== 'human') return; // safety
  if (w.gameOver) return;
  const f = w.factions[faction];
  if (!f.alive) return;
  const s = getState(w, faction);
  // Throttle strategic decisions to 1 Hz instead of 60 Hz — these are
  // coarse plans, not per-tick actions.
  if (w.time - s.lastStrategicTime < 1.0) return;
  s.lastStrategicTime = w.time;
  // 1. Worker saturation
  ensureWorkerSaturation(w, faction);
  // 2. Build order
  maintainBuildOrder(w, faction, difficulty, s);
  // 3. Army training
  maintainTraining(w, faction, difficulty, s);
  // 4. Waves
  maybeSendWave(w, faction, difficulty, s);
  // 5. Defense
  defendBase(w, faction);
}

void simTick;
