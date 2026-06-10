// Mulberry32: a tiny, fast 32-bit PRNG with good distribution for games.
// Deterministic given the same seed. NOT cryptographically secure.
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  if (a === 0) a = 0xdeadbeef;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  return mulberry32(seed);
}

export function rngInt(rng: Rng, min: number, maxInclusive: number): number {
  return Math.floor(rng() * (maxInclusive - min + 1)) + min;
}

export function rngPick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('rngPick on empty array');
  const idx = Math.floor(rng() * arr.length);
  // safe: arr is non-empty, idx < arr.length
  return arr[idx] as T;
}

export function rngWeighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  if (items.length !== weights.length) throw new Error('items/weights length mismatch');
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) throw new Error('non-positive total weight');
  let pick = rng() * total;
  for (let i = 0; i < items.length; i++) {
    pick -= weights[i] as number;
    if (pick <= 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}
