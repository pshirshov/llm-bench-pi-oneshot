import { NEIGHBOR_OFFSETS_4, NEIGHBOR_OFFSETS_8 } from "./vec.js";
import type { Vec2 } from "./vec.js";

/** Generic rectangular grid backed by a flat array. Row-major order: index = y * width + x. */
export class Grid<T> {
  readonly width: number;
  readonly height: number;
  private readonly data: T[];

  constructor(width: number, height: number, init: T | ((x: number, y: number) => T)) {
    this.width = width;
    this.height = height;
    const size = width * height;
    if (typeof init === "function") {
      const factory = init as (x: number, y: number) => T;
      this.data = Array.from({ length: size }, (_, i) => factory(i % width, Math.floor(i / width)));
    } else {
      this.data = Array.from({ length: size }, () => init as T);
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  inBoundsVec(v: Vec2): boolean {
    return this.inBounds(v.x, v.y);
  }

  get(x: number, y: number): T {
    if (!this.inBounds(x, y)) throw new RangeError(`Grid.get out of bounds: (${x}, ${y})`);
    return this.data[y * this.width + x];
  }

  getVec(v: Vec2): T {
    return this.get(v.x, v.y);
  }

  set(x: number, y: number, value: T): void {
    if (!this.inBounds(x, y)) throw new RangeError(`Grid.set out of bounds: (${x}, ${y})`);
    this.data[y * this.width + x] = value;
  }

  setVec(v: Vec2, value: T): void {
    this.set(v.x, v.y, value);
  }

  fill(value: T): void {
    this.data.fill(value);
  }

  /** Returns a new Grid where each cell is transformed by f. */
  map<U>(f: (value: T, x: number, y: number) => U): Grid<U> {
    return new Grid<U>(this.width, this.height, (x, y) => f(this.get(x, y), x, y));
  }

  /** Returns a new Grid that is a shallow copy of this one. */
  clone(): Grid<T> {
    return this.map((v) => v);
  }

  /** In-bounds 4-connected neighbors of (x, y). */
  neighbors4(x: number, y: number): Vec2[] {
    const result: Vec2[] = [];
    for (const off of NEIGHBOR_OFFSETS_4) {
      const nx = x + off.x;
      const ny = y + off.y;
      if (this.inBounds(nx, ny)) result.push({ x: nx, y: ny });
    }
    return result;
  }

  /** In-bounds 8-connected neighbors of (x, y). */
  neighbors8(x: number, y: number): Vec2[] {
    const result: Vec2[] = [];
    for (const off of NEIGHBOR_OFFSETS_8) {
      const nx = x + off.x;
      const ny = y + off.y;
      if (this.inBounds(nx, ny)) result.push({ x: nx, y: ny });
    }
    return result;
  }
}
