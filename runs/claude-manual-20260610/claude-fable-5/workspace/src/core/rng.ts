/**
 * Seeded PRNG (mulberry32). Every source of randomness in the game flows
 * through an instance of this class so that any map/match is reproducible
 * from its seed.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** Uniform float in [lo, hi). */
  float(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick on empty array');
    return arr[this.int(arr.length)];
  }

  /** Derive a child seed deterministically (for sub-generators). */
  deriveSeed(): number {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }
}

/** Deterministic 32-bit hash combine, used to derive per-level seeds. */
export function hashCombine(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
