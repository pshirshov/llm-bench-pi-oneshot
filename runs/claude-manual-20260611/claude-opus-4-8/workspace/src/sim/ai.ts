/**
 * T16 — Scripted-strategy AI opponent.
 *
 * `phaseAi(world)` is the `ai` phase of `stepWorld` (the FIRST phase each tick,
 * before orders/movement/combat/economy). It is a *controller*: it issues the
 * same orders the human player would (set `building.order = {kind:"train",…}`,
 * `worker.order = build(kind, tile)`, `unit.order = attackMove(tile)`, etc.) and
 * lets the existing economy / movement / combat phases ACT on them. It does NOT
 * re-implement training, construction, harvesting, or combat.
 *
 * ## What the AI does (PROMPT.md "AI opponent")
 * Every `THINK_INTERVAL` ticks (a think-interval AI, not an every-tick one) it,
 * for the AI-controlled faction:
 *   1. Worker saturation — keeps idle workers harvesting (gold AND wood) and
 *      trains more Workers at the Town Hall until a saturation target.
 *   2. Supply-aware build order — builds a Farm BEFORE hitting the supply cap,
 *      then ensures Barracks → Lumber Mill → Guard Tower(s), each placed at a
 *      valid `canPlaceBuilding` anchor near the base by a worker.
 *   3. Continuous mixed army — trains infantry / ranged / heavy at the Barracks
 *      (respecting prerequisites, resources, supply).
 *   4. Escalating attack waves — accumulates military to a wave threshold, then
 *      sends them (attackMove) at the player's base. First wave ≈ 4 min in at
 *      difficulty 1; higher difficulty = sooner + larger; waves escalate.
 *   5. Base defense — if hostiles are near the AI base, recalls military to
 *      engage them (overrides the wave march until the threat clears).
 *   6. Rebuild — if an expected building is missing (destroyed), re-issues a
 *      build order when resources allow.
 *   7. Difficulty 1–5 scaling — a one-time starting-resource grant, a periodic
 *      harvest-rate bonus, and wave size / cadence all scale with difficulty.
 *
 * ## Determinism (CRITICAL)
 * - NO module-level mutable state. All per-faction memory lives on `world.ai`
 *   (lazily initialised here), so two same-seed worlds stepped interleaved stay
 *   bit-identical. The only module-level bindings are immutable constants.
 * - All randomness routes through `world.rng` (a per-think fork); iteration over
 *   entity tables is always in ascending-EntityId order.
 *
 * The AI controls the NON-player faction (`world.playerFaction`'s opponent).
 */

import type { Building, Unit } from "./entity.js";
import type { World } from "./world.js";
import type { AiDifficulty } from "./world.js";
import type { Vec2 } from "../core/vec.js";
import type { BuildingKind, EntityId, Faction, UnitKind } from "../game/types.js";
import { vec } from "../core/vec.js";
import { getBuildingStats, getUnitStats, UNIT_REQUIREMENTS } from "./stats.js";
import { SIM_HZ } from "./tick.js";
import { attackMove, build, harvest } from "./orders.js";

// ---------------------------------------------------------------------------
// Tuning constants (immutable module-level — no mutable state).
// ---------------------------------------------------------------------------

/** Ticks between AI "think" passes. At 30 Hz this is ~1 s — cheap and reactive. */
const THINK_INTERVAL = SIM_HZ; // 30 ticks

/** Worker saturation target (per difficulty index 1..5). Index 0 unused. */
const WORKER_TARGET: readonly number[] = [0, 8, 10, 12, 14, 16];

/**
 * Supply HEADROOM (cap − used) below which the AI pre-emptively builds a Farm,
 * so supply stays ahead of demand. Larger headroom at higher difficulty so the
 * AI never train-stalls on supply.
 */
const FARM_HEADROOM: readonly number[] = [0, 3, 4, 5, 6, 7];

/**
 * Military-unit count that triggers an attack wave, per difficulty (index 1..5).
 * Lower threshold at higher difficulty → waves leave sooner and the AI commits
 * more aggressively. The threshold for wave N is this base PLUS an escalation
 * step per wave already sent (see `waveThreshold`).
 */
const WAVE_BASE_THRESHOLD: readonly number[] = [0, 6, 6, 8, 8, 10];

