/**
 * Small pure utilities used throughout. No side effects.
 */

import type { Vec2, Rect } from './types';

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return len(sub(a, b));
}

export function eq(a: Vec2, b: Vec2, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

export function floorVec(v: Vec2): Vec2 {
  return { x: Math.floor(v.x), y: Math.floor(v.y) };
}

export function tileCenter(tx: number, ty: number): Vec2 {
  return { x: tx + 0.5, y: ty + 0.5 };
}

export function isFiniteNum(n: number): boolean {
  return Number.isFinite(n) && !Number.isNaN(n);
}

// Typed get that throws instead of non-null
export function getOrThrow<K, V>(m: Map<K, V>, k: K, msg?: string): V {
  const v = m.get(k);
  if (v === undefined) throw new Error(msg ?? `Missing key ${String(k)} in map`);
  return v;
}

export function array2d<T>(w: number, h: number, fill: T): T[][] {
  const a: T[][] = [];
  for (let y = 0; y < h; y++) {
    const row: T[] = [];
    for (let x = 0; x < w; x++) row.push(fill);
    a.push(row);
  }
  return a;
}

export function copy2d<T>(src: T[][]): T[][] {
  return src.map(row => [...row]);
}
