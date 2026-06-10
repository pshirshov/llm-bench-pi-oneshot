/** Fixed simulation timestep configuration and global gameplay limits. */

/** Simulation ticks per second (fixed-timestep). Rendering is decoupled. */
export const SIM_HZ = 30;
export const FIXED_DT = 1 / SIM_HZ;
/** Max simulation steps processed per rendered frame, to avoid spiral-of-death. */
export const MAX_STEPS_PER_FRAME = 5;

/** Hard supply ceiling regardless of farms/halls built. */
export const MAX_SUPPLY = 100;

/** Tiles in pixels at default zoom. */
export const TILE_SIZE = 24;
