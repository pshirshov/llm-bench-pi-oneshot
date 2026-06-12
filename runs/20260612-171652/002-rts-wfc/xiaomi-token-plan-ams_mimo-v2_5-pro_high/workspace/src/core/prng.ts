/**
 * Seeded PRNG module. All randomness flows through this single source.
 * Math.random() is used ONLY here, as the documented fallback for generating
 * a fresh seed when ?seed= is absent from the URL.
 */

export interface PRNG {
  /** Returns a float in [0, 1) */
  next(): number;
  /** Returns an integer in [min, max] inclusive */
  nextInt(min: number, max: number): number;
  /** Returns a float in [min, max) */
  nextFloat(min: number, max: number): number;
  /** Get the original seed */
  readonly seed: number;
}

/** Mulberry32 — a fast, well-distributed 32-bit PRNG */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a PRNG from a numeric seed */
export function createPRNG(seed: number): PRNG {
  const raw = mulberry32(seed);
  return {
    seed,
    next: () => raw(),
    nextInt(min: number, max: number): number {
      return Math.floor(raw() * (max - min + 1)) + min;
    },
    nextFloat(min: number, max: number): number {
      return raw() * (max - min) + min;
    },
  };
}

/** Parse seed from URL query parameter, or generate a fresh one */
export function parseSeedFromURL(url: string): number {
  try {
    const u = new URL(url);
    const s = u.searchParams.get('seed');
    if (s !== null) {
      const parsed = Number(s);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // Not a valid URL or no search params
  }
  // Fallback: use Math.random to generate a seed
  return Math.floor(Math.random() * 2147483647);
}

/** Generate a sub-seed deterministically from a parent seed and a tag */
export function subSeed(parent: PRNG, tag: number): number {
  return (parent.seed ^ (tag * 2654435761)) >>> 0;
}
