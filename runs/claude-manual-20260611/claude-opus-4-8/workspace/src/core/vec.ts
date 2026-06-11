/** Integer tile coordinate. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function vecEquals(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

export function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** The 8 cardinal + diagonal neighbor offsets, in order N NE E SE S SW W NW. */
export const NEIGHBOR_OFFSETS_8: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/** The 4 cardinal neighbor offsets, in order N E S W. */
export const NEIGHBOR_OFFSETS_4: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
