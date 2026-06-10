import type { Vec2 } from "../core/vec.js";

/**
 * Uniform-grid spatial hash for entity range queries. Rebuilt each tick from
 * the live entity set. Keeps target acquisition and avoidance neighbour lookups
 * near O(1) instead of O(n) per unit, so 100+ units stay within frame budget.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: number[][];

  constructor(width: number, height: number, cellSize = 4) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  clear(): void {
    for (const b of this.buckets) b.length = 0;
  }

  private bucketIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cellSize);
    let cy = Math.floor(y / this.cellSize);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  insert(id: number, pos: Vec2): void {
    this.buckets[this.bucketIndex(pos.x, pos.y)]!.push(id);
  }

  /** Append ids in cells overlapping the query circle into `out`. May include false positives outside the radius. */
  queryCircle(center: Vec2, radius: number, out: number[]): void {
    const minCx = Math.max(0, Math.floor((center.x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((center.x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((center.y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((center.y + radius) / this.cellSize));
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[cy * this.cols + cx]!;
        for (const id of bucket) out.push(id);
      }
    }
  }
}
