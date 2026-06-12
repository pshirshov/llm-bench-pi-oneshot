# Validation — run `20260612-171652` (prompt `002-rts-wfc`)

Validated 2026-06-12. Automated checks executed through the bench devShell
(`nix develop . -c …`, node v24.16.0 / npm 11.13.0); code review judged from
source. Workspaces treated as read-only; nothing was patched. `npm run verify`
(A3) is **derived** from its four components run individually (`verify =
typecheck && lint && test && build`) to avoid a second full suite+build run; the
derivation is noted per cell.

## Cells

| Model | Effort | Run status | Duration |
|---|---|---|---|
| openai-codex/gpt-5.5 | xhigh | ok | 3640s (~61m) |
| xiaomi/mimo-v2.5-pro | high | ok | 3004s (~50m) |
| ollama-cloud/glm-5.1 | xhigh | ok | 2674s (~45m) |
| grok-build/grok-build | xhigh | ok | 3177s (~53m) |
| ollama-cloud/minimax-m3 | xhigh | **error (exit 1)** | 3199s (~53m) |

`minimax-m3` was cut off by the provider mid-work (HTTP 429 session usage limit
on ollama.com); its workspace is a **partial artifact** — no tests, two
unresolved type errors, no build output. It is scored on what exists.

## Comparison table

Automated: pass=1 / fail=0. Review: 0–2. Columns ordered by combined total.

| Item | mimo | gpt-5.5 | glm-5.1 | grok | minimax |
|---|:--:|:--:|:--:|:--:|:--:|
| **A1** install (`npm install` exit 0) | 1 | 1 | 1 | **0** | 1 |
| **A2** no runtime deps | 1 | 1 | 1 | 1 | 1 |
| **A3** verify chains & exits 0 *(derived)* | 1 | 1 | 1 | **0** | **0** |
| **A4** strict + `tsc --noEmit` exit 0 | 1 | 1 | 1 | 1 | **0** |
| **A5** lint gate (`--max-warnings 0`, rules) | 1 | 1 | 1 | **0** | **0** |
| **A6** no suppressions | 1 | 1 | 1 | 1 | 1 |
| **A7** test suite (≥40 cases, ≥100 asserts, scenarios) | 1 | 1 | **0†** | **0** | **0** |
| **A8** serves 200 + bundle ref | 1 | 1 | 1 | 1 | **0** |
| **A9** seeded determinism (one PRNG, `?seed=`) | 1 | 1 | 1 | 1 | 1 |
| **Automated /9** | **9** | **9** | **8** | **5** | **4** |
| **R1** WFC authenticity | 2 | 1 | 2 | 2 | 2 |
| **R2** playability pass | 2 | 2 | 2 | 2 | 2 |
| **R3** pathfinding | 2 | 2 | 2 | 1 | 2 |
| **R4** architecture | 2 | 2 | 2 | 2 | 2 |
| **R5** AI structure | 2 | 1 | 2 | **0** | 2 |
| **R6** corner cases | 2 | 2 | 2 | 1 | 2 |
| **R7** test authenticity | 2 | 2 | 2 | 1 | **0** |
| **R8** smells | 2 | 1 | 1 | 1 | 2 |
| **Review /16** | **16** | **13** | **15** | **10** | **14** |
| **TOTAL /25** | **25** | **22** | **23** | **15** | **18** |

† glm-5.1 A7: the suite **passes** (71 vitest cases, 5 files) with genuine
behavioral coverage, but only **89 `expect()` call sites** — 11 short of the
≥100-assertion bar. It fails A7 on that single sub-threshold alone.

