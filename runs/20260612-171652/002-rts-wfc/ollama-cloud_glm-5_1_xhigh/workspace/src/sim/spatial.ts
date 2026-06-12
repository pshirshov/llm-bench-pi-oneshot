/** Spatial hash grid for efficient range queries. */

import type { Unit } from "./types";

const CELL_SIZE = 4;

export class SpatialHash {
  private cells: Map<number, Unit[]> = new Map();
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(unit: Unit): void {
    const cx = Math.floor(unit.x / CELL_SIZE);
    const cy = Math.floor(unit.y / CELL_SIZE);
    const key = cx * 10000 + cy;
    let cell = this.cells.get(key);
    if (!cell) { cell = []; this.cells.set(key, cell); }
    cell.push(unit);
  }

  query(x: number, y: number, radius: number): Unit[] {
    const results: Unit[] = [];
    const minCX = Math.floor((x - radius) / CELL_SIZE);
    const maxCX = Math.floor((x + radius) / CELL_SIZE);
    const minCY = Math.floor((y - radius) / CELL_SIZE);
    const maxCY = Math.floor((y + radius) / CELL_SIZE);
    const r2 = radius * radius;

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const key = cx * 10000 + cy;
        const cell = this.cells.get(key);
        if (!cell) continue;
        for (const unit of cell) {
          const dx = unit.x - x;
          const dy = unit.y - y;
          if (dx * dx + dy * dy <= r2) {
            results.push(unit);
          }
        }
      }
    }
    return results;
  }

  queryTile(col: number, row: number): Unit[] {
    return this.query(col + 0.5, row + 0.5, 1.5);
  }
}