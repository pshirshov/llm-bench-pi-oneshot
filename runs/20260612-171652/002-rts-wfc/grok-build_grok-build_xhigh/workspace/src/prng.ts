/**
 * Seeded PRNG using mulberry32.
 * All randomness in the game must go through an instance of this.
 * Math.random is only used here as fallback to generate a fresh seed when none provided.
 * (ESLint override in config permits it only in this file.)
 */

export interface PRNG {
  /** Returns float in [0, 1) */
  next(): number;
  /** Integer in [0, max) */
  nextInt(max: number): number;
  /** Integer in [min, max) inclusive of min, exclusive of max */
  nextIntRange(min: number, max: number): number;
  /** Clone to a new independent PRNG with same state */
  clone(): PRNG;
  /** Current seed (for display/repro) */
  readonly seed: number;
}

export function createPRNG(seed?: number): PRNG {
  let s: number;
  if (typeof seed === 'number' && Number.isFinite(seed) && seed >= 0) {
    s = seed >>> 0; // ensure uint32
  } else {
    // Fallback only here: documented use of Math.random for initial seed
    s = (Math.random() * 0xffffffff) >>> 0;
    if (s === 0) s = 1; // avoid degenerate 0 seed
  }

  let state = s >>> 0;

  function next(): number {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    nextInt(max: number): number {
      return Math.floor(next() * max) | 0;
    },
    nextIntRange(min: number, max: number): number {
      const range = max - min;
      return min + Math.floor(next() * range);
    },
    clone(): PRNG {
      return createPRNG(state);
    },
    get seed(): number {
      return s;
    },
  };
}

/** Helper to get seed from URL or generate */
export function getSeedFromURL(urlSearch: string): number | undefined {
  const params = new URLSearchParams(urlSearch);
  const seedStr = params.get('seed');
  if (!seedStr) return undefined;
  const n = Number(seedStr);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n >>> 0;
}
