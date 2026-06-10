import { Rng } from '../core/rng';
import { ADJACENCY_MASK, FULL_MASK, Tile, TILE_COUNT } from './tiles';

export interface WfcConfig {
  width: number;
  height: number;
  /** Per-tile selection weight, indexed by Tile. */
  weights: readonly number[];
  /** Restart budget before giving up (contradictions trigger a restart). */
  maxRestarts?: number;
}

export interface WfcResult {
  tiles: Uint8Array; // Tile per cell, row-major
  restarts: number;
}

/**
 * Wave Function Collapse over a single-tile adjacency model:
 *  - every cell starts as a superposition (bitmask) of all tiles
 *  - repeatedly pick the cell with minimal positive Shannon entropy
 *    (weighted), collapse it to one tile sampled by weight, and propagate
 *    the adjacency constraints to neighbours until a fixpoint
 *  - a contradiction (empty domain) restarts the run with a derived seed
 */
export function runWfc(cfg: WfcConfig, rng: Rng): WfcResult {
  const maxRestarts = cfg.maxRestarts ?? 50;
  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    const result = tryCollapse(cfg, new Rng(rng.deriveSeed()));
    if (result !== null) return { tiles: result, restarts: attempt };
  }
  throw new Error(`WFC failed after ${maxRestarts} restarts`);
}

function tryCollapse(cfg: WfcConfig, rng: Rng): Uint8Array | null {
  const { width: w, height: h, weights } = cfg;
  const n = w * h;
  const domains = new Int32Array(n).fill(FULL_MASK);

  // Per-mask Shannon entropy is memoised: with 6 tiles there are only 64
  // possible masks.
  const entropyByMask = new Float64Array(1 << TILE_COUNT);
  for (let mask = 1; mask < 1 << TILE_COUNT; mask++) {
    let sum = 0;
    let sumLog = 0;
    for (let t = 0; t < TILE_COUNT; t++) {
      if (mask & (1 << t)) {
        const wgt = weights[t];
        if (wgt > 0) {
          sum += wgt;
          sumLog += wgt * Math.log(wgt);
        }
      }
    }
    entropyByMask[mask] = sum <= 0 ? 0 : Math.log(sum) - sumLog / sum;
  }

  // Minimal-entropy selection through a priority queue with versioned
  // entries (stale entries are skipped on pop). Deterministic tiny noise
  // breaks ties reproducibly.
  const version = new Int32Array(n);
  const heapKeys: number[] = [];
  const heapVals: number[] = []; // cell index
  const heapVers: number[] = []; // version stamp at push time

  const heapPush = (key: number, val: number, ver: number): void => {
    heapKeys.push(key);
    heapVals.push(val);
    heapVers.push(ver);
    let i = heapKeys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKeys[p] <= heapKeys[i]) break;
      [heapKeys[p], heapKeys[i]] = [heapKeys[i], heapKeys[p]];
      [heapVals[p], heapVals[i]] = [heapVals[i], heapVals[p]];
      [heapVers[p], heapVers[i]] = [heapVers[i], heapVers[p]];
      i = p;
    }
  };

  const heapPop = (): [number, number] | null => {
    if (heapKeys.length === 0) return null;
    const val = heapVals[0];
    const ver = heapVers[0];
    const lk = heapKeys.pop()!;
    const lv = heapVals.pop()!;
    const lr = heapVers.pop()!;
    if (heapKeys.length > 0) {
      heapKeys[0] = lk;
      heapVals[0] = lv;
      heapVers[0] = lr;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heapKeys.length && heapKeys[l] < heapKeys[m]) m = l;
        if (r < heapKeys.length && heapKeys[r] < heapKeys[m]) m = r;
        if (m === i) break;
        [heapKeys[m], heapKeys[i]] = [heapKeys[i], heapKeys[m]];
        [heapVals[m], heapVals[i]] = [heapVals[i], heapVals[m]];
        [heapVers[m], heapVers[i]] = [heapVers[i], heapVers[m]];
        i = m;
      }
    }
    return [val, ver];
  };

  const enqueue = (i: number): void => {
    version[i]++;
    heapPush(entropyByMask[domains[i]] + rng.next() * 1e-6, i, version[i]);
  };
  for (let i = 0; i < n; i++) enqueue(i);

  const stack: number[] = [];

  const propagate = (start: number): boolean => {
    stack.length = 0;
    stack.push(start);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const mask = domains[idx];
      // Union of tiles allowed next to anything still possible at idx.
      let allowedNeighbours = 0;
      for (let t = 0; t < TILE_COUNT; t++) {
        if (mask & (1 << t)) allowedNeighbours |= ADJACENCY_MASK[t];
      }
      const x = idx % w;
      const y = (idx / w) | 0;
      const neighbours = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ];
      for (const nb of neighbours) {
        if (nb < 0) continue;
        const before = domains[nb];
        const after = before & allowedNeighbours;
        if (after === before) continue;
        if (after === 0) return false; // contradiction
        domains[nb] = after;
        if ((after & (after - 1)) !== 0) enqueue(nb);
        stack.push(nb);
      }
    }
    return true;
  };

  for (;;) {
    // Pop the live minimal-entropy cell (skip stale/collapsed entries).
    let best = -1;
    for (;;) {
      const top = heapPop();
      if (top === null) break;
      const [i, ver] = top;
      if (version[i] !== ver) continue; // stale entry
      if ((domains[i] & (domains[i] - 1)) === 0) continue; // collapsed
      best = i;
      break;
    }
    if (best === -1) break; // fully collapsed

    // Weighted sample among the remaining domain.
    const mask = domains[best];
    let total = 0;
    for (let t = 0; t < TILE_COUNT; t++) {
      if (mask & (1 << t)) total += weights[t];
    }
    if (total <= 0) return null;
    let r = rng.next() * total;
    let chosen: Tile = Tile.Grass;
    for (let t = 0; t < TILE_COUNT; t++) {
      if (mask & (1 << t)) {
        r -= weights[t];
        chosen = t as Tile;
        if (r <= 0) break;
      }
    }
    domains[best] = 1 << chosen;
    if (!propagate(best)) return null;
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 31 - Math.clz32(domains[i]);
  }
  return out;
}