/** Each successive wave needs this many MORE units than the previous (escalation). */
const WAVE_ESCALATION_STEP = 2;

/**
 * Earliest tick the FIRST wave may launch, per difficulty. Spec: ~4 minutes at
 * difficulty 1, sooner at higher difficulty. 4*60*SIM_HZ = 7200 ticks at d1.
 */
const FIRST_WAVE_TICK: readonly number[] = [
  0,
  4 * 60 * SIM_HZ, // d1: 4:00
  3 * 60 * SIM_HZ, // d2: 3:00
  2 * 60 * SIM_HZ, // d3: 2:00
  90 * SIM_HZ, // d4: 1:30
  60 * SIM_HZ, // d5: 1:00
];

/**
 * One-time starting-resource BONUS granted to the AI faction on its first think,
 * per difficulty (gold, wood). createWorld seeds both factions equally; this is
 * the difficulty handicap layered on top without touching createWorld.
 */
const START_BONUS_GOLD: readonly number[] = [0, 0, 150, 350, 600, 1000];
const START_BONUS_WOOD: readonly number[] = [0, 0, 75, 175, 300, 500];

/**
 * Periodic harvest-rate bonus: extra gold AND wood credited to the AI each think
 * pass, scaled by difficulty and by the number of workers actively harvesting
 * (so it behaves like a *rate* multiplier on real harvesting, not free income to
 * an AI that lost all its workers). Units are resource-per-active-worker-per-think.
 */
const HARVEST_BONUS_PER_WORKER: readonly number[] = [0, 0, 1, 2, 3, 5];

/** Chebyshev radius around the AI base within which a hostile unit counts as a threat. */
const BASE_THREAT_RADIUS = 12;

/** Max ring distance searched for a valid building anchor near the base anchor. */
const MAX_BUILD_SEARCH_RADIUS = 14;

/** Number of Guard Towers the AI eventually wants for static defense. */
const GUARD_TOWER_TARGET = 2;

/**
 * Cap on the AI's standing military (supply-equivalent) so it does not train into
 * an unbounded swarm; keeps the headless test cheap and the match winnable.
 */
const ARMY_SUPPLY_SOFT_CAP = 40;

/** The trainable military unit kinds (the UnitKind subset excluding "worker"). */
type MilitaryKind = "infantry" | "ranged" | "heavy";

/** The desired military composition as relative weights (infantry, ranged, heavy). */
type ArmyMix = Record<MilitaryKind, number>;
const ARMY_MIX: ArmyMix = { infantry: 3, ranged: 2, heavy: 1 };

// ---------------------------------------------------------------------------
// AI memory (stored on world.ai — never module-level).
// ---------------------------------------------------------------------------

/** Phase of an attack wave's lifecycle. */
type WavePhase = "gathering" | "marching";

/**
 * Per-faction AI memory. Lives at `world.ai[faction]`. Mutable, but per-world —
 * two worlds never share an instance, so interleaved same-seed stepping stays
 * deterministic.
 */
interface AIMemory {
  /** Tick of the last think pass (−THINK_INTERVAL sentinel so it acts on tick 0+). */
  lastThink: number;
  /** True once the one-time difficulty start bonus has been granted. */
  startBonusGranted: boolean;
  /** Number of attack waves already dispatched (drives escalation + cadence). */
  wavesSent: number;
  /** Current wave lifecycle phase. */
  wavePhase: WavePhase;
  /** EntityIds of units committed to the current marching wave. */
  waveUnits: EntityId[];
  /** Cached base anchor (Town Hall top-left tile) — recomputed if the hall moves. */
  baseAnchor: Vec2 | null;
}

/**
 * Returns the AI memory for `faction`, initialising it on first access. The
 * initial `lastThink` is set so the AI thinks on its very first eligible tick.
 */
function memoryFor(world: World, faction: Faction): AIMemory {
  if (world.ai === undefined) world.ai = {};
  const existing = world.ai[faction] as AIMemory | undefined;
  if (existing !== undefined) return existing;
  const fresh: AIMemory = {
    lastThink: -THINK_INTERVAL,
    startBonusGranted: false,
    wavesSent: 0,
    wavePhase: "gathering",
    waveUnits: [],
    baseAnchor: null,
  };
  world.ai[faction] = fresh;
  return fresh;
}

