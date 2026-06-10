/** A 2D vector / point in continuous world space (units = tiles). */
export interface Vec2 {
  x: number;
  y: number;
}

/** An integer tile coordinate. */
export interface TileCoord {
  tx: number;
  ty: number;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function tileKey(tx: number, ty: number): number {
  // Pack two non-negative tile coords into one number key (maps up to 96k wide).
  return ty * 100000 + tx;
}
