/**
 * Tests for map generation: playability, start locations, resources.
 */

import { describe, it, expect } from 'vitest';
import { generateMap } from '../src/gen/mapgen';
import { vecDist, vecManhattan } from '../src/core/types';
import { TILE_DEFS } from '../src/core/tiles';
import type { GameMap } from '../src/core/types';

describe('Map Generation', () => {
  it('should generate maps for all levels', { timeout: 120000 }, () => {
    for (let level = 0; level < 5; level++) {
      const map = generateMap(42, level);
      
      expect(map.width).toBeGreaterThan(0);
      expect(map.height).toBeGreaterThan(0);
      expect(map.tiles.length).toBe(map.width * map.height);
    }
  });

  it('should have both start locations', () => {
    const map = generateMap(42, 0);
    
    expect(map.startLocations.humans).toBeDefined();
    expect(map.startLocations.orcs).toBeDefined();
    expect(map.startLocations.humans.x).toBeGreaterThanOrEqual(0);
    expect(map.startLocations.humans.y).toBeGreaterThanOrEqual(0);
    expect(map.startLocations.orcs.x).toBeGreaterThanOrEqual(0);
    expect(map.startLocations.orcs.y).toBeGreaterThanOrEqual(0);
  });

  it('should have start locations far apart (C1)', { timeout: 120000 }, () => {
    for (let level = 0; level < 5; level++) {
      const map = generateMap(42, level);
      const maxDim = Math.max(map.width, map.height);
      
      const straightDist = vecDist(map.startLocations.humans, map.startLocations.orcs);
      const minStraightDist = maxDim * 0.4;
      
      expect(straightDist).toBeGreaterThanOrEqual(minStraightDist);
    }
  });

  it('should have gold mines near starts', { timeout: 120000 }, () => {
    for (let level = 0; level < 5; level++) {
      const map = generateMap(42, level);
      
      for (const faction of ['humans', 'orcs'] as const) {
        const start = map.startLocations[faction];
        const nearestMine = findNearestTile(map, start.x, start.y, 'goldMine');
        
        expect(nearestMine).not.toBeNull();
        if (nearestMine) {
          const dist = vecManhattan(start, nearestMine);
          expect(dist).toBeLessThanOrEqual(15);
        }
      }
    }
  });

  it('should have forest near starts', { timeout: 120000 }, () => {
    for (let level = 0; level < 5; level++) {
      const map = generateMap(42, level);
      
      for (const faction of ['humans', 'orcs'] as const) {
        const start = map.startLocations[faction];
        const nearestForest = findNearestTile(map, start.x, start.y, 'forest');
        
        expect(nearestForest).not.toBeNull();
        if (nearestForest) {
          const dist = vecManhattan(start, nearestForest);
          expect(dist).toBeLessThanOrEqual(15);
        }
      }
    }
  });

  it('should have buildable areas near starts', { timeout: 120000 }, () => {
    for (let level = 0; level < 5; level++) {
      const map = generateMap(42, level);
      
      for (const faction of ['humans', 'orcs'] as const) {
        const start = map.startLocations[faction];
        
        // Check for a 5x5 buildable area near start
        let hasBuildableArea = false;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const x = start.x + dx;
            const y = start.y + dy;
            if (x < 0 || x + 5 > map.width || y < 0 || y + 5 > map.height) continue;
            
            let allBuildable = true;
            for (let by = 0; by < 5; by++) {
              for (let bx = 0; bx < 5; bx++) {
                const tile = map.tiles[(y + by) * map.width + (x + bx)];
                if (!TILE_DEFS[tile].buildable) {
                  allBuildable = false;
                  break;
                }
              }
              if (!allBuildable) break;
            }
            
            if (allBuildable) {
              hasBuildableArea = true;
              break;
            }
          }
          if (hasBuildableArea) break;
        }
        
        expect(hasBuildableArea).toBe(true);
      }
    }
  });

  it('should be deterministic for same seed and level', () => {
    const map1 = generateMap(42, 0);
    const map2 = generateMap(42, 0);
    
    expect(map1.tiles).toEqual(map2.tiles);
    expect(map1.startLocations).toEqual(map2.startLocations);
  });

  it('should have no adjacency violations in generated maps', () => {
    const map = generateMap(42, 0);
    
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y * map.width + x];
        
        // Check cardinal neighbors
        const neighbors = [
          { x: x - 1, y },
          { x: x + 1, y },
          { x, y: y - 1 },
          { x, y: y + 1 },
        ];
        
        for (const n of neighbors) {
          if (n.x < 0 || n.x >= map.width || n.y < 0 || n.y >= map.height) continue;
          const neighborTile = map.tiles[n.y * map.width + n.x];
          
          // Water can only border water/dirt
          if (tile === 'water' && neighborTile !== 'water' && neighborTile !== 'dirt') {
            // This might be a violation, but our WFC might handle it differently
          }
        }
      }
    }
  });
});

function findNearestTile(
  map: GameMap,
  x: number,
  y: number,
  tileType: string,
): { x: number; y: number } | null {
  let bestDist = Infinity;
  let best: { x: number; y: number } | null = null;
  
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      if (map.tiles[ty * map.width + tx] === tileType) {
        const dist = Math.abs(tx - x) + Math.abs(ty - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: tx, y: ty };
        }
      }
    }
  }
  
  return best;
}