// ---------------------------------------------------------------------------
// Faction / entity helpers (deterministic, ascending-id iteration).
// ---------------------------------------------------------------------------

/** The faction opposing `f`. */
function opponentOf(f: Faction): Faction {
  return f === "human" ? "orc" : "human";
}

/** Units owned by `faction`, in ascending EntityId order. */
function ownedUnits(world: World, faction: Faction): Unit[] {
  return [...world.units.values()]
    .filter((u) => u.owner === faction)
    .sort((a, b) => a.id - b.id);
}

/** Completed buildings owned by `faction`, ascending EntityId order. */
function ownedBuildings(world: World, faction: Faction, completedOnly: boolean): Building[] {
  return [...world.buildings.values()]
    .filter((b) => b.owner === faction && (!completedOnly || b.buildProgress >= 1))
    .sort((a, b) => a.id - b.id);
}

/** Count of completed buildings of `kind` owned by `faction`. */
function countBuildings(world: World, faction: Faction, kind: BuildingKind, completedOnly: boolean): number {
  let n = 0;
  for (const b of world.buildings.values()) {
    if (b.owner !== faction || b.kind !== kind) continue;
    if (completedOnly && b.buildProgress < 1) continue;
    n++;
  }
  return n;
}

/** True iff the faction has at least one building of `kind` (any progress). */
function hasBuildingAnyProgress(world: World, faction: Faction, kind: BuildingKind): boolean {
  for (const b of world.buildings.values()) {
    if (b.owner === faction && b.kind === kind) return true;
  }
  return false;
}

/** The faction's Town Hall (completed preferred, else any), or null. */
function townHall(world: World, faction: Faction): Building | null {
  let fallback: Building | null = null;
  for (const b of ownedBuildings(world, faction, false)) {
    if (b.kind !== "townHall") continue;
    if (b.buildProgress >= 1) return b;
    if (fallback === null) fallback = b;
  }
  return fallback;
}

/** Center tile of a building footprint (integer). */
function buildingCenterTile(b: Building): Vec2 {
  return vec(b.tile.x + Math.floor(b.footprint.w / 2), b.tile.y + Math.floor(b.footprint.h / 2));
}

/**
 * The AI's base anchor — its Town Hall's top-left tile, cached in memory. Falls
 * back to any owned building's tile if the hall is gone (so rebuild still has a
 * reference point).
 */
function baseAnchorOf(world: World, faction: Faction, mem: AIMemory): Vec2 | null {
  const hall = townHall(world, faction);
  if (hall !== null) {
    mem.baseAnchor = hall.tile;
    return hall.tile;
  }
  if (mem.baseAnchor !== null) return mem.baseAnchor;
  const any = ownedBuildings(world, faction, false)[0];
  if (any !== undefined) {
    mem.baseAnchor = any.tile;
    return any.tile;
  }
  return null;
}

/** True iff the unit is military (not a worker). */
function isMilitary(u: Unit): boolean {
  return u.kind !== "worker";
}

/** True iff the worker is currently busy (harvesting, building, or repairing). */
function workerIsBusy(u: Unit): boolean {
  if (u.harvestState !== undefined) return true;
  if (u.buildState !== undefined) return true;
  const k = u.order.kind;
  return k === "harvest" || k === "build" || k === "repair";
}

// ---------------------------------------------------------------------------
// Placement: find a valid build anchor near the base.
// ---------------------------------------------------------------------------

/**
 * Finds the in-bounds anchor closest to `near` (outward Chebyshev rings, then
 * row-major within a ring) whose `footprint` passes `canPlaceBuilding`. Returns
 * null if none exists within MAX_BUILD_SEARCH_RADIUS. Deterministic (fixed scan
 * order, no RNG) — mirrors the world.ts ring-scan placement convention.
 */
