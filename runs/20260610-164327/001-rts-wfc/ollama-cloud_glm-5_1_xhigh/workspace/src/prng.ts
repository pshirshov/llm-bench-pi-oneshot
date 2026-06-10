// Mulberry32 seeded PRNG — all game randomness flows through this
export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] (inclusive) */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns a float in [min, max) */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Shuffle an array in place using Fisher-Yates */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Pick a random element */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /** Pick using weights; items is [value, weight][] */
  pickWeighted<T>(items: [T, number][]): T {
    const total = items.reduce((s, it) => s + it[1], 0);
    let r = this.next() * total;
    for (const [val, w] of items) {
      r -= w;
      if (r <= 0) return val;
    }
    return items[items.length - 1][0];
  }

  /** Get current state for save/restore */
  getState(): number {
    return this.state;
  }

  /** Restore state */
  setState(s: number): void {
    this.state = s;
  }
}