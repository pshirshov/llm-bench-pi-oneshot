/**
 * Campaign definition + progression (T18).
 *
 * Owns the 5-level campaign as TYPED, immutable data and the deterministic
 * derivation of each level's map from a single campaign seed, plus the
 * unlock-progress store persisted in `localStorage`.
 *
 * Determinism contract: `levelMap(campaignSeed, levelIndex)` is a pure function
 * of its two arguments. It mixes the campaign seed and the level index into a
 * distinct per-level seed (`levelSeed`) via the project PRNG's forkable
 * substreams (src/core/rng.ts) and feeds that seed — together with the level
 * index — to `generateMap`. Identical `(campaignSeed, levelIndex)` therefore
 * always reproduce the same grid, starts, and report bit-for-bit, and the five
 * levels draw from five distinct seeds, so their maps differ.
 *
 * Progression: which levels are unlocked is persisted under one `localStorage`
 * key. Every accessor guards for a missing/throwing `localStorage` (private
 * mode, headless test runner) and degrades to an in-memory default — level 0
 * unlocked — so the module is fully usable in a Node test environment with no
 * DOM. No module-level MUTABLE game state lives here: the unlocked set is read
 * from and written to storage on demand, never cached in a module variable.
 *
 * DISCIPLINE: no `Math.random` (seeds flow only through `createRng`); no
 * module-level mutable state.
 */

import { createRng } from "../core/rng.js";
import { generateMap } from "../wfc/mapgen.js";
import type { MapGenResult } from "../wfc/mapgen.js";
import type { AiDifficulty } from "../sim/world.js";

// ---------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------

/**
 * One campaign level's static definition. The map itself is NOT stored here —
 * it is derived on demand from `(campaignSeed, levelIndex)` so a level occupies
 * no per-seed state — but everything that parameterises that derivation and the
 * match (dimensions, AI difficulty) is fixed data.
 */
export interface CampaignLevel {
  /** Zero-based position in the campaign (also the `levelIndex` passed to mapgen). */
  readonly index: number;
  /** Display name shown in the level-select screen and HUD. */
  readonly name: string;
  /** Map width in tiles (grows with the level). */
  readonly width: number;
  /** Map height in tiles (grows with the level). */
  readonly height: number;
  /** AI opponent difficulty (1..5; rises with the level). */
  readonly aiDifficulty: AiDifficulty;
  /**
   * One-line designer intent for the level's terrain feel. The current
   * `generateMap` takes no terrain-density parameters beyond size + seed, so
   * the escalation of "more water/mountains, tighter chokepoints, scarcer
   * resources" is realised through (a) the growing map dimensions — a larger
   * WFC field yields proportionally more of the constrained tile types and more
   * natural chokepoints — and (b) this documented intent, retained so the
   * progression is explicit even though it is not yet a tunable mapgen knob.
   */
  readonly terrainHint: string;
}

/**
 * The five campaign levels, in order. Dimensions are STRICTLY INCREASING and AI
 * difficulty rises 1→5, encoding the "progressively increasing complexity"
 * requirement. Frozen so no caller can mutate the shared definition.
 */
export const CAMPAIGN_LEVELS: readonly CampaignLevel[] = Object.freeze([
  {
    index: 0,
    name: "Greenfields",
    width: 32,
    height: 32,
    aiDifficulty: 1,
    terrainHint: "Open rolling grassland; few obstacles, generous resources.",
  },
  {
    index: 1,
    name: "Riverbend",
    width: 48,
    height: 48,
    aiDifficulty: 2,
    terrainHint: "Rivers and lakes split the field; resources still plentiful.",
  },
  {
    index: 2,
    name: "Stonewatch",
    width: 64,
    height: 64,
    aiDifficulty: 3,
    terrainHint: "Rocky highlands with mountain ridges and tighter passes.",
  },
  {
    index: 3,
    name: "The Narrows",
    width: 80,
    height: 80,
    aiDifficulty: 4,
    terrainHint: "Water and rock force narrow chokepoints; resources scarcer.",
  },
  {
    index: 4,
    name: "Ironhold",
    width: 96,
    height: 96,
    aiDifficulty: 5,
    terrainHint: "Cramped, heavily obstructed terrain; the scarcest resources.",
  },
] as const);

/** Number of levels in the campaign. */
export const CAMPAIGN_LEVEL_COUNT = CAMPAIGN_LEVELS.length;

/**
 * Returns the level definition at `levelIndex`. Throws on an out-of-range index
 * (a programming error — callers route through `unlockedLevels` / the level
 * list, which never yield an invalid index).
 */
export function campaignLevel(levelIndex: number): CampaignLevel {
  const level = CAMPAIGN_LEVELS[levelIndex];
  if (level === undefined) {
    throw new RangeError(
      `campaignLevel: levelIndex ${levelIndex} out of range [0, ${CAMPAIGN_LEVEL_COUNT - 1}]`,
    );
  }
  return level;
}

// ---------------------------------------------------------------------------
// Deterministic per-level seed + map
// ---------------------------------------------------------------------------

/**
 * Fork label under which each level's seed is derived from the campaign seed.
 * A fixed string so the derivation is stable across builds.
 */
const LEVEL_SEED_LABEL = "campaign-level";

