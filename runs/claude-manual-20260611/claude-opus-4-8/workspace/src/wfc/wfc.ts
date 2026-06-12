/**
 * A genuine tiled Wave Function Collapse solver.
 *
 * This is REAL WFC — minimal-entropy cell selection plus adjacency-constraint
 * propagation to a fixpoint — NOT noise and NOT uniform random scatter.
 *
 * Each cell holds a *domain*: a bitmask of the tiles still permitted there.
 * The main loop repeats:
 *   1. select the undecided cell of minimal (Shannon) entropy, RNG tie-break;
 *   2. collapse it to a single tile, chosen weighted by TILE_WEIGHTS;
 *   3. propagate: a stack-based worklist removes, from every neighbour, any
 *      tile that has lost all support (no allowed neighbour permits it),
 *      cascading until no domain changes (a fixpoint);
 *   4. if a domain ever empties (a contradiction), abandon the attempt and
 *      restart from a freshly forked RNG, up to a bounded number of attempts.
 *
 * All randomness flows through the injected RNG (src/core/rng.ts); this module
 * never draws from the global PRNG.
 */

import { Grid } from "../core/grid.js";
import type { RNG } from "../core/rng.js";
import {
  ADJACENCY_MASKS,
  FULL_DOMAIN,
  TILE_COUNT,
  TILE_TYPES,
  TILE_WEIGHTS,
  domainSize,
} from "./tiles.js";
import type { Domain, TileType, WeightTable } from "./tiles.js";

/** Bounded number of full re-collapse attempts before giving up. */
const MAX_ATTEMPTS = 50;

/**
 * Per-tile collapse weight (and ln(weight)) indexed by bit position. Derived
 * from a `WeightTable` for the duration of one `solve` so the table can vary per
 * call (e.g. a scarcity-scaled table) WITHOUT any module-level mutable state.
 * `weight` is the raw weight used by `weightedPick`; `weightLog` is `ln(weight)`
 * precomputed for the entropy formula.
 */
interface IndexedWeights {
  readonly weight: readonly number[];
  readonly weightLog: readonly number[];
}

function indexWeights(table: WeightTable): IndexedWeights {
  const weight = TILE_TYPES.map((t) => table[t]);
  return { weight, weightLog: weight.map((w) => Math.log(w)) };
}

/** Default indexed weights (base `TILE_WEIGHTS`); reused when no table is given. */
const DEFAULT_WEIGHTS: IndexedWeights = indexWeights(TILE_WEIGHTS);

/**
 * Shannon entropy of a domain given the tile weights.  Lower entropy ⇒ fewer /
 * more lopsided options ⇒ a better (more constrained) cell to collapse next.
 *   H = log(W) - (Σ wᵢ·log wᵢ) / W,  W = Σ wᵢ over allowed tiles i.
 * A fully-collapsed domain (one tile) has entropy 0.
 */
function entropy(domain: Domain, w: IndexedWeights): number {
  let sumW = 0;
  let sumWLog = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((domain & (1 << i)) !== 0) {
      const wi = w.weight[i];
      sumW += wi;
      sumWLog += wi * w.weightLog[i];
    }
  }
  if (sumW <= 0) return 0;
  return Math.log(sumW) - sumWLog / sumW;
}

/**
 * Picks one tile bit-index from a domain, weighted by the given weight table,
 * using the RNG.  Precondition: the domain is non-empty.
 */
function weightedPick(domain: Domain, rng: RNG, w: IndexedWeights): number {
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((domain & (1 << i)) !== 0) total += w.weight[i];
  }
  // rng.next() ∈ [0,1); scale into [0,total).
  let r = rng.next() * total;
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((domain & (1 << i)) !== 0) {
      r -= w.weight[i];
      if (r < 0) return i;
    }
  }
  // Floating-point fallthrough: return the highest allowed bit.
  for (let i = TILE_COUNT - 1; i >= 0; i--) {
    if ((domain & (1 << i)) !== 0) return i;
  }
  throw new Error("weightedPick called on empty domain");
}

/**
 * The set of tiles permitted *opposite* a cell whose domain is `domain`:
 * the union, over every tile still allowed in `domain`, of that tile's
 * allowed-neighbour mask.  A neighbour tile survives only if it lies in this
 * support mask.
 */
function supportMask(domain: Domain): Domain {
  let mask = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((domain & (1 << i)) !== 0) mask |= ADJACENCY_MASKS[i];
  }
  return mask;
}

/** 4-neighbour offsets (propagation is orthogonal, matching the adjacency model). */
const OFFSETS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Result of one collapse attempt: either a fully-decided domain grid or a
 * contradiction marker.
 */
