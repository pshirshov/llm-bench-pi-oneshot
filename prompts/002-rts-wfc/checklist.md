# Checklist — 002-rts-wfc

Scoring: Automated pass=1/fail=0; Code review 0–2 (absent / superficial / genuine);
Manual pass=1/fail=0. Run automated commands from the cell's `workspace/` root.

## Automated (bench-validate)

- [ ] A1 install — `npm install` exits 0
- [ ] A2 no runtime deps — `package.json` `dependencies` empty or absent; no game
      engine/framework anywhere in the dependency tree
- [ ] A3 verify — `verify` script exists, chains typecheck/lint/test/build, and
      `npm run verify` exits 0
- [ ] A4 build typechecks — tsconfig has `"strict": true`; `npx tsc --noEmit` exits 0;
      the `build` script includes `tsc --noEmit` (bare `vite build` fails this item)
- [ ] A5 lint gates — `lint` runs eslint with `--max-warnings 0` and exits 0; config
      enforces as errors: no-explicit-any, no-non-null-assertion, Math.random ban
      outside the PRNG module, max-lines 500
- [ ] A6 no suppressions — zero `@ts-ignore` / `@ts-expect-error` / inline
      `eslint-disable` in src and tests (PRNG exemption must live in eslint config)
- [ ] A7 test suite — `npm run test` exits 0; >= 40 test cases (vitest reported
      count) and >= 100 assertions (static count of expect()/assert call sites);
      all 23 mandated scenarios identifiable (determinism, WFC, playability/C1
      separation, A*, gold loop, wood depletion retarget, drop-off loss, mine
      exhaustion, group chokepoint settle, no pass-through/no shove, unreachable
      order, combat math, stats sanity, production/supply/surrounded spawn +
      repair, placement honesty, AI progression + rebuild, win/lose, invariant
      fuzz, boot smoke ×5 levels, input wiring via jsdom events, UI layout rects,
      AI-vs-AI soak to outcome, performance canary); behavioral tests drive the
      real sim through public APIs (inspect, don't just count)
- [ ] A8 serves — `npm run preview` (or built `dist/` via any static server) responds
      200 on `/` and the HTML references the built bundle
- [ ] A9 seeded determinism — all randomness through one seeded PRNG; `Math.random`
      only in the PRNG module as seed fallback; `?seed=` parsed and displayed

## Code review (bench-validate, judged from source, 0–2 each)

- [ ] R1 WFC authenticity — minimal-entropy selection + constraint propagation over an
      explicit adjacency table; not noise, not random scatter with cosmetic naming
- [ ] R2 playability pass — start-location placement with C1 separation thresholds,
      land reachability between starts, resource reach + fairness; deterministic
      repair/retry
- [ ] R3 pathfinding — real A* (open set, admissible heuristic, no corner cutting)
      actually used by unit movement; collision discipline per I4 (waiting/rerouting,
      not soft-separation pushing that displaces other units); bounded repath (no
      infinite retry); progress-watchdog or equivalent liveness mechanism
- [ ] R4 architecture — sim core has zero DOM/canvas imports and runs headless;
      rendering/input thin layers; fixed-timestep loop with named tick-rate constant;
      data-driven stats table; UI layout as pure rect data + hit-test, and the
      renderer draws HUD elements from those same rects (single source of truth)
- [ ] R5 AI structure — recognizable strategy logic (build order, saturation, waves,
      defense, rebuild of destroyed buildings), not a random-action stub
- [ ] R6 corner-case handling — C1–C7 implemented in sim logic (harvest retarget /
      drop-off loss / mine exhaustion fallbacks, surrounded-spawn search, unreachable
      settle), not merely asserted in tests against lucky maps
- [ ] R7 test authenticity — behavioral tests use public order APIs on the real sim;
      input tests dispatch real DOM events; no sim mocks, no internal pokes to force
      asserted outcomes (setup affordances for arrangement are fine), no
      trivially-true assertions
- [ ] R8 smells — god files, copy-paste blocks, dead code, magic numbers outside the
      stats table (2 = clean, 0 = pervasive)

## Manual (user)

- [ ] M1 loads & starts — level select appears, level 1 starts, seed visible, no
      console errors
- [ ] M2 economy loop — harvest gold and wood unattended over multiple trips (loop
      auto-repeats), depleted tree retargets, build Farm + Barracks, train units,
      supply cap enforced, worker repairs a damaged building
- [ ] M3 control feel — box select, shift-add, control groups, right-click orders,
      minimap + edge scrolling; HUD buttons clickable where they appear
- [ ] M4 combat — attack-move engages, ranged projectiles visible, auto-acquire works,
      damage/armor plausible, corpses clear; unit classes feel right (heavy tanky and
      expensive, ranged fragile with standoff range, fights are decisive but not
      one-shot)
- [ ] M5 pathfinding feel — a 12+ unit group ordered across the map and through a
      chokepoint arrives and settles (no permanent jams, no oscillation/churn after
      arrival); units never clip through water/rock/buildings, never walk through
      each other, and never push idle units out of their spots
- [ ] M6 fog of war — unexplored black, explored memory, enemies hidden until seen;
      minimap consistent
- [ ] M7 AI opponent — AI economy visibly develops; first wave within ~4 min; AI
      defends and rebuilds destroyed buildings; difficulty 1 beatable in ~15 min
- [ ] M8 WFC maps — same seed reproduces the same map; different seeds differ;
      terrain locally coherent; both starts viable and clearly far apart
- [ ] M9 campaign — winning advances; later levels are visibly larger/harder
- [ ] M10 performance — late-game battle (~100 units) stays smooth; speed toggle and
      pause work