/**
 * Derives the distinct per-level seed for `levelIndex` from `campaignSeed`.
 *
 * `createRng(campaignSeed).fork(LEVEL_SEED_LABEL).fork(levelIndex)` mixes the
 * campaign seed with the level index through the PRNG's `fmix32`-based fork, so:
 *   - the result is a pure function of `(campaignSeed, levelIndex)`;
 *   - different `levelIndex` values yield uncorrelated, near-certainly distinct
 *     uint32 seeds (the campaign test asserts all five are pairwise distinct).
 * The returned `seed` is what `levelMap` feeds to `generateMap`, so the map a
 * level produces is fully reproducible from `(campaignSeed, levelIndex)` alone.
 */
export function levelSeed(campaignSeed: number, levelIndex: number): number {
  return createRng(campaignSeed >>> 0)
    .fork(LEVEL_SEED_LABEL)
    .fork(levelIndex)
    .seed;
}

/**
 * Deterministically generates level `levelIndex`'s playable map for the given
 * campaign seed. Uses the level's fixed dimensions and the derived per-level
 * seed; the level index is also threaded into `generateMap` so the result is
 * keyed identically to the `GameSession`/`createWorld` the match runs on (which
 * the app shell constructs with this same `levelSeed` + `levelIndex`).
 *
 * Pure in `(campaignSeed, levelIndex)`: repeated calls return bit-identical
 * grids, starts, and reports.
 */
export function levelMap(campaignSeed: number, levelIndex: number): MapGenResult {
  const level = campaignLevel(levelIndex);
  return generateMap(level.width, level.height, levelSeed(campaignSeed, levelIndex), levelIndex);
}

// ---------------------------------------------------------------------------
// Progression persistence
// ---------------------------------------------------------------------------

/** `localStorage` key under which the highest unlocked level index is stored. */
const PROGRESS_KEY = "warband.campaign.progress.v1";

/** Level 0 is always available; everything past it must be earned. */
const FIRST_LEVEL_INDEX = 0;

/**
 * Returns the live `localStorage` if one is present and usable, else null.
 * Accessing `localStorage` can THROW (not merely be undefined) in some browser
 * privacy modes, so the probe is wrapped — a thrown access degrades to null,
 * giving the in-memory default behaviour without crashing the caller.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the highest unlocked level index from storage, clamped to the valid
 * range. Defaults to `FIRST_LEVEL_INDEX` when storage is absent, empty, or
 * holds a malformed value — so a fresh or headless run starts with only level 0
 * unlocked.
 */
function highestUnlockedIndex(): number {
  const store = safeStorage();
  if (store === null) return FIRST_LEVEL_INDEX;

  let raw: string | null;
  try {
    raw = store.getItem(PROGRESS_KEY);
  } catch {
    return FIRST_LEVEL_INDEX;
  }
  if (raw === null) return FIRST_LEVEL_INDEX;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < FIRST_LEVEL_INDEX) return FIRST_LEVEL_INDEX;
  return Math.min(parsed, CAMPAIGN_LEVEL_COUNT - 1);
}

/**
 * The set of unlocked level indices: every index from 0 up to and including the
 * highest unlocked one. Returned as a fresh array each call (no shared mutable
 * state); the UI reads it to mark locked vs. unlocked levels.
 */
export function unlockedLevels(): number[] {
  const highest = highestUnlockedIndex();
  const result: number[] = [];
  for (let i = FIRST_LEVEL_INDEX; i <= highest; i++) result.push(i);
  return result;
}

/** True iff `levelIndex` is currently unlocked (playable). */
export function isLevelUnlocked(levelIndex: number): boolean {
  return levelIndex >= FIRST_LEVEL_INDEX && levelIndex <= highestUnlockedIndex();
}

/**
 * Records a victory on `levelIndex`, unlocking the next level if one exists.
 * Idempotent and monotonic: it only ever RAISES the stored highest-unlocked
 * index (winning an already-cleared early level never relocks later ones), and
 * never advances past the final level. Returns the index of the level that
 * became newly unlocked, or null if nothing changed (last level, replay of an
 * earlier level, or no usable storage). A no-storage environment still returns
 * the would-be-unlocked index so the caller's in-session flow can advance.
 */
export function recordVictory(levelIndex: number): number | null {
  if (!Number.isInteger(levelIndex) || levelIndex < FIRST_LEVEL_INDEX) {
    throw new RangeError(`recordVictory: invalid levelIndex ${levelIndex}`);
  }

  const nextIndex = levelIndex + 1;
  const hasNext = nextIndex < CAMPAIGN_LEVEL_COUNT;

  const store = safeStorage();
  if (store === null) {
    // No persistence available: report the unlock so the session can still
    // advance the player to the next level this run.
    return hasNext ? nextIndex : null;
  }

  const currentHighest = highestUnlockedIndex();
  const desiredHighest = hasNext ? Math.max(currentHighest, nextIndex) : currentHighest;

  if (desiredHighest === currentHighest) return null; // already unlocked / last level

  try {
    store.setItem(PROGRESS_KEY, String(desiredHighest));
  } catch {
    // Write rejected (quota / privacy): fall through, the unlock is still
    // reported for this session even though it will not persist.
  }
  return hasNext ? nextIndex : null;
}

/**
 * Resets campaign progress back to only level 0 unlocked. Provided for tests and
 * a potential "new campaign" action; a no-op when storage is unavailable.
 */
export function resetProgress(): void {
  const store = safeStorage();
  if (store === null) return;
  try {
    store.removeItem(PROGRESS_KEY);
  } catch {
    // Ignore: nothing to reset if removal is rejected.
  }
}
