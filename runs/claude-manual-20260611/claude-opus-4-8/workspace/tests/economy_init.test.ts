/**
 * Regression guard for a circular-import initialization-order defect.
 *
 * `simulation.ts` imports phase implementations (`economy.ts`, `ai.ts`) at the
 * top of its module body — BEFORE its own `export const SIM_HZ = 30` line runs.
 * Those phase modules in turn import `SIM_HZ` and (historically) captured it into
 * a top-level `const` at module-init time. Because the ESM live binding for
 * `SIM_HZ` was still in its temporal-dead-zone / undefined when the phase module
 * initialized, the captured constant became `NaN`
 * (`Math.round(undefined * 1.5) === NaN`). The downstream effect was catastrophic
 * but silent: a harvesting worker's `gatherTicks >= GATHER_TICKS` comparison is
 * `n >= NaN`, always false, so NO worker ever completes a gather and the entire
 * economy produces zero gold/wood.
 *
 * The fix moves the timing constants (`SIM_HZ`, `SECONDS_PER_TICK`) into a leaf
 * module (`tick.ts`) with no back-edge into the sim graph, so every consumer sees
 * a fully-initialized value regardless of import order.
 *
 * This test reproduces the OBSERVABLE failure end-to-end (a worker harvesting a
 * forest tile must deposit wood within a generous tick budget), which fails when
 * `GATHER_TICKS` is NaN and passes once the cycle is broken.
 */

import { describe, it, expect } from "vitest";
import { createWorld } from "../src/sim/world.js";
import { stepWorld } from "../src/sim/simulation.js";
import { harvest } from "../src/sim/orders.js";

describe("economy init-order regression (GATHER_TICKS must not be NaN)", () => {
  it("an isolated worker harvesting a forest deposits wood within 200 ticks", () => {
    // A 48x48 seed whose human start sits at a corner with adjacent forest — the
    // exact configuration that exposed the NaN GATHER_TICKS (workers gathered
    // forever, never depositing). createWorld drives the sim graph whose import
    // order triggered the defect.
    const world = createWorld(0xabcde, 0, "human", 1, 48, 48);

    // Keep exactly one worker so there is no inter-worker crowding — the deposit
    // failure here can ONLY come from the gather-completion comparison, not from
    // the separation pass shoving workers off the resource tile.
    const workers = [...world.units.values()].filter(
      (u) => u.owner === "human" && u.kind === "worker",
    );
    expect(workers.length).toBeGreaterThan(0);
    const worker = workers[0];
    for (let i = 1; i < workers.length; i++) world.units.delete(workers[i].id);

    worker.order = harvest(worker.id);
    const goldBefore = world.players.human.gold;
    const woodBefore = world.players.human.wood;

    for (let t = 0; t < 200; t++) stepWorld(world);

    // The worker must have completed at least one harvest cycle and deposited.
    const gained =
      world.players.human.gold - goldBefore + (world.players.human.wood - woodBefore);
    expect(
      gained,
      "harvesting worker deposited nothing in 200 ticks — GATHER_TICKS is likely NaN (circular-import init-order defect)",
    ).toBeGreaterThan(0);
  });
});
