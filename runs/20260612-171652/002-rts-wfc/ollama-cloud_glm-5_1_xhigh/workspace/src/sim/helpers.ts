/** Typed helper that narrows Map.get or throws. */
export function getOrThrow<T>(map: Map<number, T>, key: number, msg?: string): T {
  const v = map.get(key);
  if (v === undefined) throw new Error(msg ?? `Key ${key} not found in map`);
  return v;
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Distance between two points. */
export function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Manhattan distance on the tile grid. */
export function tileDist(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** Check if a number is finite and not NaN. */
export function isFiniteNumber(n: number): boolean {
  return Number.isFinite(n);
}

/** Assert a condition, throwing if false. */
export function assert(condition: boolean, msg?: string): void {
  if (!condition) throw new Error(msg ?? "Assertion failed");
}