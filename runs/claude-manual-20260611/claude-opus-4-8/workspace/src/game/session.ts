/**
 * GameSession (T17) — owns ONE match: the simulation `World`, the `Camera`, and
 * the mutable session/UI state the input layer (T15) and `main.ts` (T18) drive.
 *
 * Two responsibilities live here and nowhere else:
 *
 *  1. The FIXED-TIMESTEP loop. `frame(realDtMs)` accumulates real elapsed time
 *     scaled by the speed multiplier and drains it in whole `1000/SIM_HZ` ms
 *     steps, running exactly one `stepWorld` per step (clamped to avoid the
 *     spiral-of-death). Rendering happens BETWEEN frames — `main.ts` reads World
 *     state each rAF tick; the session itself performs NO rendering, DOM access,
 *     requestAnimationFrame, or wall-clock reads. `frame(dt)` is therefore a pure
 *     function of `dt` plus the current session + world state, which keeps the
 *     whole match deterministic: a fixed sequence of `frame(dt)` calls on two
 *     same-seed sessions yields bit-identical Worlds.
 *
 *  2. WIN/LOSE detection. Per the spec ("a side loses when all its buildings are
 *     destroyed"), `checkEndCondition()` returns `'defeat'` when the PLAYER
 *     faction has no buildings, `'victory'` when the ENEMY faction has none, else
 *     `null`. The first decided result is latched into `result` and the loop then
 *     stops stepping; `main.ts` reads `result` to show the victory/defeat screen.
 *
 * DISCIPLINE: no module-level mutable state, no `Math.random` (the World draws
 * only from `world.rng`). The session holds a single `InputContextWithDrag`
 * object as the one source of truth for the UI/session state, and exposes it via
 * `inputContext()` — the input handlers mutate `paused`/`speed`/`camera`/… on
 * that same object, and `frame()` reads `paused`/`speed` from it, so the two
 * never desync. It is fully HEADLESS-testable.
 */

import { createWorld, DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT } from "../sim/world.js";
import type { World, AiDifficulty } from "../sim/world.js";
import { stepWorld, SIM_HZ } from "../sim/simulation.js";
import { createCamera } from "../render/camera.js";
import { buildHudLayout } from "../ui/hud.js";
import type { InputContext, InputContextWithDrag } from "../input/input.js";
import type { EntityId, Faction } from "../game/types.js";

// ---------------------------------------------------------------------------
// Mutable session context
// ---------------------------------------------------------------------------

/**
 * The session's backing context. Identical to `InputContextWithDrag` except the
 * `hudLayout` field is mutable, so the session can re-store a freshly-computed
 * layout on selection change (`rebuildHudLayout`). A mutable property is
 * assignable to the interface's `readonly hudLayout`, so this widening type
 * still satisfies `InputContextWithDrag` when returned from `inputContext()`.
 */
type MutableSessionContext = Omit<InputContextWithDrag, "hudLayout"> & {
  hudLayout: InputContextWithDrag["hudLayout"];
};

// ---------------------------------------------------------------------------
// Loop constants
// ---------------------------------------------------------------------------

/**
 * Wall-clock milliseconds of one fixed simulation step. Derived from `SIM_HZ`
 * so the loop stays locked to the same fixed rate `stepWorld` assumes.
 */
const MS_PER_STEP = 1000 / SIM_HZ;

/**
 * Maximum fixed steps drained in a single `frame()` call. Bounds the catch-up
 * work after a long stall (tab backgrounded, GC pause) so the loop can never
 * enter the spiral-of-death — accumulating more lag than it can ever drain.
 * Any leftover time beyond this budget is discarded (the simulation simply
 * runs slower than real time for that one frame rather than freezing).
 */
const MAX_STEPS_PER_FRAME = 8;

/**
 * Default camera tile size / viewport used when a session is constructed without
 * an explicit viewport (headless tests). `main.ts` (T18) passes the real canvas
 * dimensions so the camera and HUD match the visible viewport.
 */
const DEFAULT_TILE_SIZE = 32;
const DEFAULT_VIEWPORT_W = 1280;
const DEFAULT_VIEWPORT_H = 720;

