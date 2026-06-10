import { deriveSeed } from "../core/rng.js";

export interface LevelDef {
  /** 0-based index. */
  index: number;
  name: string;
  /** Square map side in tiles. */
  size: number;
  /** AI difficulty 1..5. */
  difficulty: number;
  blurb: string;
}

/** Five campaign levels of growing size, constraint and AI difficulty. */
export const LEVELS: readonly LevelDef[] = [
  { index: 0, name: "Greenfields", size: 32, difficulty: 1, blurb: "Open meadows. Learn the basics." },
  { index: 1, name: "Riverbend", size: 48, difficulty: 2, blurb: "Water carves the land into lanes." },
  { index: 2, name: "Stonewatch", size: 64, difficulty: 3, blurb: "Mountains form natural chokepoints." },
  { index: 3, name: "The Narrows", size: 80, difficulty: 4, blurb: "Scarce resources, tight passes." },
  { index: 4, name: "Ironhold", size: 96, difficulty: 5, blurb: "A vast, hostile frontier." },
];

/** Deterministic map seed for a level within a campaign. */
export function levelSeed(campaignSeed: number, levelIndex: number): number {
  return deriveSeed(campaignSeed, levelIndex);
}

const PROGRESS_KEY = "warband.progress.v1";

/** Highest unlocked level index (0-based). Level 0 is always unlocked. */
export function loadHighestUnlocked(): number {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(LEVELS.length - 1, n)) : 0;
  } catch {
    return 0;
  }
}

export function saveHighestUnlocked(index: number): void {
  try {
    localStorage.setItem(PROGRESS_KEY, String(Math.max(0, Math.min(LEVELS.length - 1, index))));
  } catch {
    // Ignore storage failures (e.g. privacy mode); progression simply won't persist.
  }
}

/** Record a level completion, unlocking the next. Returns the next level index, or null if the campaign is finished. */
export function completeLevel(index: number): number | null {
  const next = index + 1;
  if (next < LEVELS.length) {
    if (next > loadHighestUnlocked()) saveHighestUnlocked(next);
    return next;
  }
  return null;
}