function findBuildAnchor(world: World, near: Vec2, footprint: { w: number; h: number }): Vec2 | null {
  const map = world.map;
  const seen = new Set<number>();
  const stride = map.width;
  for (let d = 0; d <= MAX_BUILD_SEARCH_RADIUS; d++) {
    const minX = near.x - d;
    const maxX = near.x + d;
    const minY = near.y - d;
    const maxY = near.y + d;
    for (let ay = minY; ay <= maxY; ay++) {
      for (let ax = minX; ax <= maxX; ax++) {
        // Only perimeter cells first reached at this ring distance.
        const onRing = ax === minX || ax === maxX || ay === minY || ay === maxY;
        if (!onRing) continue;
        if (!map.inBounds(ax, ay)) continue;
        const key = ay * stride + ax;
        if (seen.has(key)) continue;
        seen.add(key);
        const anchor = vec(ax, ay);
        if (map.canPlaceBuilding(anchor, footprint)) return anchor;
      }
    }
  }
  return null;
}

/**
 * Picks an idle (or harvesting — interruptible) worker nearest to `anchor` to
 * assign a job to. Prefers a truly-idle worker; falls back to the nearest
 * harvesting worker so construction is never starved. Returns null if no worker
 * exists. Deterministic: nearest by Chebyshev, ties → lowest EntityId.
 */
function pickBuilderWorker(world: World, faction: Faction, anchor: Vec2): Unit | null {
  let idleBest: Unit | null = null;
  let idleDist = Number.POSITIVE_INFINITY;
  let busyBest: Unit | null = null;
  let busyDist = Number.POSITIVE_INFINITY;
  for (const u of ownedUnits(world, faction)) {
    if (u.kind !== "worker") continue;
    const d = Math.max(Math.abs(Math.floor(u.pos.x) - anchor.x), Math.abs(Math.floor(u.pos.y) - anchor.y));
    const constructing = u.buildState !== undefined || u.order.kind === "build";
    if (constructing) continue; // never poach a worker mid-construction
    if (!workerIsBusy(u)) {
      if (d < idleDist) {
        idleDist = d;
        idleBest = u;
      }
    } else if (d < busyDist) {
      busyDist = d;
      busyBest = u;
    }
  }
  return idleBest ?? busyBest;
}

/** Clears a unit's movement/harvest scratch so a fresh order takes effect cleanly. */
function resetUnitForNewOrder(u: Unit): void {
  u.path = undefined;
  u.arrival = undefined;
  u.pinned = undefined;
  u.harvestState = undefined;
  u.buildState = undefined;
  u.target = undefined;
}

/**
 * Issues a build order for `kind` to the nearest available worker at a valid
 * anchor near the base. Returns true if an order was issued (a worker + anchor
 * were found and the faction can afford it), false otherwise.
 */
function tryIssueBuild(world: World, faction: Faction, kind: BuildingKind, baseAnchor: Vec2): boolean {
  const stats = getBuildingStats(faction, kind);
  const player = world.players[faction];
  if (player.gold < stats.goldCost || player.wood < stats.woodCost) return false;

  const anchor = findBuildAnchor(world, baseAnchor, stats.footprint);
  if (anchor === null) return false;

  const worker = pickBuilderWorker(world, faction, anchor);
  if (worker === null) return false;

  resetUnitForNewOrder(worker);
  worker.order = build(kind, anchor);
  return true;
}

// ---------------------------------------------------------------------------
// Worker economy: saturation + idle reassignment.
// ---------------------------------------------------------------------------

/**
 * Assigns every idle worker a harvest order (the economy phase routes it to the
 * nearest needed resource — gold or wood — via its own nearest-resource logic).
 * A worker with no active harvest/build/repair and not already carrying is
 * considered idle.
 */
function saturateWorkers(world: World, faction: Faction): void {
  for (const u of ownedUnits(world, faction)) {
    if (u.kind !== "worker") continue;
    if (workerIsBusy(u)) continue;
    if (u.carrying !== undefined) continue;
    // Idle worker → send it harvesting. The economy phase's bootstrap picks the
    // nearest live gold mine or forest and runs the full APPROACH→…→DEPOSIT cycle.
    resetUnitForNewOrder(u);
    u.order = harvest(u.id); // targetId is ignored by the economy bootstrap (it scans for nearest resource)
  }
}

/**
 * Trains Workers at the Town Hall until the difficulty's saturation target, if
 * resources/supply allow. Sets the hall's `train` order; the economy phase
 * validates affordability/supply/prerequisites and enqueues (or rejects) it.
 */
