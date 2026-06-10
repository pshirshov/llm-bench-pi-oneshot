// Wave Function Collapse map generator.
//
// Implementation notes:
//   - "Cells" are tiles; "states" are tile IDs.
//   - Each cell holds a *set* of possible states (a wave).
//   - Collapse: pick the cell with minimum entropy (>1), collapse it to a single
//     state weighted by TILES[*].weight, then propagate adjacency constraints.
//   - Propagation: for each neighbor, intersect its wave with the allowed set of
//     the just-collapsed cell (or the union if a partial wave).
//   - On contradiction (empty wave), we restart the whole collapse with the
//     SAME seed-derivable state — i.e. we re-derive seeds and try again a
//     bounded number of times. The final map is fully deterministic for a given
//     seed.
//   - "Adjacency" here is the standard WFC style: we declare for every tile T
//     and every direction D the set of tiles that may appear in T's neighbor
//     in that direction. Symmetric (if A allows B above, B allows A below).
//   - 4-neighbor (N/E/S/W) is used; diagonal cells can have any combination.
//   - 1x1 tiles mean no corner-cutting block needed at the WFC level; the
//     runtime grid later enforces movement rules.

import { TILE_IDS, TILES, type TileId } from './data.js';
import { makeRng, rngWeighted, type Rng } from './rng.js';

export interface AdjacencyRules {
  // for each tile id, the set of tiles allowed in each of the 4 directions
  // directions: 0=N,1=E,2=S,3=W
  rules: Record<TileId, TileId[][]>;
}

// Build adjacency rules. The set encodes "what can sit to the NORTH of X" etc.
export function defaultAdjacency(): AdjacencyRules {
  // water borders water, dirt, or grass (shorelines); never rock, forest, or gold.
  const waterSurround: TileId[] = ['water', 'dirt', 'grass'];
  // forest prefers grass/dirt/forest; never water/rock/gold_mine
  const forestSurround: TileId[] = ['grass', 'dirt', 'forest'];
  // rock sits in rock/dirt/grass; never water/forest/gold_mine
  const rockSurround: TileId[] = ['rock', 'dirt', 'grass'];
  // gold mine sits in grass/dirt clearings
  const goldSurround: TileId[] = ['grass', 'dirt'];
  // grass/dirt are fully permissive land tiles (any tile is fine — they form
  // shorelines, clearings, paths through everything).
  const landSurround: TileId[] = ['grass', 'dirt', 'forest', 'rock', 'gold_mine', 'water'];

  const rules: Record<TileId, TileId[][]> = {
    grass:     [landSurround,   landSurround,   landSurround,   landSurround],
    dirt:      [landSurround,   landSurround,   landSurround,   landSurround],
    forest:    [forestSurround, forestSurround, forestSurround, forestSurround],
    water:     [waterSurround,  waterSurround,  waterSurround,  waterSurround],
    rock:      [rockSurround,   rockSurround,   rockSurround,   rockSurround],
    gold_mine: [goldSurround,   goldSurround,   goldSurround,   goldSurround],
  };
  return { rules };
}

export interface WFCOptions {
  width: number;
  height: number;
  seed: number;
  // Optional: cap propagation iterations to avoid runaway on a corrupt map.
  maxRestarts?: number;
}

// Compact wave: Uint8 bitmask indexed by TileId index.
const TILE_BIT = (i: number): number => 1 << i;
const ALL_BITS = ((): number => {
  let m = 0;
  for (let i = 0; i < TILE_IDS.length; i++) m |= TILE_BIT(i);
  return m;
})();