// ---------------------------------------------------------------------------
// Match result
// ---------------------------------------------------------------------------

/** Terminal outcome of a match from the player's perspective. */
export type MatchResult = "victory" | "defeat";

/** Optional viewport configuration for the session's camera + HUD. */
export interface SessionViewport {
  readonly tileSize: number;
  readonly viewportW: number;
  readonly viewportH: number;
}

// ---------------------------------------------------------------------------
// GameSession
// ---------------------------------------------------------------------------

/**
 * Owns one match. Construct with the same `(seed, levelIndex, playerFaction,
 * aiDifficulty)` arguments as `createWorld`, plus the level's map `width`/`height`
 * (so the match map matches the campaign level's declared size rather than the
 * 48×48 default); drive with `frame(dt)` each render tick; read `world`,
 * `inputContext()`, and `result` for rendering and HUD.
 */
export class GameSession {
  /** The live simulation state. `stepWorld` mutates only this. */
  readonly world: World;

  /**
   * The faction the human controls; its opponent is AI-driven. Cached so
   * end-condition checks need not re-derive it.
   */
  readonly playerFaction: Faction;
  /** The AI-controlled opponent faction (the non-player side). */
  readonly enemyFaction: Faction;

  /**
   * The single source of truth for UI / session state. Input handlers mutate
   * this object's `paused` / `speed` / `camera` / `selection` / … ; `frame()`
   * reads `paused` / `speed` from it. Stored as the concrete `WithDrag` type so
   * the session may reassign the (interface-`readonly`) `hudLayout` field when
   * the selection changes.
   */
  private readonly ctx: MutableSessionContext;

  /**
   * Unconsumed real time (already scaled by the speed multiplier), in ms,
   * carried between `frame()` calls. Always in `[0, MS_PER_STEP)` after a frame
   * unless the per-frame step budget clamped the drain.
   */
  private accumulatorMs = 0;

  /**
   * The latched match result, or null while the match is live. Set once by
   * `checkEndCondition()`; after it is set the loop stops stepping.
   */
  private matchResult: MatchResult | null = null;

  constructor(
    seed: number,
    levelIndex: number,
    playerFaction: Faction,
    aiDifficulty: AiDifficulty,
    viewport: SessionViewport = {
      tileSize: DEFAULT_TILE_SIZE,
      viewportW: DEFAULT_VIEWPORT_W,
      viewportH: DEFAULT_VIEWPORT_H,
    },
    width: number = DEFAULT_MAP_WIDTH,
    height: number = DEFAULT_MAP_HEIGHT,
  ) {
    this.world = createWorld(seed, levelIndex, playerFaction, aiDifficulty, width, height);
    this.playerFaction = playerFaction;
    this.enemyFaction = playerFaction === "human" ? "orc" : "human";

    const mapWidth = this.world.map.width;
    const mapHeight = this.world.map.height;

    // Centre the camera on the player's starting base (start index 0).
    const start = this.world.mapReport.starts[0];
    const camera = createCamera(
      viewport.tileSize,
      viewport.viewportW,
      viewport.viewportH,
      start.x,
      start.y,
      mapWidth,
      mapHeight,
    );

    const hudLayout = buildHudLayout(
      viewport.viewportW,
      viewport.viewportH,
      playerFaction,
      this.world,
      new Set<number>(),
      undefined,
    );

    this.ctx = {
      world: this.world,
      camera,
      faction: playerFaction,
      selection: new Set<EntityId>(),
      selectedBuilding: undefined,
      controlGroups: new Map<number, EntityId[]>(),
      paused: false,
      speed: 1,
      placement: null,
      hudLayout,
      mapWidth,
      mapHeight,
      _drag: undefined,
      _attackMoveMode: false,
    };
  }

  // -------------------------------------------------------------------------
  // InputContext accessor
  // -------------------------------------------------------------------------

  /**
   * The session/UI state the input layer (T15) and `main.ts` (T18) read and
   * mutate. Returns the SAME object the loop reads, so an input-driven pause or
   * speed change takes effect on the next `frame()` with no copy/sync step.
   */
  inputContext(): InputContextWithDrag {
    return this.ctx;
  }

