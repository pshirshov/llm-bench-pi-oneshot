/**
 * Tests for the seeded PRNG module.
 */

import { describe, it, expect } from 'vitest';
import { createPRNG } from '../src/core/prng';

describe('PRNG', () => {
  it('should produce deterministic sequences for the same seed', () => {
    const rng1 = createPRNG(42);
    const rng2 = createPRNG(42);
    
    const seq1 = Array.from({ length: 100 }, () => rng1.next());
    const seq2 = Array.from({ length: 100 }, () => rng2.next());
    
    expect(seq1).toEqual(seq2);
  });

  it('should produce different sequences for different seeds', () => {
    const rng1 = createPRNG(42);
    const rng2 = createPRNG(43);
    
    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());
    
    expect(seq1).not.toEqual(seq2);
  });

  it('should produce values in [0, 1)', () => {
    const rng = createPRNG(123);
    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('nextInt should produce integers in range', () => {
    const rng = createPRNG(456);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(5, 15);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(15);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('nextFloat should produce floats in range', () => {
    const rng = createPRNG(789);
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat(2.5, 7.5);
      expect(val).toBeGreaterThanOrEqual(2.5);
      expect(val).toBeLessThan(7.5);
    }
  });
});
