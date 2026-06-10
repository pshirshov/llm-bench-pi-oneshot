// Pure math + grid helpers. No engine code.

export const SQRT2 = Math.SQRT2;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function chebyshevRange(ax: number, ay: number, bx: number, by: number, range: number): boolean {
  return Math.abs(ax - bx) <= range && Math.abs(ay - by) <= range;
}

// Octile distance heuristic for 8-dir A* on uniform-cost tiles.
export function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const min = ax < ay ? ax : ay;
  const max = ax < ay ? ay : ax;
  return (max - min) + SQRT2 * min;
}

export interface Grid {
  width: number;
  height: number;
}

// In-bounds test.
export function inBounds(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.width && y < g.height;
}
