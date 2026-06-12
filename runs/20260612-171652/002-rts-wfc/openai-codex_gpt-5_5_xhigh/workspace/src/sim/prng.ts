import { DEFAULT_SEED } from './constants';

export interface Prng {
  next(): number;
  int(maxExclusive: number): number;
  range(minInclusive: number, maxExclusive: number): number;
  pickIndex(weights: readonly number[]): number;
  fork(offset: number): Prng;
  seed: number;
}

function normalizeSeed(seed: number): number {
  const normalized = seed >>> 0;
  return normalized === 0 ? DEFAULT_SEED : normalized;
}

export class Mulberry32 implements Prng {
  public readonly seed: number;
  private state: number;

  public constructor(seed: number) {
    this.seed = normalizeSeed(seed);
    this.state = this.seed;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public int(maxExclusive: number): number {
    if (maxExclusive <= 0) {
      throw new Error(`maxExclusive must be positive, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  public range(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      throw new Error(`invalid range ${minInclusive}..${maxExclusive}`);
    }
    return minInclusive + this.int(maxExclusive - minInclusive);
  }

  public pickIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      throw new Error('cannot pick from empty weight distribution');
    }
    let cursor = this.next() * total;
    for (let i = 0; i < weights.length; i += 1) {
      cursor -= weights[i];
      if (cursor <= 0) {
        return i;
      }
    }
    return weights.length - 1;
  }

  public fork(offset: number): Prng {
    return new Mulberry32((this.seed ^ Math.imul(offset + 1, 0x9e3779b9)) >>> 0);
  }
}

export function seedFromUrl(search: string): number {
  const params = new URLSearchParams(search);
  const value = params.get('seed');
  if (value === null) {
    return freshSeed();
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? normalizeSeed(parsed) : freshSeed();
}

export function freshSeed(): number {
  return normalizeSeed(Math.floor(Math.random() * 0xffffffff));
}