function popcount(x: number): number {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

// Random index of a set bit in mask, weighted by tile weight.
function weightedPick(rng: Rng, mask: number): TileId | null {
  const items: TileId[] = [];
  const weights: number[] = [];
  for (let i = 0; i < TILE_IDS.length; i++) {
    if (mask & TILE_BIT(i)) {
      items.push(TILE_IDS[i] as TileId);
      weights.push(TILES[TILE_IDS[i] as TileId].weight);
    }
  }
  if (items.length === 0) return null;
  return rngWeighted(rng, items, weights);
}

export interface WFCResult {
  tiles: TileId[]; // length = width*height, row-major
  width: number;
  height: number;
  seed: number;
}

class Collapser {
  readonly width: number;
  readonly height: number;
  readonly adj: AdjacencyRules;
  readonly rng: Rng;
  wave: Uint8Array;        // bitmask per cell
  entropyNoise: Float32Array; // tiny per-cell random bias to break ties consistently

  constructor(width: number, height: number, adj: AdjacencyRules, rng: Rng) {
    this.width = width;
    this.height = height;
    this.adj = adj;
    this.rng = rng;
    const n = width * height;
    this.wave = new Uint8Array(n);
    this.wave.fill(ALL_BITS);
    this.entropyNoise = new Float32Array(n);
    for (let i = 0; i < n; i++) this.entropyNoise[i] = rng();
  }

  idx(x: number, y: number): number { return y * this.width + x; }

  // Direction lookup: neighbor (dx,dy) and the direction index the *center* cell uses.
  // 0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x)
  static DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  // Compute the set of tile IDs a cell *can* see in the given direction given its wave.
  private possibleInDir(cellMask: number, dir: number): number {
    let result = 0;
    for (let i = 0; i < TILE_IDS.length; i++) {
      if (!(cellMask & TILE_BIT(i))) continue;
      const id = TILE_IDS[i] as TileId;
      const allowed = this.adj.rules[id][dir];
      if (!allowed) continue;
      for (const t of allowed) {
        const j = TILE_IDS.indexOf(t);
        result |= TILE_BIT(j);
      }
    }
    return result;
  }

  // Propagate from a single cell. Returns false on contradiction.
  private propagate(startIdx: number): boolean {
    const stack: number[] = [startIdx];
    const seen = new Set<number>([startIdx]);
    while (stack.length > 0) {
      const ci = stack.pop();
      if (ci === undefined) break;
      const cx = ci % this.width;
      const cy = (ci / this.width) | 0;
      const cmask = this.wave[ci] as number;
      for (let d = 0; d < 4; d++) {
        const dir = Collapser.DIRS[d];
        if (!dir) continue;
        const [dx, dy] = dir;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
        const ni = this.idx(nx, ny);
        const before = this.wave[ni] as number;
        // the center can push any of its possible tiles into direction d; the
        // neighbor's mask must be a subset of the union of those allowed sets.
        const allowed = this.possibleInDir(cmask, d);
        const after = before & allowed;
        if (after !== before) {
          if (after === 0) return false;
          this.wave[ni] = after;
          if (!seen.has(ni)) {
            seen.add(ni);
            stack.push(ni);
          }
        }
      }
    }
    return true;
  }

  // Pick the cell with minimum entropy > 1. Use popcount instead of Shannon
  // entropy for speed (O(1) vs O(log) per cell).
  private pickMinEntropy(): number {
    let bestIdx = -1;
    let bestEntropy = Infinity;
    for (let i = 0; i < this.wave.length; i++) {
      const m = this.wave[i] as number;
      const p = popcount(m);
      if (p <= 1) continue;
      // Tiebreak by tiny noise to keep determinism.
      const e = p + (this.entropyNoise[i] as number) * 0.5;
      if (e < bestEntropy) {
        bestEntropy = e;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  collapseOnce(): boolean {
    while (true) {
      const idx = this.pickMinEntropy();
      if (idx < 0) return true; // all collapsed
      const m = this.wave[idx] as number;
      const pick = weightedPick(this.rng, m);
      if (!pick) return false;
      const j = TILE_IDS.indexOf(pick);
      this.wave[idx] = TILE_BIT(j);
      if (!this.propagate(idx)) return false;
    }
  }
}

export function generateWFC(opts: WFCOptions): WFCResult {
  const adj = defaultAdjacency();
  const maxRestarts = opts.maxRestarts ?? 8;
  let attempt = 0;
  // Each attempt uses a *derived* seed; this keeps the final result deterministic
  // for a given (seed) but lets the same input try different sub-states on retries.
  for (attempt = 0; attempt < maxRestarts; attempt++) {
    const sub = (opts.seed + attempt * 0x9e3779b1) | 0;
    const rng = makeRng(sub);
    const c = new Collapser(opts.width, opts.height, adj, rng);
    const ok = c.collapseOnce();
    if (!ok) continue;
    // All collapsed — extract
    const tiles: TileId[] = new Array(opts.width * opts.height);
    for (let i = 0; i < tiles.length; i++) {
      const m = c.wave[i] as number;
      let chosen: TileId | null = null;
      for (let b = 0; b < TILE_IDS.length; b++) {
        if (m & TILE_BIT(b)) { chosen = TILE_IDS[b] as TileId; break; }
      }
      if (!chosen) { chosen = 'grass'; }
      tiles[i] = chosen;
    }
    return { tiles, width: opts.width, height: opts.height, seed: opts.seed };
  }
  // Last resort: fill with grass so downstream post-process has something to chew on.
  // (The post-process repair pass is responsible for carving playable features.)
  const tiles: TileId[] = new Array(opts.width * opts.height);
  for (let i = 0; i < tiles.length; i++) tiles[i] = 'grass';
  return { tiles, width: opts.width, height: opts.height, seed: opts.seed };
}

// Re-export for tests
export const __test = { popcount, ALL_BITS, TILE_BIT, Collapser };
