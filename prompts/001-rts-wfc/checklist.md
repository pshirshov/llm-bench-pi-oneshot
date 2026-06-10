# Checklist — 001-rts-wfc

Scoring: Automated pass=1/fail=0; Code review 0–2 (absent / superficial / genuine);
Manual pass=1/fail=0. Run automated commands from the cell's `workspace/` root.

## Automated (bench-validate)

- [ ] A1 install — `npm install` exits 0
- [ ] A2 no runtime deps — `package.json` `dependencies` empty or absent; no game
      engine/framework anywhere in the dependency tree
- [ ] A3 build — `npm run build` exits 0
- [ ] A4 strict typecheck — tsconfig has `"strict": true` and `npx tsc --noEmit` exits 0
- [ ] A5 lint — `npm run lint` exits 0
- [ ] A6 tests — `npm run test` exits 0 with >= 15 assertions, covering WFC
      propagation/determinism, A*, and combat/supply math (inspect test files, not
      just the count)
- [ ] A7 serves — `npm run preview` (or built `dist/` via any static server) responds
      200 on `/` and the HTML references the built bundle
- [ ] A8 seeded determinism — code routes randomness through one seeded PRNG;
      `?seed=` is parsed and displayed (verify by reading source, plus grep for stray
      `Math.random` outside the PRNG module)

## Code review (bench-validate, judged from source, 0–2 each)

- [ ] R1 WFC authenticity — minimal-entropy selection + constraint propagation over an
      explicit adjacency table; not noise, not random scatter with cosmetic naming
- [ ] R2 playability pass — start-location placement, land reachability check between
      starts, resource fairness; deterministic repair/retry
- [ ] R3 pathfinding — real A* (open set, admissible heuristic, no corner cutting)
      actually used by unit movement; some collision-avoidance mechanism
- [ ] R4 architecture — simulation / rendering / input separated; fixed-timestep loop;
      data-driven unit/building stats table
- [ ] R5 AI structure — recognizable strategy logic (build order, saturation, waves,
      defense, rebuild), not a random-action stub
- [ ] R6 type discipline — domain types for entities/orders/tiles; `any` and
      non-null assertions rare and justified
- [ ] R7 smells — god files (>~800 lines), copy-paste blocks, dead code, magic numbers
      where the spec demanded a stats table (2 = clean, 0 = pervasive)

## Manual (user)

- [ ] M1 loads & starts — level select appears, level 1 starts, seed visible, no
      console errors
- [ ] M2 economy loop — select Worker, harvest gold and wood, build Farm + Barracks,
      train units, supply cap enforced
- [ ] M3 control feel — box select, shift-add, control groups, right-click orders,
      minimap + edge scrolling all work
- [ ] M4 combat — attack-move engages, ranged projectiles visible, auto-acquire works,
      damage/armor plausible, corpses clear
- [ ] M5 pathfinding feel — a 12+ unit group ordered across the map arrives and
      settles; no permanent jams around chokepoints
- [ ] M6 fog of war — unexplored black, explored memory, enemies hidden until seen;
      minimap consistent
- [ ] M7 AI opponent — AI economy visibly develops; first attack wave arrives; AI
      defends and rebuilds; difficulty 1 is beatable
- [ ] M8 WFC maps — same seed reproduces the same map; different seeds differ;
      terrain looks locally coherent (no water speckle); both starts viable
- [ ] M9 campaign — winning advances; later levels are visibly larger/harder
- [ ] M10 performance — late-game battle (~100 units) stays smooth; speed toggle and
      pause work
