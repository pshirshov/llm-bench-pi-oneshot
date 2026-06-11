/**
 * Fixed-timestep timing constants — a LEAF module with no imports.
 *
 * These live here (not in `simulation.ts`) to break a circular-import
 * initialization-order hazard: `simulation.ts` imports the phase modules
 * (`economy.ts`, `ai.ts`, `movement.ts`) at the top of its body, and those
 * modules need `SIM_HZ` at their own module-init time to derive tick-count
 * constants. If they imported `SIM_HZ` from `simulation.ts`, its `export const`
 * would still be in the temporal dead zone (value `undefined`) while the phase
 * module initialized — so e.g. `Math.round(SIM_HZ * 1.5)` would capture `NaN`,
 * silently breaking the harvest gather-completion comparison.
 *
 * Because this module imports nothing from the sim graph, every consumer sees a
 * fully-initialized value regardless of who loads whom first. `simulation.ts`
 * re-exports these names so existing `from "./simulation.js"` import sites keep
 * working unchanged.
 */

/** Fixed simulation rate in ticks per second (decoupled from render FPS). */
export const SIM_HZ = 30;

/** Seconds of simulated time per tick. */
export const SECONDS_PER_TICK = 1 / SIM_HZ;
