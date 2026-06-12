/**
 * Campaign system: 5 levels of progressively increasing complexity.
 */

import type { GameConfig, Faction } from '../core/types';
import { CAMPAIGN_LEVELS } from '../core/types';

export interface CampaignLevel {
  readonly level: number;
  readonly name: string;
  readonly description: string;
  readonly difficulty: number;
  readonly unlocked: boolean;
}

/** Default campaign levels */
export const CAMPAIGN_DATA: CampaignLevel[] = [
  {
    level: 0,
    name: 'The Gathering',
    description: 'Learn to harvest resources and train workers.',
    difficulty: 1,
    unlocked: true,
  },
  {
    level: 1,
    name: 'First Blood',
    description: 'Build barracks and train your first army.',
    difficulty: 2,
    unlocked: false,
  },
  {
    level: 2,
    name: 'Siege',
    description: 'Expand your base and defend against waves.',
    difficulty: 3,
    unlocked: false,
  },
  {
    level: 3,
    name: 'Crossroads',
    description: 'Control chokepoints and manage two fronts.',
    difficulty: 4,
    unlocked: false,
  },
  {
    level: 4,
    name: 'Final Battle',
    description: 'Destroy the enemy stronghold.',
    difficulty: 5,
    unlocked: false,
  },
];

/** Create a game config for a campaign level */
export function createLevelConfig(
  seed: number,
  level: number,
  playerFaction: Faction,
): GameConfig {
  const campaignLevel = CAMPAIGN_DATA[level] ?? CAMPAIGN_DATA[0];
  return {
    seed,
    level,
    playerFaction,
    difficulty: campaignLevel.difficulty,
  };
}

/** Get the next level after completing the current one */
export function getNextLevel(currentLevel: number): number {
  return Math.min(currentLevel + 1, CAMPAIGN_LEVELS - 1);
}

/** Check if a level is unlocked based on completed levels */
export function isLevelUnlocked(level: number, completedLevels: number[]): boolean {
  if (level === 0) return true;
  return completedLevels.includes(level - 1);
}

/** Get level-specific seed */
export function getLevelSeed(baseSeed: number, level: number): number {
  return (baseSeed * 31 + level * 17) >>> 0;
}
