// Seeded PRNG (mulberry32). Math.random appears ONLY in this module (and only to
// generate a fresh default seed when no ?seed= URL param is given).
//
// Game code MUST import { rng } from "./rng" and use rng.next()/rng.int()/etc.
// ESLint enforces this via a global "no-restricted-properties" rule that
// disables only inside this file.

export interface Rng {
  readonly seed: number;
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns an integer in [0, n). */
  int(n: number): number;
  /** Returns an integer in [a, b]. */
  range(a: number, b: number): number;
  /** Fisher-Yates in place. */
  shuffle<T>(arr: T[]): T[];
  /** Returns true with probability p. */
  chance(p: number): boolean;
  /** Returns one of the values uniformly. */
  pick<T>(values: readonly T[]): T;
  /** Returns a child RNG by mixing the current seed with a tag. */
  child(tag: string | number): Rng;
}

function mix(seed: number): number {
  // xorshift32 mix to avoid degenerate low-entropy seeds
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}

function hashSeed(seed: number, tag: string | number): number {
  // FNV-1a-ish mix with string tag
  const s = `${seed}::${tag}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class Mulberry32 implements Rng {
  private state: number;
  public readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = mix(this.seed) >>> 0;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n);
  }

  range(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error("Rng.pick called with empty array");
    }
    const idx = this.int(values.length);
    return values[idx] as T;
  }

  child(tag: string | number): Rng {
    return new Mulberry32(hashSeed(this.seed, tag));
  }
}

export function makeRng(seed: number): Rng {
  return new Mulberry32(seed);
}

/** Generate a fresh seed from Math.random. ONLY call this for a default seed. */
export function makeRandomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
