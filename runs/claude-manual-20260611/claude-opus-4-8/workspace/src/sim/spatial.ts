/**
 * T12 — Uniform-grid spatial hash for O(local) radius queries.
 *
 * `SpatialHash` partitions the 2-D world into a regular grid of square cells
 * of `cellSize` tiles. Each unit's position is hashed into the cell that
 * contains it; a radius query only visits the cells that overlap the query
 * disk, giving O(k) per query (k = entities in the overlapping cells) instead
 * of O(n) brute-force.
 *
 * ## Determinism
 * `queryRadius` returns EntityIds sorted in ascending numeric order so
 * consumers (separation pass, auto-acquire) produce the same results as the
 * previous brute-force scans, which also processed entities in sorted order.
 *
 * ## No module-level per-world state
 * `SpatialHash` is a plain class: callers construct one per world and store it
 * on `World.spatial`. Two worlds stepped interleaved never share hash state.
 */

import type { EntityId } from "../game/types.js";

/** A 2-D fractional position (tile coordinates). */
export interface SpatialPointF {
  readonly x: number;
  readonly y: number;
}

/**
 * Uniform-grid spatial hash.
 *
 * Usage per tick:
 *   1. Call `rebuild(units)` with the current unit map.
 *   2. Call `queryRadius(pos, r)` as many times as needed this tick.
 *
 * The hash uses two parallel maps:
 *   - `cells`: cellKey → EntityId[] (for fast cell iteration)
 *   - `posCache`: EntityId → position (for exact distance filter in queryRadius)
 */
export class SpatialHash {
  /** Cell side length in tiles. */
  readonly cellSize: number;

  /** Flat cell-key → EntityId[] map (rebuilt each tick). */
  private readonly cells: Map<number, EntityId[]> = new Map();

  /**
   * Position cache populated during `rebuild`. Maps EntityId → position so
   * `queryRadius` can do the exact distance filter without re-reading the
   * caller's unit map.
   */
  private readonly posCache: Map<EntityId, SpatialPointF> = new Map();

  /**
   * @param cellSize - Cell side length in world-tile units. A value in the
   *   range 2–6 works well for separation queries (radius ≈ 1 tile) and combat
   *   sight queries (radius 6–8 tiles). Defaults to 4.
   */
  constructor(cellSize: number = 4) {
    this.cellSize = cellSize;
  }

  /**
   * Clears the hash and re-inserts every entry in `units`.
   *
   * Complexity: O(n) where n = `units.size`.
   * Called once per tick (before movement and combat phases).
   */
  rebuild(units: ReadonlyMap<EntityId, { pos: SpatialPointF }>): void {
    this.cells.clear();
    this.posCache.clear();

    for (const [id, unit] of units) {
      const pos = unit.pos;
      this.posCache.set(id, pos);

      const cx = Math.floor(pos.x / this.cellSize);
      const cy = Math.floor(pos.y / this.cellSize);
      const key = cellKey(cx, cy);
      let bucket = this.cells.get(key);
      if (bucket === undefined) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push(id);
    }
  }

  /**
   * Returns all EntityIds whose recorded position is within Euclidean distance
   * `r` of `pos`, sorted in ascending numeric order for determinism.
   *
   * The query visits every cell that overlaps the axis-aligned bounding box of
   * the disk [pos.x ± r, pos.y ± r], then filters by the exact Euclidean
   * distance. No entity is missed; the only false-positive cost is the
   * per-entity distance check for entities in corner cells that are inside the
   * AABB but outside the disk.
   *
   * Complexity: O(k + m log m) where k = entities in the candidate cells and
   * m = entities within the radius (k ≥ m; the sort is over the result set,
   * not all candidates).
   */
  queryRadius(pos: SpatialPointF, r: number): EntityId[] {
    const r2 = r * r;
    const minCX = Math.floor((pos.x - r) / this.cellSize);
    const maxCX = Math.floor((pos.x + r) / this.cellSize);
    const minCY = Math.floor((pos.y - r) / this.cellSize);
    const maxCY = Math.floor((pos.y + r) / this.cellSize);

    const result: EntityId[] = [];

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (bucket === undefined) continue;
        for (const id of bucket) {
          const p = this.posCache.get(id);
          if (p === undefined) continue;
          const dx = p.x - pos.x;
          const dy = p.y - pos.y;
          if (dx * dx + dy * dy <= r2) {
            result.push(id);
          }
        }
      }
    }

    // Sort ascending by numeric EntityId for determinism.
    result.sort((a, b) => a - b);
    return result;
  }
}

/**
 * Encode a signed 2-D cell coordinate into a single numeric key.
 *
 * The shift of 32768 keeps keys distinct for coordinate ranges expected in a
 * ≤64 000-tile world (cellSize ≥ 1 → max |cx|/|cy| < 65 536). The resulting
 * key fits in a safe JS integer (< 2^53).
 */
function cellKey(cx: number, cy: number): number {
  const ux = cx + 32768;
  const uy = cy + 32768;
  return uy * 65536 + ux;
}