Note on TOTAL: combined score is the validator's automated+review tally. It does
**not** model the Manual section (user's). `minimax-m3`'s 18 is inflated by
source-quality review of code that **does not compile and has zero tests** — in
practice it is the least complete artifact; see its cell notes.

---

## Per-cell detail

### xiaomi/mimo-v2.5-pro @high — Automated 9/9, Review 16/16 — **25/25**

All automated checks pass. 19 test files, **140 vitest cases / 238 expect()
sites**, full scenario spread (determinism, wfc, mapgen, pathfinding, ai, combat,
economy, fog, campaign, boot, invariant, soak, layout, input, spatial, prng,
stats). Lint config carries all four gate rules (`eslint.config.js:10-18`).
Largest file `render/renderer.ts` 442 lines (under the 500 cap).

Review: R1 genuine min-entropy + explicit adjacency (`src/gen/wfc.ts:105-164`,
`src/core/tiles.ts:56-64`). R3 real A* with Chebyshev heuristic, no corner-cut,
watchdog `PROGRESS_WATCHDOG_TICKS=600` (`core/pathfinding.ts`, `sim/game.ts:148-161`).
R5 manageWorkers/processBuildOrder/trainMilitary/processAttackWaves/rebuild
(`src/ai/ai.ts`). R6 harvest-retarget/drop-off-loss/mine-exhaustion in
`sim/economy.ts`. R7 public-API behavioral tests + real DOM events
(`tests/input.test.ts`). R8 modular, all tunables in `core/types.ts`/`core/stats.ts`.
No failed items.

### openai-codex/gpt-5.5 @xhigh — Automated 9/9, Review 13/16 — **22/25**

All automated checks pass. 7 test files, **44 vitest cases / 139 expect() sites**;
`ai-win-soak`, `movement-robustness`, `ui-input` cover AI-vs-AI outcome,
no-shove, and jsdom input wiring. A3 verify derived-pass (all four components
exit 0). dist serves HTTP 200 with `assets/index-DZ6d7Zcl.js`.

Review: R1=1 — min-entropy + adjacency present (`sim/map/wfc.ts:73-87`) but leans
on a 2-attempt retry then **falls back to an all-grass map** rather than a
deterministic repair loop. R5=1 — recognizable AI (assignWorkers, build order,
waves, defendBase) but `launchWaves` uses constant cadence and `ensureResources`
injects resources rather than planning economy (`sim/systems/ai.ts:118-171`).
R8=1 — `sim/world.ts` 491 lines; tactical magic numbers outside stats
(threat radius 18, build offsets) in `sim/systems/ai.ts`. No failed automated items.

### ollama-cloud/glm-5.1 @xhigh — Automated 8/9, Review 15/16 — **23/25**

Fails **A7 only**, on the assertion-count threshold: suite passes (71 cases,
5 files) but 89 expect() sites < 100. All other automated checks pass; gate
rules present (`eslint.config.js:10-21`). dist serves HTTP 200.

Review: R1 explicit adjacency + min-entropy + weighted collapse
(`sim/wfc.ts:21-91`, `sim/tile.ts:34-43`). R3 A* with octile-style heuristic,
bounded `MAX_REPATH_ATTEMPTS`, watchdog `PROGRESS_WATCHDOG_TICKS`
(`sim/pathfinding.ts`, `sim/orders.ts:41-59`). R5 build order + saturation +
difficulty-scaled waves + defense (`sim/ai.ts:81-163`). R6 retarget/drop-off/
surrounded-spawn BFS/unreachable-settle in sim (`sim/orders.ts`, `sim/production.ts:47-78`).
R7 2000-tick invariant fuzz on real World API. R8=1 — `sim/orders.ts` deep
harvest state machine with some tactical magic numbers (1.8, 20).

**A7 failing detail:** `npm run test` exits 0 — the miss is purely
`grep -c 'expect('` = 89 vs the ≥100 bar.

### grok-build/grok-build @xhigh — Automated 5/9, Review 10/16 — **15/25**

Four automated failures:

- **A1 install — FAIL.** Clean `npm install` aborts with ERESOLVE:
  `@eslint/js@10.0.1` demands `eslint@^10` but the project pins `eslint@^9.39.4`
  (peer conflict). The model's vendored `node_modules` masks it; a fresh resolve
  is broken without `--legacy-peer-deps`.
- **A5 lint — FAIL.** `eslint . --max-warnings 0` → **50 errors**: `max-lines`
  (`src/sim.ts` 835 counted lines > 500), multiple `no-explicit-any`,
  `no-non-null-assertion`, and ~25 unused-var errors across `sim.ts`/`main.ts`/
  `mapgen.ts`. Gate rules are configured correctly; the source violates them.
- **A7 test — FAIL.** `vitest run` → **3 of 9 fail** (only 9 cases, 1 file):
  `harvest delivers` (`expected 200 to be greater than 205` — economy gathers
  nothing), and `train and defeat` (`enqueueTrain` returns false). The model's
  own tests catch broken economy/production. Also far below the 40-case bar.
- **A3 verify — FAIL** (derived: lint + test fail).

A4 (strict, tsc exit 0, build includes `tsc --noEmit`) and A8 (dist serves 200)
do pass. Review: R5=0 — **no AI**: `AI_FIRST_WAVE_TICKS`/`AI_WAVE_INTERVAL_BASE`
are declared (`constants.ts:44-45`) but never referenced; the only "ai" code
places a starting base (`sim.ts:62-67`). No build order, training, waves, or
defense. R3=1 collision handled in sim not pathfinder, no progress watchdog.
R8=1 monolithic `sim.ts` (1010 raw lines) with scattered magic numbers and dead
locals. R7=1 thin suite using backdoor test helpers (`setStockpileForTest`).

### ollama-cloud/minimax-m3 @xhigh — Automated 4/9, Review 14/16 — **18/25** (PARTIAL)

Provider cut the run off (429 quota) ~53m in. Artifact is incomplete:

- **A7 — FAIL.** `tests/` is **empty**; `vitest run` → "No test files found,
  exiting with code 1". 0 cases / 0 assertions.
- **A4 / build — FAIL.** `tsc --noEmit` exits 2 with two type errors in
  `src/browser.ts`: `GameOptions.playerFaction` missing (L36) and a possibly-null
  `CanvasRenderingContext2D` passed where non-null required (L52).
- **A5 lint — FAIL.** 1 error: forbidden non-null assertion (`src/sim/wfc.ts:184`).
- **A8 serves — FAIL.** Build failed → no `dist/`.
- **A3 verify — FAIL** (derived).

A1/A2/A6/A9 pass. Review scores are high (R1/R3/R4/R5/R6=2, R8=2) because the
**sim source that exists is well-structured** — genuine AC-3-style WFC
(`sim/wfc.ts:32-56,295`), A* with octile heuristic + watchdog, multi-phase AI
(`sim/ai.ts`), corner cases in `sim/unitStep.ts`/`buildingStep.ts`, all tunables
table-driven. **R7=0** (no tests). Caveat: none of the review-credited behavior
is verified — the code does not typecheck or build. Had the run finished, this
might have been competitive; as delivered it is the least complete cell.

---

## Manual section (user — not checked by this pass)

Launch a cell:
`cd runs/20260612-171652/002-rts-wfc/<cell>/workspace && npm run dev`
(cells: `openai-codex_gpt-5_5_xhigh`, `xiaomi-token-plan-ams_mimo-v2_5-pro_high`,
`ollama-cloud_glm-5_1_xhigh`, `grok-build_grok-build_xhigh`,
`ollama-cloud_minimax-m3_xhigh`). Note: `grok` needs
`npm install --legacy-peer-deps` first; `minimax-m3` has unresolved type errors
(vite dev transpiles without typecheck, so it may still load).

Repeat M1–M10 per cell:

- [ ] M1 loads & starts — level select, level 1 starts, seed visible, no console errors
- [ ] M2 economy loop — gold+wood harvest auto-repeats over trips, depleted tree retargets, build Farm+Barracks, train units, supply cap enforced, worker repairs damaged building
- [ ] M3 control feel — box select, shift-add, control groups, right-click orders, minimap + edge scrolling; HUD buttons clickable
- [ ] M4 combat — attack-move engages, ranged projectiles visible, auto-acquire, plausible damage/armor, corpses clear; unit classes feel right
- [ ] M5 pathfinding feel — 12+ group through chokepoint arrives & settles (no jams/oscillation); no clipping through water/rock/buildings/units; no shoving idle units
- [ ] M6 fog of war — unexplored black, explored memory, enemies hidden until seen; minimap consistent
- [ ] M7 AI opponent — economy develops, first wave ~4 min, defends & rebuilds, difficulty 1 beatable ~15 min
- [ ] M8 WFC maps — same seed → same map, different seeds differ, locally coherent, both starts viable & far apart
- [ ] M9 campaign — winning advances; later levels visibly larger/harder
- [ ] M10 performance — ~100-unit late battle smooth; speed toggle & pause work

(grok M7 will fail — no AI implemented. minimax M2/M4/M7/M9 unverifiable —
incomplete artifact.)

---

## Ranked summary

By validator score (automated + review, /25): **mimo-v2.5-pro 25**,
**glm-5.1 23**, **gpt-5.5 22**, then **minimax-m3 18** (partial) and
**grok 15**.

`mimo-v2.5-pro` is the clear top: every gate green, 140 behavioral tests, and a
modular table-driven architecture with all 23 scenario families present.
`glm-5.1` and `gpt-5.5` are effectively tied one tier down and differ on
trade-offs: glm has stronger AI/WFC review marks but its test suite lands 11
assertions short of the A7 bar (the suite itself passes); gpt clears every
automated gate but its WFC falls back to an all-grass map and its AI uses
constant-cadence waves. Treat glm≈gpt as a near-tie, not a ranked gap.

`grok` is genuinely incomplete: it ships **no AI opponent**, its own test suite
fails 3/9 on broken economy and production, a clean install does not resolve, and
lint reports 50 violations including a 1010-line god file. `minimax-m3`'s raw 18
overstates it — the run was truncated by a provider quota, leaving code that does
not typecheck, does not build, and has zero tests; the high review marks reflect
unverified source only and should not be read as a working game.
