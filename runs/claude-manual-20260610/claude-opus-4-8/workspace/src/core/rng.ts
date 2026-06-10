/**
 * Single seeded pseudo-random number generator for the whole game.
 *
 * Uses mulberry32 — a small, fast, well-distributed 32-bit generator. Every
 * source of randomness in the simulation and map generation must flow through
 * an instance of {@link Rng} so that a given seed reproduces a run exactly.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force into an unsigned 32-bit integer; reject non-finite seeds early.
    if (!Number.isFinite(seed)) {
      throw new Error(`Rng seed must be a finite number, got ${seed}`);
    }
    this.state = seed >>> 0;
  }

  /** Current internal state, for snapshotting/forking. */
  get seedState(): number {
    return this.state;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      throw new Error(`Rng.int requires maxExclusive > 0, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    if (max < min) {
      throw new Error(`Rng.range requires max >= min, got [${min}, ${max}]`);
    }
    return min + this.int(max - min + 1);
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick one element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Rng.pick called on empty array");
    }
    return items[this.int(items.length)] as T;
  }

  /**
   * Pick an index according to positive weights. Returns the selected index.
   * The sum of weights must be > 0.
   */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) {
      if (w < 0) throw new Error("weights must be non-negative");
      total += w;
    }
    if (total <= 0) throw new Error("weightedIndex requires a positive weight sum");
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** In-place Fisher–Yates shuffle driven by this generator. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /**
   * Derive a new independent generator deterministically from this one.
   * Useful for giving subsystems (map gen, AI) their own reproducible streams.
   */
  fork(salt: number): Rng {
    const mixed = (Math.imul(this.state ^ salt, 0x9e3779b1) ^ (this.state >>> 13)) >>> 0;
    return new Rng(mixed);
  }
}

/**
 * Deterministically derive a 32-bit seed from a base seed and a level index,
 * so a campaign (baseSeed) yields a stable map per level.
 */
export function deriveSeed(baseSeed: number, levelIndex: number): number {
  let h = (baseSeed >>> 0) ^ Math.imul(levelIndex + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
