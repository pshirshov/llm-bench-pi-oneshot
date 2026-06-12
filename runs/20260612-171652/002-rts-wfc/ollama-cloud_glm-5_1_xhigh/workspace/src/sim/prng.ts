/** Seeded PRNG using mulberry32. All randomness in the game flows through this module. */

export interface PRNG {
  next(): number;
  nextInt(min: number, max: number): number;
  nextBool(weight?: number): boolean;
  fork(): PRNG;
  seed: number;
}

function mulberry32(state: number): () => number {
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextInt32FromPRNG(next: () => number): number {
  const a = Math.floor(next() * 0x10000);
  const b = Math.floor(next() * 0x10000);
  return (a << 16) | b;
}

export function createPRNG(seed: number): PRNG {
  const raw = mulberry32(seed);
  const next = (): number => raw();

  return {
    seed,
    next,
    nextInt(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    nextBool(weight: number = 0.5): boolean {
      return next() < weight;
    },
    fork(): PRNG {
      return createPRNG(nextInt32FromPRNG(next));
    },
  };
}

export function parseSeedParam(url: string): number | undefined {
  const params = new URLSearchParams(url.indexOf("?") >= 0 ? url.slice(url.indexOf("?")) : "");
  const s = params.get("seed");
  if (s === null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function freshSeed(): number {
  // This is the ONLY place Math.random may appear, per the ESLint override.
  return Math.floor(Math.random() * 2147483647);
}