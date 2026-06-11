/**
 * The `World` aggregate — the entire mutable simulation state — plus the
 * `createWorld` factory that seeds a fresh match.
 *
 * Everything the simulation reads or writes lives here: the tile map, the live
 * entity tables (units / buildings / projectiles keyed by EntityId), per-faction
 * economy (gold / wood / supply), the tick counter, and the seeded RNG that
 * every later phase MUST draw from for determinism. `fog` is left optional for
 * T11 to populate without a type change.
 *
 * `createWorld` builds the map via `generateMap`, then for each faction places a
 * starting Town Hall over its start tile and a few Workers beside it, and sets
 * the starting resources. It is the only place initial entities are spawned;
 * downstream tasks add to the world through `addUnit` / `addBuilding`.
 */

import { createRng } from "../core/rng.js";
import type { RNG } from "../core/rng.js";
import { vec } from "../core/vec.js";
import type { Vec2 } from "../core/vec.js";
import { FACTIONS, makeEntityId } from "../game/types.js";
import type { EntityId, Faction } from "../game/types.js";
import { getBuildingStats, getUnitStats } from "./stats.js";
import { generateMap } from "../wfc/mapgen.js";
import type { MapGenReport } from "../wfc/mapgen.js";
import { GameMap } from "./gamemap.js";
import { idle } from "./orders.js";
import type { Building, Footprint, Unit, Projectile } from "./entity.js";

// ---------------------------------------------------------------------------
// Starting-condition constants (genre-conventional; documented for tuning)
// ---------------------------------------------------------------------------

/** Gold each player starts a match with. */
export const STARTING_GOLD = 500;
/** Wood each player starts a match with. */
export const STARTING_WOOD = 250;
/** Number of Workers each player starts with, spawned beside the Town Hall. */
export const STARTING_WORKERS = 4;

/** Default campaign map dimensions for level 0 (grows with level later). */
export const DEFAULT_MAP_WIDTH = 48;
export const DEFAULT_MAP_HEIGHT = 48;

/**
 * Maximum Chebyshev distance (start → nearest footprint tile) the starting
 * Town Hall search walks before deferring to the carve fallback, and the radius
 * within which that fallback looks for an in-bounds pad and the start's gold
 * mine. Deliberately generous; a deterministic bound, not a tuning knob.
 */
export const MAX_HALL_PLACEMENT_RADIUS = 16;

/** AI difficulty band (1 = easiest … 5 = hardest), per the spec. */
export type AiDifficulty = 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Per-faction economy
// ---------------------------------------------------------------------------

/** Mutable economy ledger for one faction. */
export interface PlayerState {
  gold: number;
  wood: number;
  /** Supply currently consumed by living units. */
  supplyUsed: number;
  /** Supply capacity from Town Hall + Farms (training blocks at the cap). */
  supplyCap: number;
}

// ---------------------------------------------------------------------------
// World aggregate
// ---------------------------------------------------------------------------

/**
 * The complete simulation state. `stepWorld` mutates ONLY this object. Holds no
 * rendering, DOM, or input state — those layers read the world but never store
 * state inside it.
 */
export interface World {
  readonly map: GameMap;
  readonly units: Map<EntityId, Unit>;
  readonly buildings: Map<EntityId, Building>;
  readonly projectiles: Map<EntityId, Projectile>;
  readonly players: Record<Faction, PlayerState>;

  /** The faction the human controls (the other is AI-driven). */
  readonly playerFaction: Faction;
  /** AI opponent difficulty (1..5). */
  readonly aiDifficulty: AiDifficulty;

  /** Monotonic fixed-timestep tick counter (starts at 0). */
  tick: number;

  /** The single seeded RNG every phase must draw from for determinism. */
  readonly rng: RNG;

  /** Diagnostic report from map generation (starts, fairness, etc.). */
  readonly mapReport: MapGenReport;

  /**
   * Next entity id to hand out. Incremented by `nextId`. Stored on the world
   * (not a module global) so two worlds never share an id counter — a
   * prerequisite for deterministic, isolated simulations.
   */
  nextEntityId: number;
  nextId(): EntityId;

  /**
   * Fog-of-war state, filled by T11. Optional so the world is constructible
   * before fog exists; phases that need it must guard on its presence.
   */
  fog?: unknown;
}

// ---------------------------------------------------------------------------
// Entity helpers
// ---------------------------------------------------------------------------

/** Registers a unit in the world and bumps the owner's supply usage. */
export function addUnit(world: World, unit: Unit): Unit {
  world.units.set(unit.id, unit);
  world.players[unit.owner].supplyUsed += getUnitStats(unit.owner, unit.kind).supplyCost;
  return unit;
}

