# Results addendum — claude-manual-20260610 (001-rts-wfc, out-of-matrix)

One-off `claude -p` shellouts, same prompt as run 20260610-164327. NOT part of the
benchmark matrix; comparability caveats at the bottom. Validated by claude-fable-5[1m]
with the same methodology (automated battery via `nix develop -c`, code review from
source with file:line evidence).

Cells: claude-fable-5 (xhigh-equivalent default) 1970s · claude-opus-4-8 2648s.
Both exit 0.

## Scores (same rubric as the pi run)

| Item | fable-5 | opus-4.8 |
|---|---|---|
| A1–A8 automated | 8/8 | 8/8 |
| R1 WFC authenticity | 2 | 2 |
| R2 playability pass | 2 | 2 |
| R3 pathfinding | 2 | 2 |
| R4 architecture | 2 | 2 |
| R5 AI structure | 2 | 2 |
| R6 type discipline | 2 | 2 |
| R7 smells | 2 | 2 |
| **Total /22** | **22** | **22** |

Automated detail: install/build/strict-typecheck/lint/test all exit 0 for both; preview
serves 200 with bundle; zero runtime deps, no lifecycle hooks. Tests: fable 27 cases /
75 assertions in 5 files; opus 28 cases / 69 assertions in 5 files. Math.random: fable 0
(seed fallback uses `Date.now()>>>0`, `main.ts:14-23`); opus 1, fallback campaign seed
only (`main.ts:38`) — same accepted pattern as glm.

## Per-cell findings

### claude-fable-5 — 22/22

- WFC: versioned priority-queue minimal-entropy selection with memoized Shannon
  entropy, bitmask domains, stack propagation, restart on contradiction
  (`map/wfc.ts:35-189`; adjacency table `map/tiles.ts:29-41`).
- Playability: WFC → start placement → per-start gold/forest guarantees → BFS
  reachability with Bresenham corridor carving (`map/gamemap.ts:45-266`).
- A*: min-heap, octile, corner-cut guard, plus an "approach mode" for blocked targets
  (`game/path.ts:82-168`); spatial-hash collision resolution with a deterministic
  separation axis (`game/sim.ts:580-604`).
- AI: think-interval loop (defend → workers → construction → training → waves) and the
  only artifact in the experiment that explicitly REBUILDS a destroyed Town Hall first
  (`game/ai.ts:160-177`).
- Type discipline: zero `any`, only 12 non-null assertions across the codebase — the
  lowest of all six artifacts. Largest file 760 lines (verified) — no god file.
- Tests include a 3-simulated-minute headless AI-vs-economy smoke run and a DOM-stub
  harness driving the real GameSession through input bursts (`sim.test.ts`,
  `app.test.ts`).

### claude-opus-4-8 — 22/22

- WFC: bitmask domains, popcount-entropy with seeded noise tie-break, stack
  propagation (`wfc/wfc.ts:80-140`); explicit symmetric adjacency pair table
  (`wfc/tiles.ts:116-141`).
- Playability: the most engineered pass of all six — flood-fill largest land
  component (≥18% of map), diagonal-extreme start selection with minimum separation,
  L-corridor guarantee, per-start resource minimums with a fairness tolerance (±8
  forest tiles), all on deterministically forked RNG streams, emitting a generation
  report object (`wfc/mapgen.ts:39-321`).
- A*: min-heap, octile, corner-cut guard, 20k-expansion budget, `stopAdjacent` mode
  for harvesting/attacking blocked targets (`sim/astar.ts:104-194`); pairwise
  separation via spatial hash with axis-sliding fallback (`sim/movement.ts:67-118`).
- AI: economy (gold:wood ≈ 3:2), supply-ahead build order, army composition ratios
  (5:3:2), threat response, escalating waves; builder re-dispatch (the defect it found
  and fixed during its own run). The review agent reported "no rebuild logic", but the
  build order's `countBuildings(...) === 0` checks rebuild Barracks/LumberMill/Farm
  implicitly (`sim/ai.ts:138-162`); only a destroyed Town Hall is never replaced.
- Type discipline: zero `any`, 24 non-null assertions (11 of them heap internals).
  Largest file 580 lines across 5448 LOC (verified) — the most modular artifact.
- Both Claude cells, uniquely, ship render/session smoke tests (canvas + input
  dispatch under a DOM stub).

## Caveats — why this is not a benchmark row

1. **Conflict of interest:** the grader (claude-fable-5) and the evidence-gathering
   subagents are the same model family as the `claude-fable-5` cell. Automated items
   are command-driven and objective; the R-section judgments are quoted-source-based
   but still judgment. Discount accordingly, or re-grade with a non-Claude judge.
2. **Context asymmetry:** `claude -p` loaded the user's global `~/.claude/CLAUDE.md`
   (engineering discipline guidance the pi models did not receive). The harness also
   differs (Claude Code agent loop vs pi).
3. **Rubric saturation:** 22/22 for both means the rubric no longer discriminates at
   this level; manual play (M1–M10) and deeper criteria (perf under load, fog
   correctness at edges, AI competence) are where differences would show.

## Manual checklist

Same M1–M10 as `prompts/001-rts-wfc/checklist.md`, per cell:

```
cd runs/claude-manual-20260610/<cell>/workspace && npm run dev -- --host 0.0.0.0
```
