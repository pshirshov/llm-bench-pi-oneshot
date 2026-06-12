import type { Point, Rect } from './types';

export function keyOf(point: Point): string {
  return `${point.x},${point.y}`;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function gridDistance(a: Point, b: Point): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const diagonal = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonal;
  return diagonal * Math.SQRT2 + straight;
}

export function rectContains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.w && point.y < rect.y + rect.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function centerOfRect(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mustGet<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`${label} not found: ${String(key)}`);
  }
  return value;
}

export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} is not finite`);
  }
}

export function inBounds(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function spiral(center: Point, radius: number): Point[] {
  const points: Point[] = [];
  for (let r = 0; r <= radius; r += 1) {
    for (let y = center.y - r; y <= center.y + r; y += 1) {
      for (let x = center.x - r; x <= center.x + r; x += 1) {
        if (Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) === r) {
          points.push({ x, y });
        }
      }
    }
  }
  return points;
}