/**
 * Registers a building in the world, marks its footprint occupied on the map,
 * and (when already complete) credits its supply to the owner. Construction
 * sites (`buildProgress < 1`) occupy tiles but grant no supply until finished.
 *
 * Precondition: the building's footprint must be placeable (in bounds, on clear
 * ground, no resource tile, unoccupied). This is asserted rather than clamped —
 * a building may NEVER be raised on water/rock/goldMine/forest or on top of
 * another building. Callers are responsible for choosing a valid anchor.
 */
export function addBuilding(world: World, building: Building): Building {
  if (!world.map.canPlaceBuilding(building.tile, building.footprint)) {
    throw new Error(
      `addBuilding: ${building.kind} footprint at (${building.tile.x},${building.tile.y}) ` +
        `${building.footprint.w}x${building.footprint.h} is not placeable (off-map, on resource/impassable terrain, or occupied)`,
    );
  }
  world.buildings.set(building.id, building);
  world.map.occupy(building.tile, building.footprint, building.id);
  if (building.buildProgress >= 1) {
    world.players[building.owner].supplyCap += getBuildingStats(
      building.owner,
      building.kind,
    ).supplyProvided;
  }
  return building;
}

// ---------------------------------------------------------------------------
// createWorld
// ---------------------------------------------------------------------------

/**
 * Spawns one faction's opening: a Town Hall on guaranteed-buildable ground near
 * its start tile, and STARTING_WORKERS workers on the nearest walkable tiles
 * around the hall.
 *
 * The hall is NEVER centre-and-clamped (which lands a 4×4 footprint on raw WFC
 * terrain at corner starts — forest / gold mine / rock / water, with a live gold
 * mine under the pad). Placement is two-tier and fully deterministic:
 *   1. `findBuildableAnchor` — search outward for the closest in-bounds anchor
 *      whose ENTIRE footprint is already clear ground (preferred: it sites the
 *      hall on existing terrain with no edit).
 *   2. `carveBuildableAnchor` — if no naturally-clear footprint-sized rectangle
 *      exists near the start, carve one. This is NOT a freak case: mapgen's start
 *      clearing is CLEARING_RADIUS=2 (a 5×5 square, clipped to 3×3 at a corner),
 *      smaller than the 4×4 Town Hall footprint, and the surrounding WFC terrain
 *      is dense forest/gold mine — so corner starts (the common case for the
 *      graph-diameter start selection) routinely need the carve. The carve
 *      preserves the start's gold mine so the economy keeps it.
 * Either tier yields an anchor whose footprint `GameMap.canPlaceBuilding`
 * accepts; `addBuilding` then asserts that precondition before occupying.
 */
function spawnStartingBase(world: World, faction: Faction, start: Vec2): void {
  const hallStats = getBuildingStats(faction, "townHall");
  const fp = hallStats.footprint;

  const hallTile =
    findBuildableAnchor(world.map, start, fp) ?? carveBuildableAnchor(world.map, start, fp);

  const hall: Building = {
    id: world.nextId(),
    owner: faction,
    kind: "townHall",
    hp: hallStats.hp,
    maxHp: hallStats.hp,
    tile: hallTile,
    footprint: fp,
    buildProgress: 1,
    trainQueue: [],
  };
  addBuilding(world, hall);

  // Place workers on walkable tiles in an outward ring around the Town Hall.
  // (addBuilding has now occupied the footprint, so the ring excludes it.)
  const workerStats = getUnitStats(faction, "worker");
  const spots = walkableRing(world, hallTile, fp.w, fp.h, STARTING_WORKERS);
  for (const spot of spots) {
    const worker: Unit = {
      id: world.nextId(),
      owner: faction,
      kind: "worker",
      hp: workerStats.hp,
      maxHp: workerStats.hp,
      pos: { x: spot.x + 0.5, y: spot.y + 0.5 },
      order: idle(),
      attackCooldown: 0,
    };
    addUnit(world, worker);
  }
}

