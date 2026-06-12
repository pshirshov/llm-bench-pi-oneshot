/**
 * Tests for Wave Function Collapse map generation.
 */

import { describe, it, expect } from 'vitest';
import { runWFC } from '../src/gen/wfc';
import { createPRNG } from '../src/core/prng';
import { tilesAdjacentAllowed, TILE_DEFS } from '../src/core/tiles';

describe('WFC', () => {
  it('should generate a map with correct dimensions', () => {
    const rng = createPRNG(42);
    const width = 32;
    const height = 32;
    
    const tiles = runWFC(width, height, rng);
    
    expect(tiles.length).toBe(width * height);
  });

  it('should be deterministic for a fixed seed', () => {
    const rng1 = createPRNG(42);
    const rng2 = createPRNG(42);
    
    const tiles1 = runWFC(16, 16, rng1);
    const tiles2 = runWFC(16, 16, rng2);
    
    expect(tiles1).toEqual(tiles2);
  });

  it('should produce different maps for different seeds', () => {
    const rng1 = createPRNG(42);
    const rng2 = createPRNG(43);
    
    const tiles1 = runWFC(16, 16, rng1);
    const tiles2 = runWFC(16, 16, rng2);
    
    expect(tiles1).not.toEqual(tiles2);
  });

  it('should have no adjacent tile pairs violating adjacency rules', () => {
    const rng = createPRNG(42);
    const width = 32;
    const height = 32;
    
    const tiles = runWFC(width, height, rng);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[y * width + x];
        
        // Check all 4 cardinal neighbors
        const neighbors = [
          { x: x - 1, y },
          { x: x + 1, y },
          { x, y: y - 1 },
          { x, y: y + 1 },
        ];
        
        for (const n of neighbors) {
          if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
          const neighborTile = tiles[n.y * width + n.x];
          expect(tilesAdjacentAllowed(tile, neighborTile)).toBe(true);
        }
      }
    }
  });

  it('should generate valid tile types', () => {
    const rng = createPRNG(42);
    const tiles = runWFC(16, 16, rng);
    
    for (const tile of tiles) {
      expect(TILE_DEFS[tile]).toBeDefined();
    }
  });

  it('should handle different map sizes', () => {
    const sizes = [16, 32, 48, 64];
    
    for (const size of sizes) {
      const rng = createPRNG(42);
      const tiles = runWFC(size, size, rng);
      expect(tiles.length).toBe(size * size);
    }
  });
});
