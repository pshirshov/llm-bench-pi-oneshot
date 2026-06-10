export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
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

  public chance(probability: number): boolean {
    if (probability < 0 || probability > 1) {
      throw new Error(`probability must be between 0 and 1, got ${probability}`);
    }
    return this.next() < probability;
  }

  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error('cannot pick from an empty list');
    }
    return values[this.int(values.length)]!;
  }

  public weighted<T>(entries: readonly { value: T; weight: number }[]): T {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) {
      throw new Error('weighted choice requires a positive total weight');
    }
    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) {
        return entry.value;
      }
    }
    return entries[entries.length - 1]!.value;
  }

  public fork(salt: number): SeededRandom {
    return new SeededRandom(mixSeed(this.state, salt));
  }

  public currentState(): number {
    return this.state >>> 0;
  }
}

export function mixSeed(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt >>> 0, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

export function seedFromQuery(search: string): number {
  const params = new URLSearchParams(search);
  const raw = params.get('seed');
  if (raw === null || raw.trim() === '') {
    return 13371337;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 13371337;
  }
  return parsed >>> 0;
}