/**
 * Finds the in-bounds anchor (footprint top-left) closest to `start` on which a
 * building of `footprint` may be placed — every covered tile clear ground, no
 * resource tile (gold mine / forest), no impassable terrain (water / rock), and
 * unoccupied (`GameMap.canPlaceBuilding`). "Closest" is measured by the
 * Chebyshev distance from `start` to the NEAREST footprint tile, so the hall
 * hugs the start; candidates are scanned in growing rings (distance 0, 1, 2, …)
 * and, within a ring, row-major, giving a fully deterministic result that draws
 * no randomness. Returns the first qualifying anchor, or null if none exists
 * within MAX_HALL_PLACEMENT_RADIUS — in which case the caller carves a pad
 * (`carveBuildableAnchor`). Null is common at corner starts, whose surrounding
 * WFC terrain (forest / gold mine) leaves no clear 4×4 rectangle.
 *
 * At ring distance `d`, an anchor's footprint touches `start` within Chebyshev
 * `d` iff its top-left lies in
 *   x ∈ [start.x - (w-1) - d, start.x + d],  y ∈ [start.y - (h-1) - d, start.y + d].
 * We grow that box by one each ring and only test anchors first reachable at the
 * current `d` (tracked via a `seen` set), so each anchor is tested once, nearest
 * first.
 */