type AttemptResult =
  | { readonly ok: true; readonly domains: Grid<Domain> }
  | { readonly ok: false };

/**
 * Runs a single WFC attempt over a fresh domain grid using `rng` and the given
 * indexed weights. Returns ok:false on contradiction (an emptied domain).
 */
function runAttempt(width: number, height: number, rng: RNG, w: IndexedWeights): AttemptResult {
  const domains = new Grid<Domain>(width, height, FULL_DOMAIN);

  /**
   * Propagates constraints starting from `(sx, sy)` to a fixpoint.
   * Returns false if any domain empties (contradiction).
   */
  const propagate = (sx: number, sy: number): boolean => {
    const stack: [number, number][] = [[sx, sy]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const support = supportMask(domains.get(cx, cy));
      for (const [dx, dy] of OFFSETS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!domains.inBounds(nx, ny)) continue;
        const before = domains.get(nx, ny);
        const after = before & support;
        if (after === before) continue; // no change ⇒ no need to revisit
        if (after === 0) return false; // contradiction
        domains.set(nx, ny, after);
        stack.push([nx, ny]);
      }
    }
    return true;
  };

  let remaining = width * height;

  while (remaining > 0) {
    // (1) minimal-entropy cell selection with seeded random tie-break.
    let bestX = -1;
    let bestY = -1;
    let bestEntropy = Number.POSITIVE_INFINITY;
    let tieCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d = domains.get(x, y);
        if (domainSize(d) <= 1) continue; // already decided (or contradiction)
        const h = entropy(d, w);
        if (h < bestEntropy - 1e-9) {
          bestEntropy = h;
          bestX = x;
          bestY = y;
          tieCount = 1;
        } else if (h <= bestEntropy + 1e-9) {
          // Reservoir tie-break: each equally-minimal cell has equal chance.
          tieCount++;
          if (rng.int(tieCount) === 0) {
            bestX = x;
            bestY = y;
          }
        }
      }
    }

    if (bestX === -1) break; // nothing left with >1 option

    // (2) collapse the chosen cell, weighted by the active weight table.
    const chosenBit = weightedPick(domains.get(bestX, bestY), rng, w);
    domains.set(bestX, bestY, 1 << chosenBit);

    // (3) propagate to a fixpoint; bail on contradiction.
    if (!propagate(bestX, bestY)) return { ok: false };

    remaining = countUndecided(domains);
  }

  return { ok: true, domains };
}

/** Number of cells whose domain still has more than one option. */
function countUndecided(domains: Grid<Domain>): number {
  let n = 0;
  for (let y = 0; y < domains.height; y++) {
    for (let x = 0; x < domains.width; x++) {
      if (domainSize(domains.get(x, y)) > 1) n++;
    }
  }
  return n;
}

/** Bit index → tile type. */
function bitToTile(domain: Domain): TileType {
  for (let i = 0; i < TILE_COUNT; i++) {
    if (domain === 1 << i) return TILE_TYPES[i];
  }
  throw new Error(`bitToTile: domain ${domain} is not a singleton`);
}

/**
 * Solves a `width` x `height` map with Wave Function Collapse.
 *
 * Deterministic in (width, height, rng, weights): the same seeded RNG and weight
 * table yield the same grid every time.  On contradiction the attempt is
 * abandoned and retried from a freshly forked RNG (labelled by attempt number,
 * so the retry stream is itself deterministic) up to MAX_ATTEMPTS.  Returns null
 * only if every bounded attempt contradicts — which, for these permissive rules,
 * should be rare.
 *
 * `weights` defaults to the base `TILE_WEIGHTS`; passing a different table (e.g.
 * a scarcity-scaled one) only changes collapse frequencies, never the adjacency
 * constraints, so every emitted grid still satisfies the adjacency rules. When
 * the table IS the base `TILE_WEIGHTS` (object identity), the precomputed default
 * indexed weights are reused so the no-scarcity path is bit-identical to before.
 */
export function solve(
  width: number,
  height: number,
  rng: RNG,
  weights: WeightTable = TILE_WEIGHTS,
): Grid<TileType> | null {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`solve: dimensions must be positive, got ${width}x${height}`);
  }

  const w = weights === TILE_WEIGHTS ? DEFAULT_WEIGHTS : indexWeights(weights);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Each attempt draws from an independent, deterministic substream so that
    // attempt N is reproducible and uncorrelated with attempt N-1.
    const attemptRng = rng.fork(`wfc-attempt-${attempt}`);
    const result = runAttempt(width, height, attemptRng, w);
    if (result.ok) {
      return result.domains.map((d) => bitToTile(d));
    }
  }

  return null;
}
