/** Campaign level definitions. */

import { LEVEL_SIZES, LEVEL_DIFFICULTY } from "./constants";

export interface CampaignLevel {
  levelNumber: number;
  width: number;
  height: number;
  difficulty: number;
  name: string;
  unlocked: boolean;
}

export const CAMPAIGN_LEVELS: CampaignLevel[] = [
  { levelNumber: 1, width: 32, height: 32, difficulty: 1, name: "Plains of War", unlocked: true },
  { levelNumber: 2, width: 40, height: 40, difficulty: 2, name: "Forest March", unlocked: false },
  { levelNumber: 3, width: 48, height: 48, difficulty: 3, name: "River Crossing", unlocked: false },
  { levelNumber: 4, width: 56, height: 56, difficulty: 4, name: "Mountain Pass", unlocked: false },
  { levelNumber: 5, width: 64, height: 64, difficulty: 5, name: "Final Siege", unlocked: false },
];

export function getLevelConfig(level: number): { width: number; height: number; difficulty: number } {
  const idx = Math.min(level - 1, LEVEL_SIZES.length - 1);
  return {
    width: LEVEL_SIZES[idx][0],
    height: LEVEL_SIZES[idx][1],
    difficulty: LEVEL_DIFFICULTY[idx],
  };
}

/** Derive a deterministic seed for a specific campaign level. */
export function levelSeed(campaignSeed: number, levelNumber: number): number {
  return campaignSeed * 10000 + levelNumber * 137;
}