  /** Convenience read-only accessors mirroring the `InputContext` fields. */
  get paused(): boolean {
    return this.ctx.paused;
  }

  get speed(): InputContext["speed"] {
    return this.ctx.speed;
  }

  /** The latched match result, or null while the match is live. */
  get result(): MatchResult | null {
    return this.matchResult;
  }

  // -------------------------------------------------------------------------
  // HUD layout
  // -------------------------------------------------------------------------

  /**
   * Recomputes the HUD layout for the current viewport + selection and stores it
   * on the input context. `main.ts` calls this after a selection change or a
   * canvas resize; the input handlers read `ctx.hudLayout` for button hit-tests.
   */
  rebuildHudLayout(): void {
    this.ctx.hudLayout = buildHudLayout(
      this.ctx.hudLayout.viewportW,
      this.ctx.hudLayout.viewportH,
      this.playerFaction,
      this.world,
      this.ctx.selection,
      this.ctx.selectedBuilding,
    );
  }

  // -------------------------------------------------------------------------
  // Fixed-timestep loop
  // -------------------------------------------------------------------------

  /**
   * Advances the match by the real elapsed time `realDtMs` since the previous
   * frame, using a fixed-timestep accumulator decoupled from the render rate.
   *
   * Invariants:
   *   - When `paused` OR the match has ended, nothing accumulates and zero steps
   *     run; the accumulator is held at 0 so resuming does not dump a backlog of
   *     queued steps.
   *   - Otherwise `realDtMs * speed` is added to the accumulator and drained in
   *     whole `MS_PER_STEP` chunks, one `stepWorld(world)` per chunk, up to
   *     `MAX_STEPS_PER_FRAME` (spiral-of-death guard).
   *   - The end condition is re-checked after each step so a side wiped out
   *     mid-frame stops the remaining steps in the same frame.
   *
   * Negative or non-finite `realDtMs` is treated as zero (defensive against a
   * bogus clock delta); it never rewinds the accumulator.
   */
  frame(realDtMs: number): void {
    if (this.matchResult !== null || this.ctx.paused) {
      // Paused / ended: do not accumulate or step. Drop any carried lag so an
      // unpause starts fresh rather than fast-forwarding through the gap.
      this.accumulatorMs = 0;
      return;
    }

    const dt = Number.isFinite(realDtMs) && realDtMs > 0 ? realDtMs : 0;
    this.accumulatorMs += dt * this.ctx.speed;

    let stepsRun = 0;
    while (this.accumulatorMs >= MS_PER_STEP && stepsRun < MAX_STEPS_PER_FRAME) {
      stepWorld(this.world);
      this.accumulatorMs -= MS_PER_STEP;
      stepsRun += 1;

      if (this.checkEndCondition() !== null) {
        // Match decided this step: stop draining and discard remaining lag.
        this.accumulatorMs = 0;
        break;
      }
    }

    if (stepsRun >= MAX_STEPS_PER_FRAME && this.accumulatorMs >= MS_PER_STEP) {
      // Spiral-of-death guard: a frame that could not catch up this pass discards
      // its surplus lag rather than letting the accumulator grow unbounded.
      this.accumulatorMs = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Win / lose
  // -------------------------------------------------------------------------

  /**
   * Evaluates the end condition: a side loses when ALL its buildings are
   * destroyed. Returns `'defeat'` if the PLAYER faction has no buildings,
   * `'victory'` if the ENEMY faction has none, else `null`. The result is
   * latched on first decision (and the player check takes precedence in the
   * degenerate case where both sides are simultaneously building-less).
   */
  checkEndCondition(): MatchResult | null {
    if (this.matchResult !== null) return this.matchResult;

    let playerBuildings = 0;
    let enemyBuildings = 0;
    for (const building of this.world.buildings.values()) {
      if (building.owner === this.playerFaction) playerBuildings += 1;
      else if (building.owner === this.enemyFaction) enemyBuildings += 1;
    }

    if (playerBuildings === 0) {
      this.matchResult = "defeat";
    } else if (enemyBuildings === 0) {
      this.matchResult = "victory";
    }
    return this.matchResult;
  }
}