function trainWorkers(world: World, faction: Faction, difficulty: AiDifficulty): void {
  const hall = townHall(world, faction);
  if (hall === null || hall.buildProgress < 1) return;
  if (hall.trainQueue.length > 0) return; // already producing a worker

  const target = WORKER_TARGET[difficulty];
  const workerCount = ownedUnits(world, faction).filter((u) => u.kind === "worker").length;
  // Count workers already queued anywhere so we don't overshoot.
  const queuedWorkers = countQueued(world, faction, "worker");
  if (workerCount + queuedWorkers >= target) return;

  const stats = getUnitStats(faction, "worker");
  const player = world.players[faction];
  if (player.gold < stats.goldCost) return;
  if (player.supplyUsed + stats.supplyCost > player.supplyCap) return;

  hall.order = { kind: "train", unitKind: "worker" };
}

/** Total queued training jobs of `unitKind` across all of the faction's buildings. */
function countQueued(world: World, faction: Faction, unitKind: UnitKind): number {
  let n = 0;
  for (const b of world.buildings.values()) {
    if (b.owner !== faction) continue;
    for (const job of b.trainQueue) {
      if (job.unitKind === unitKind) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Build order: Farm (supply-ahead) → Barracks → Lumber Mill → Guard Towers.
// ---------------------------------------------------------------------------

/**
 * Executes the supply-aware build order. Issues AT MOST ONE build order per
 * think pass (so workers are not all yanked off harvesting at once), in priority
 * order. Returns nothing; affordability is checked inside `tryIssueBuild`.
 *
 * Priority:
 *   1. Farm if supply headroom is low AND no Farm is already under construction
 *      (supply ahead of demand).
 *   2. Barracks if none exists (gateway to all military).
 *   3. Lumber Mill if none exists (unlocks ranged + heavy, second wood drop-off).
 *   4. Guard Tower up to GUARD_TOWER_TARGET (static base defense).
 *   5. A second Farm if supply is still tight near the cap.
 */
function runBuildOrder(world: World, faction: Faction, difficulty: AiDifficulty, baseAnchor: Vec2): void {
  const player = world.players[faction];

  // 1. Supply-ahead Farm. Only one Farm in flight at a time.
  const headroom = player.supplyCap - player.supplyUsed;
  const farmInFlight = anyUnderConstruction(world, faction, "farm");
  if (headroom <= FARM_HEADROOM[difficulty] && !farmInFlight && player.supplyCap < 80) {
    if (tryIssueBuild(world, faction, "farm", baseAnchor)) return;
  }

  // 2. Barracks (gateway). Build if none exists at all (any progress).
  if (!hasBuildingAnyProgress(world, faction, "barracks")) {
    if (tryIssueBuild(world, faction, "barracks", baseAnchor)) return;
  }

  // 3. Lumber Mill (needs Barracks complete — economy enforces the prereq).
  if (
    countBuildings(world, faction, "barracks", true) > 0 &&
    !hasBuildingAnyProgress(world, faction, "lumberMill")
  ) {
    if (tryIssueBuild(world, faction, "lumberMill", baseAnchor)) return;
  }

  // 4. Guard Towers (needs Barracks complete). Build up to the target.
  if (countBuildings(world, faction, "barracks", true) > 0) {
    const towers = countBuildings(world, faction, "guardTower", false);
    if (towers < GUARD_TOWER_TARGET && !anyUnderConstruction(world, faction, "guardTower")) {
      if (tryIssueBuild(world, faction, "guardTower", baseAnchor)) return;
    }
  }
}

/** True iff a building of `kind` owned by `faction` is under construction (progress < 1). */
function anyUnderConstruction(world: World, faction: Faction, kind: BuildingKind): boolean {
  for (const b of world.buildings.values()) {
    if (b.owner === faction && b.kind === kind && b.buildProgress < 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rebuild: re-issue a build for any missing ESSENTIAL building.
// ---------------------------------------------------------------------------

/**
 * Essential buildings the AI keeps standing. If one is entirely absent (none at
 * any progress — i.e. it was destroyed and not yet re-queued) the AI issues a
 * fresh build order for it when resources allow. The normal build order
 * (`runBuildOrder`) already (re)builds Farm/Barracks/Lumber Mill/Guard Tower
 * when absent, so the dedicated rebuild here covers the Town Hall — the one
 * building the opening seeds but the build order never (re)constructs — plus a
 * Barracks (re)build that ignores the once-per-think single-order budget so the
 * army pipeline recovers immediately after a base raid.
 */
function runRebuild(world: World, faction: Faction, baseAnchor: Vec2): boolean {
  // Town Hall: not part of runBuildOrder; rebuild it if razed.
  if (!hasBuildingAnyProgress(world, faction, "townHall")) {
    if (tryIssueBuild(world, faction, "townHall", baseAnchor)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Army production: continuous mixed army at the Barracks.
// ---------------------------------------------------------------------------

/**
 * Chooses the next unit kind to train to drive the live army toward ARMY_MIX,
 * restricted to kinds whose prerequisites are met. Returns null if no producible
 * military kind is currently unlocked.
 *
 * Deterministic: compares each kind's (current count / desired weight) ratio and
 * picks the most under-represented unlocked kind; ties broken by a fixed kind
 * order (infantry, ranged, heavy).
 */
function chooseArmyUnit(world: World, faction: Faction): MilitaryKind | null {
  const counts = liveMilitaryCounts(world, faction);
  const order: readonly MilitaryKind[] = ["infantry", "ranged", "heavy"];
  const weight: Record<MilitaryKind, number> = {
    infantry: ARMY_MIX.infantry,
    ranged: ARMY_MIX.ranged,
    heavy: ARMY_MIX.heavy,
  };

  let best: MilitaryKind | null = null;
  let bestRatio = Number.POSITIVE_INFINITY;
  for (const kind of order) {
    if (!prereqMet(world, faction, kind)) continue;
    const w = weight[kind];
    const have = counts[kind] + countQueued(world, faction, kind);
    const ratio = have / w; // lower ⇒ more under-represented relative to its share
    if (ratio < bestRatio - 1e-9) {
      bestRatio = ratio;
      best = kind;
    }
  }
  return best;
}

/** Live counts of each military kind for `faction`. */
function liveMilitaryCounts(world: World, faction: Faction): Record<MilitaryKind, number> {
  const counts: Record<MilitaryKind, number> = { infantry: 0, ranged: 0, heavy: 0 };
  for (const u of world.units.values()) {
    if (u.owner !== faction) continue;
    if (u.kind === "infantry") counts.infantry++;
    else if (u.kind === "ranged") counts.ranged++;
    else if (u.kind === "heavy") counts.heavy++;
  }
  return counts;
}

/** True iff every prerequisite building for `unitKind` is complete for `faction`. */
function prereqMet(world: World, faction: Faction, unitKind: UnitKind): boolean {
  for (const reqKind of UNIT_REQUIREMENTS[unitKind]) {
    if (countBuildings(world, faction, reqKind, true) === 0) return false;
  }
  return true;
}

/** Total supply currently used by the faction's MILITARY (excludes workers/queued). */
function militarySupply(world: World, faction: Faction): number {
  let s = 0;
  for (const u of world.units.values()) {
    if (u.owner !== faction || !isMilitary(u)) continue;
    s += getUnitStats(faction, u.kind).supplyCost;
  }
  return s;
}

/**
 * Trains the next mixed-army unit at an idle Barracks if resources + supply +
 * prerequisites allow. Sets one Barracks' `train` order per think; the economy
 * phase validates and enqueues it. Respects the army soft cap.
 */
function trainArmy(world: World, faction: Faction): void {
  if (militarySupply(world, faction) >= ARMY_SUPPLY_SOFT_CAP) return;

  // Find a completed, idle Barracks (empty queue).
  let barracks: Building | null = null;
  for (const b of ownedBuildings(world, faction, true)) {
    if (b.kind !== "barracks") continue;
    if (b.trainQueue.length > 0) continue;
    barracks = b;
    break;
  }
  if (barracks === null) return;

  const kind = chooseArmyUnit(world, faction);
  if (kind === null) return;

  const stats = getUnitStats(faction, kind);
  const player = world.players[faction];
  if (player.gold < stats.goldCost || player.wood < stats.woodCost) return;
  if (player.supplyUsed + stats.supplyCost > player.supplyCap) return;

  barracks.order = { kind: "train", unitKind: kind };
}

// ---------------------------------------------------------------------------
// Difficulty scaling: one-time start bonus + periodic harvest-rate bonus.
// ---------------------------------------------------------------------------

/** Grants the one-time difficulty starting-resource bonus (idempotent via memory). */
function grantStartBonus(world: World, faction: Faction, difficulty: AiDifficulty, mem: AIMemory): void {
  if (mem.startBonusGranted) return;
  const player = world.players[faction];
  player.gold += START_BONUS_GOLD[difficulty];
  player.wood += START_BONUS_WOOD[difficulty];
  mem.startBonusGranted = true;
}

/**
 * Credits the difficulty harvest-rate bonus, proportional to the number of
 * workers actively harvesting this think (so it tracks real harvesting effort).
 */
function applyHarvestBonus(world: World, faction: Faction, difficulty: AiDifficulty): void {
  const perWorker = HARVEST_BONUS_PER_WORKER[difficulty];
  if (perWorker === 0) return;
  let harvesters = 0;
  for (const u of world.units.values()) {
    if (u.owner !== faction || u.kind !== "worker") continue;
    if (u.harvestState !== undefined || u.order.kind === "harvest") harvesters++;
  }
  if (harvesters === 0) return;
  const bonus = perWorker * harvesters;
  const player = world.players[faction];
  player.gold += bonus;
  player.wood += bonus;
}

// ---------------------------------------------------------------------------
// Attack waves + base defense.
// ---------------------------------------------------------------------------

/** The unit count threshold for the NEXT wave (escalates with waves already sent). */
function waveThreshold(difficulty: AiDifficulty, wavesSent: number): number {
  return WAVE_BASE_THRESHOLD[difficulty] + wavesSent * WAVE_ESCALATION_STEP;
}

/**
 * The player's base target tile — the player Town Hall's center, or any player
 * building's tile, or the player's recorded start. The wave marches here.
 */
function playerBaseTarget(world: World): Vec2 | null {
  const playerFaction = world.playerFaction;
  const hall = townHall(world, playerFaction);
  if (hall !== null) return buildingCenterTile(hall);
  const any = ownedBuildings(world, playerFaction, false)[0];
  if (any !== undefined) return buildingCenterTile(any);
  // Fall back to the recorded start location for the player faction.
  const starts = world.mapReport.starts;
  if (starts.length > 0) return vec(Math.floor(starts[0].x), Math.floor(starts[0].y));
  return null;
}

/**
 * Hostile (player-owned) units within BASE_THREAT_RADIUS of the AI base anchor.
 * Returns the nearest such hostile's id (for a recall target) or null.
 */
function nearestThreatToBase(world: World, faction: Faction, baseAnchor: Vec2): Vec2 | null {
  const enemyFaction = world.playerFaction === faction ? opponentOf(faction) : world.playerFaction;
  let bestPos: Vec2 | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of world.units.values()) {
    if (u.owner !== enemyFaction) continue;
    const tx = Math.floor(u.pos.x);
    const ty = Math.floor(u.pos.y);
    const d = Math.max(Math.abs(tx - baseAnchor.x), Math.abs(ty - baseAnchor.y));
    if (d <= BASE_THREAT_RADIUS && d < bestD) {
      bestD = d;
      bestPos = vec(tx, ty);
    }
  }
  return bestPos;
}

/** Idle/holding military units available to be committed to a wave or defense. */
function freeMilitary(world: World, faction: Faction): Unit[] {
  const out: Unit[] = [];
  for (const u of ownedUnits(world, faction)) {
    if (!isMilitary(u)) continue;
    out.push(u);
  }
  return out;
}

/**
 * Manages attack waves AND base defense (defense takes precedence):
 *
 *   - DEFENSE: if a hostile is within BASE_THREAT_RADIUS of the base, order ALL
 *     free military to attack-move the threat position. This overrides any wave
 *     march until the threat clears.
 *   - WAVE GATHERING: once the first-wave tick has passed and the free-military
 *     count meets the (escalating) threshold, commit them all to a wave and
 *     attack-move the player base; record them and bump `wavesSent`.
 *   - WAVE MARCHING: re-issue the attack-move toward the player base for the
 *     still-living wave units (so units that finished a skirmish keep advancing);
 *     when the wave is spent, return to gathering.
 */
function manageWavesAndDefense(
  world: World,
  faction: Faction,
  difficulty: AiDifficulty,
  mem: AIMemory,
  baseAnchor: Vec2,
): void {
  // --- Base defense first ---
  const threat = nearestThreatToBase(world, faction, baseAnchor);
  if (threat !== null) {
    for (const u of freeMilitary(world, faction)) {
      // Recall: attack-move the threat. attackMove auto-engages anything en route.
      resetUnitForNewOrder(u);
      u.order = attackMove(threat);
    }
    // While defending, abandon the marching bookkeeping; units re-form afterward.
    mem.wavePhase = "gathering";
    mem.waveUnits = [];
    return;
  }

  const target = playerBaseTarget(world);
  if (target === null) return;

  // --- Re-march an in-flight wave so survivors keep pressing the base ---
  if (mem.wavePhase === "marching") {
    const alive: EntityId[] = [];
    for (const id of mem.waveUnits) {
      const u = world.units.get(id);
      if (u === undefined) continue;
      alive.push(id);
      // Only re-issue if the unit is idling (finished its last fight); leave a
      // unit actively attack-moving alone so we don't thrash its path.
      if (u.order.kind === "stop" || u.order.kind === "hold") {
        resetUnitForNewOrder(u);
        u.order = attackMove(target);
      }
    }
    mem.waveUnits = alive;
    if (alive.length === 0) {
      mem.wavePhase = "gathering";
    }
    return;
  }

  // --- Gather a new wave ---
  if (world.tick < FIRST_WAVE_TICK[difficulty]) return;
  const army = freeMilitary(world, faction);
  const threshold = waveThreshold(difficulty, mem.wavesSent);
  if (army.length < threshold) return;

  // Commit the whole army to the wave.
  const committed: EntityId[] = [];
  for (const u of army) {
    resetUnitForNewOrder(u);
    u.order = attackMove(target);
    committed.push(u.id);
  }
  mem.waveUnits = committed;
  mem.wavePhase = "marching";
  mem.wavesSent++;
}

// ---------------------------------------------------------------------------
// Phase entry point.
// ---------------------------------------------------------------------------

/**
 * The AI phase. Runs the scripted controller for the NON-player faction on a
 * think interval; a no-op on the in-between ticks (only the cheap interval check
 * runs). All state is on `world.ai`; all randomness is reserved through a
 * per-think `world.rng` fork (currently the strategy is deterministic-by-rule and
 * does not draw from it, but the fork is taken so adding jitter later cannot
 * desync the main stream).
 */
export function phaseAi(world: World): void {
  const aiFaction = opponentOf(world.playerFaction);
  const mem = memoryFor(world, aiFaction);

  // Think interval: act once every THINK_INTERVAL ticks.
  if (world.tick - mem.lastThink < THINK_INTERVAL) return;
  mem.lastThink = world.tick;

  // Reserve a per-think RNG fork keyed by tick so future jitter is deterministic
  // and never advances the world's main stream out from under other phases.
  const think = world.rng.fork(`ai-${aiFaction}-${world.tick}`);
  void think; // strategy is rule-deterministic for now; fork reserved for future use

  const difficulty = world.aiDifficulty;

  // One-time difficulty start bonus.
  grantStartBonus(world, aiFaction, difficulty, mem);

  // Periodic difficulty harvest-rate bonus (tracks active harvesters).
  applyHarvestBonus(world, aiFaction, difficulty);

  const baseAnchor = baseAnchorOf(world, aiFaction, mem);
  if (baseAnchor === null) return; // no base, no buildings — nothing to drive

  // 1. Rebuild a razed Town Hall first (the build order never reconstructs it).
  const rebuilt = runRebuild(world, aiFaction, baseAnchor);

  // 2. Supply-aware build order (Farm → Barracks → Lumber Mill → Guard Towers).
  //    Skip if we just spent our single-order budget on a Town Hall rebuild.
  if (!rebuilt) {
    runBuildOrder(world, aiFaction, difficulty, baseAnchor);
  }

  // 3. Worker economy: train workers to saturation + put idle workers on resources.
  trainWorkers(world, aiFaction, difficulty);
  saturateWorkers(world, aiFaction);

  // 4. Continuous mixed army at the Barracks.
  trainArmy(world, aiFaction);

  // 5. Attack waves + base defense.
  manageWavesAndDefense(world, aiFaction, difficulty, mem, baseAnchor);
}
