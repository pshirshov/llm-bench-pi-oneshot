import { Unit } from './state';

/**
 * Spatial hash over unit positions, rebuilt once per tick. Cells are
 * CELL_SIZE tiles wide; range queries visit only overlapping cells.
 */
const CELL_SIZE = 4;

export class SpatialHash {
  private cells: Map<number, Unit[]> = new Map();
  private readonly cols: number;

  constructor(mapWidth: number, mapHeight: number) {
    this.cols = Math.ceil(mapWidth / CELL_SIZE);
    // mapHeight kept for parity; the row count is implicit in the key space.
    void mapHeight;
  }

  private key(x: number, y: number): number {
    return ((y / CELL_SIZE) | 0) * this.cols + ((x / CELL_SIZE) | 0);
  }

  rebuild(units: readonly Unit[]): void {
    this.cells.clear();
    for (const u of units) {
      const k = this.key(u.x, u.y);
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(u);
      else this.cells.set(k, [u]);
    }
  }

  /** All units within `radius` tiles of (x, y). */
  query(x: number, y: number, radius: number): Unit[] {
    const out: Unit[] = [];
    const minCx = ((x - radius) / CELL_SIZE) | 0;
    const maxCx = ((x + radius) / CELL_SIZE) | 0;
    const minCy = ((y - radius) / CELL_SIZE) | 0;
    const maxCy = ((y + radius) / CELL_SIZE) | 0;
    const r2 = radius * radius;
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(cy * this.cols + cx);
        if (!bucket) continue;
        for (const u of bucket) {
          const dx = u.x - x;
          const dy = u.y - y;
          if (dx * dx + dy * dy <= r2) out.push(u);
        }
      }
    }
    return out;
  }
}