function findBuildableAnchor(
  map: GameMap,
  start: Vec2,
  footprint: Footprint,
): Vec2 | null {
  const seen = new Set<number>();
  const stride = map.width;
  for (let d = 0; d <= MAX_HALL_PLACEMENT_RADIUS; d++) {
    const minX = start.x - (footprint.w - 1) - d;
    const maxX = start.x + d;
    const minY = start.y - (footprint.h - 1) - d;
    const maxY = start.y + d;
    for (let ay = minY; ay <= maxY; ay++) {
      for (let ax = minX; ax <= maxX; ax++) {
        // Only in-bounds anchors can be buildable; skipping out-of-bounds ones
        // also keeps the `seen` key (ay*stride+ax) free of negative aliasing.
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
 * Last-resort guarantee for the starting Town Hall: when no naturally-clear
 * footprint-sized rectangle exists near `start` (dense WFC forest/rock around a
 * corner start), carve one. Picks the in-bounds anchor closest to `start`
 * (same ring order as `findBuildableAnchor`) whose footprint stays fully
 * in-bounds AND does NOT cover the start's nearest gold mine, converts that
 * rectangle to clear ground via `GameMap.clearForBuilding`, and returns the
 * anchor. The mine is thereby preserved for the economy; only the building pad
 * is bulldozed. Fully deterministic (fixed scan order, no RNG). Throws only if
 * no in-bounds footprint exists at all (a sub-footprint-sized map), which the
 * default 48×48 dimensions exclude.
 */
function carveBuildableAnchor(map: GameMap, start: Vec2, footprint: Footprint): Vec2 {
  const mine = nearestGoldMine(map, start);
  const anchor = nearestInBoundsAnchorAvoiding(map, start, footprint, mine);
  if (anchor === null) {
    throw new Error(
      `carveBuildableAnchor: no in-bounds ${footprint.w}x${footprint.h} footprint ` +
        `near start (${start.x},${start.y}) — map smaller than a building footprint?`,
    );
  }
  map.clearForBuilding(anchor, footprint);
  return anchor;
}

/**
 * Nearest gold-mine tile to `start` by Chebyshev distance within
 * MAX_HALL_PLACEMENT_RADIUS, ties broken by lowest flat index for determinism;
 * null if none is near. Used so the fallback carve never bulldozes the mine the
 * starting economy will harvest.
 */
function nearestGoldMine(map: GameMap, start: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  const r = MAX_HALL_PLACEMENT_RADIUS;
  for (let y = start.y - r; y <= start.y + r; y++) {
    for (let x = start.x - r; x <= start.x + r; x++) {
      if (!map.inBounds(x, y)) continue;
      if (map.tileAt(x, y) !== "goldMine") continue;
      const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
      if (d < bestD) {
        bestD = d;
        best = vec(x, y);
      }
    }
  }
  return best;
}

/**
 * Nearest in-bounds anchor to `start` (ring order: distance from start to the
 * nearest footprint tile, then row-major) whose footprint is fully in-bounds and
 * does not cover `avoid` (when given). Buildability is NOT required — the caller
 * carves the rectangle clear afterwards. Returns null only if no fully-in-bounds
 * footprint exists at all.
 */
function nearestInBoundsAnchorAvoiding(
  map: GameMap,
  start: Vec2,
  footprint: Footprint,
  avoid: Vec2 | null,
): Vec2 | null {
  const covers = (anchor: Vec2, p: Vec2): boolean =>
    p.x >= anchor.x &&
    p.x < anchor.x + footprint.w &&
    p.y >= anchor.y &&
    p.y < anchor.y + footprint.h;

  const seen = new Set<number>();
  const stride = map.width;
  for (let d = 0; d <= MAX_HALL_PLACEMENT_RADIUS; d++) {
    const minX = start.x - (footprint.w - 1) - d;
    const maxX = start.x + d;
    const minY = start.y - (footprint.h - 1) - d;
    const maxY = start.y + d;
    for (let ay = minY; ay <= maxY; ay++) {
      for (let ax = minX; ax <= maxX; ax++) {
        const anchor = vec(ax, ay);
        // Footprint must be entirely in bounds.
        if (!map.inBounds(ax, ay)) continue;
        if (!map.inBounds(ax + footprint.w - 1, ay + footprint.h - 1)) continue;
        const key = ay * stride + ax;
        if (seen.has(key)) continue;
        seen.add(key);
        if (avoid !== null && covers(anchor, avoid)) continue;
        return anchor;
      }
    }
  }
  return null;
}

/**
 * Finds up to `count` walkable, building-free, unique tiles around the footprint
 * anchored at `tile` (size w×h), searching outward by Chebyshev rings so workers
 * cluster next to the Town Hall. Deterministic (fixed scan order); never returns
 * a tile under the building itself or out of bounds.
 */
function walkableRing(
  world: World,
  tile: Vec2,
  w: number,
  h: number,
  count: number,
): Vec2[] {
  const map = world.map;
  const result: Vec2[] = [];
  const seen = new Set<number>();
  const minX = tile.x;
  const minY = tile.y;
  const maxX = tile.x + w - 1;
  const maxY = tile.y + h - 1;

  const inFootprint = (x: number, y: number): boolean =>
    x >= minX && x <= maxX && y >= minY && y <= maxY;

  const maxRadius = Math.max(map.width, map.height);
  for (let r = 1; r <= maxRadius && result.length < count; r++) {
    for (let y = minY - r; y <= maxY + r && result.length < count; y++) {
      for (let x = minX - r; x <= maxX + r && result.length < count; x++) {
        // Only the perimeter cells newly reached at this radius.
        const onRing = x === minX - r || x === maxX + r || y === minY - r || y === maxY + r;
        if (!onRing) continue;
        if (!map.inBounds(x, y)) continue;
        if (inFootprint(x, y)) continue;
        if (map.isTileBlocked(x, y)) continue;
        const key = y * map.width + x;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(vec(x, y));
      }
    }
  }
  return result;
}

/**
 * Builds a fresh `World` for a campaign match: generates the seeded map, places
 * each faction's opening base at its start tile, and sets starting resources.
 *
 * Determinism: identical (seed, levelIndex, playerFaction, aiDifficulty) always
 * produce a deeply-equal World — the map is seed-derived and entity spawning is
 * a fixed, RNG-free scan, so two worlds from the same arguments are bit-equal
 * before any `stepWorld` call.
 */
export function createWorld(
  seed: number,
  levelIndex: number,
  playerFaction: Faction,
  aiDifficulty: AiDifficulty,
  width: number = DEFAULT_MAP_WIDTH,
  height: number = DEFAULT_MAP_HEIGHT,
): World {
  const { grid, starts, report } = generateMap(width, height, seed, levelIndex);
  const map = new GameMap(grid);

  const players: Record<Faction, PlayerState> = {
    human: { gold: STARTING_GOLD, wood: STARTING_WOOD, supplyUsed: 0, supplyCap: 0 },
    orc: { gold: STARTING_GOLD, wood: STARTING_WOOD, supplyUsed: 0, supplyCap: 0 },
  };

  const world: World = {
    map,
    units: new Map<EntityId, Unit>(),
    buildings: new Map<EntityId, Building>(),
    projectiles: new Map<EntityId, Projectile>(),
    players,
    playerFaction,
    aiDifficulty,
    tick: 0,
    rng: createRng(seed).fork(`world-${levelIndex}`),
    mapReport: report,
    nextEntityId: 1,
    nextId(): EntityId {
      return makeEntityId(this.nextEntityId++);
    },
  };

  // Assign starts to factions deterministically: the player's faction takes the
  // first start, the opponent the second. FACTIONS order is stable.
  const opponent: Faction = playerFaction === "human" ? "orc" : "human";
  spawnStartingBase(world, playerFaction, starts[0]);
  spawnStartingBase(world, opponent, starts[1]);

  // Touch FACTIONS so the import is exercised and both factions are accounted
  // for (defensive: fails loudly here if a third faction is ever added).
  for (const f of FACTIONS) {
    if (!(f in world.players)) {
      throw new Error(`createWorld: missing player state for faction ${f}`);
    }
  }

  return world;
}
