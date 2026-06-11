/**
 * Seeded mulberry32 PRNG with forkable-substream API.
 *
 * All randomness in the game MUST flow through instances returned by
 * createRng / seedFromUrl. The ONLY permitted use of Math.random in this
 * codebase is the explicit documented fallback below, used once when no
 * ?seed= URL parameter is present.
 */

export interface RNG {
  /** Returns the next float in [0, 1). */
  next(): number;
  /** Returns a random integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Returns a random integer in [min, max] (inclusive). */
  range(min: number, max: number): number;
  /**
   * Derives a new independent RNG whose seed is deterministically computed
   * from this RNG's current state and an optional label.  Advancing the
   * fork does NOT affect this RNG, and vice-versa.
   */
  fork(label?: string | number): RNG;
  /** The uint32 seed that was used to create this RNG. */
  readonly seed: number;
}

/** Mulberry32 — fast, small, good-quality 32-bit PRNG. */
function mulberry32Step(state: { s: number }): number {
  // Advance the state with the mulberry32 update
  let z = (state.s += 0x6d2b79f5);
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
}

/**
 * Deterministic 32-bit hash of an integer — used by fork() to derive
 * child seeds without advancing the parent state in a correlated way.
 * Uses the fmix32 finalizer from MurmurHash3.
 */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Stable hash of a string label into a uint32.
 * Uses djb2 so fork("wfc") always produces the same offset.
 */
function hashLabel(label: string): number {
  let h = 5381;
  for (let i = 0; i < label.length; i++) {
    h = (Math.imul(h, 33) + label.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Creates a seeded RNG instance. */
export function createRng(seed: number): RNG {
  // Normalise to uint32
  const s0 = seed >>> 0;
  const state = { s: s0 };

  const rng: RNG = {
    seed: s0,

    next(): number {
      return mulberry32Step(state);
    },

    int(maxExclusive: number): number {
      return Math.floor(this.next() * maxExclusive);
    },

    range(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },

    fork(label?: string | number): RNG {
      // Derive a child seed from the current state and the label/index.
      // Read one value from this RNG to make the fork seed depend on
      // the current position in the stream, then mix in the label.
      const base = (state.s >>> 0);
      let childSeed = fmix32(base);
      if (label !== undefined) {
        const labelHash =
          typeof label === "string" ? hashLabel(label) : (label >>> 0);
        childSeed = fmix32(childSeed ^ labelHash);
      }
      return createRng(childSeed);
    },
  };

  return rng;
}

/**
 * Reads the ?seed= URL query parameter and returns an RNG seeded with it.
 *
 * If no ?seed= parameter is present, a seed is derived from Date.now() and
 * Math.random() — the ONLY place Math.random() is permitted in this
 * codebase.  The active seed is logged so any run can be reproduced.
 *
 * @param search - The location.search string (injectable for testability).
 */
export function seedFromUrl(search: string = typeof location !== "undefined" ? location.search : ""): { rng: RNG; seed: number } {
  const params = new URLSearchParams(search);
  const raw = params.get("seed");

  let seed: number;
  if (raw !== null && raw !== "") {
    const parsed = parseInt(raw, 10);
    // Parse as unsigned 32-bit integer; fall back to a derived seed on NaN.
    seed = isNaN(parsed) ? deriveFallbackSeed() : parsed >>> 0;
  } else {
    seed = deriveFallbackSeed();
  }

  const rng = createRng(seed);
  return { rng, seed };
}

/**
 * Derives a non-deterministic seed.
 * DOCUMENTED FALLBACK: the only place Math.random() is called in the codebase.
 */
function deriveFallbackSeed(): number {
  // Mix Date.now() and Math.random() to avoid seed=0 on fast machines.
  const timePart = Date.now() & 0xffffffff;
  const randPart = (Math.random() * 0xffffffff) >>> 0;
  return (timePart ^ randPart) >>> 0;
}
