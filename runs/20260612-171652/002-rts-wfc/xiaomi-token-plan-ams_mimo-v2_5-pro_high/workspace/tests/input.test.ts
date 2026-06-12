/**
 * Tests for input handling: selection, orders, control groups.
 */

import { describe, it, expect } from 'vitest';
import { initGame, spawnTestUnit } from '../src/sim/game';
import { createInputState, handleMouseDown, handleMouseUp, handleKeyDown } from '../src/ui/input';
import { computeLayout } from '../src/ui/layout';
import type { GameConfig } from '../src/core/types';

describe('Input Handling', () => {
  const defaultConfig: GameConfig = {
    seed: 42,
    level: 0,
    playerFaction: 'humans',
    difficulty: 1,
  };

  it('should create input state', () => {
    const input = createInputState();
    
    expect(input.selectedEntities).toEqual([]);
    expect(input.controlGroups.size).toBe(0);
    expect(input.isDragging).toBe(false);
    expect(input.camera).toEqual({ x: 0, y: 0 });
  });

  it('should select entity on click', () => {
    const state = initGame(defaultConfig);
    const input = createInputState();
    const layout = computeLayout(1280, 720);
    
    // Spawn a unit in the viewport area
    const unit = spawnTestUnit(state, 'humans', 'worker', 200, 200);
    
    // Click in viewport at the unit's position
    const screenX = 200;
    const screenY = 200;
    
    // Click on the unit
    handleMouseDown(input, state, layout, screenX, screenY, 0, false, 'humans');
    handleMouseUp(input, state, layout, screenX, screenY, 'humans');
    
    expect(input.selectedEntities.length).toBe(1);
    expect(input.selectedEntities[0].id).toBe(unit.id);
  });

  it('should handle shift-click to add to selection', () => {
    const state = initGame(defaultConfig);
    const input = createInputState();
    const layout = computeLayout(1280, 720);
    
    const unit1 = spawnTestUnit(state, 'humans', 'worker', 200, 200);
    const unit2 = spawnTestUnit(state, 'humans', 'worker', 202, 200);
    
    // Click first unit
    handleMouseDown(input, state, layout, 200, 200, 0, false, 'humans');
    handleMouseUp(input, state, layout, 200, 200, 'humans');
    
    expect(input.selectedEntities.length).toBe(1);
    
    // Shift-click second unit
    handleMouseDown(input, state, layout, 202, 200, 0, true, 'humans');
    handleMouseUp(input, state, layout, 202, 200, 'humans');
    
    expect(input.selectedEntities.length).toBe(2);
    
    // Suppress unused variable warnings
    void unit1;
    void unit2;
  });

  it('should handle control groups', () => {
    const state = initGame(defaultConfig);
    const input = createInputState();
    const layout = computeLayout(1280, 720);
    
    const unit = spawnTestUnit(state, 'humans', 'worker', 200, 200);
    
    // Select unit
    handleMouseDown(input, state, layout, 200, 200, 0, false, 'humans');
    handleMouseUp(input, state, layout, 200, 200, 'humans');
    
    // Ctrl+1 to set control group
    handleKeyDown(input, state, '1', true, 'humans');
    
    expect(input.controlGroups.has(1)).toBe(true);
    
    // Clear selection
    input.selectedEntities = [];
    
    // Press 1 to recall
    handleKeyDown(input, state, '1', false, 'humans');
    
    expect(input.selectedEntities.length).toBe(1);
    expect(input.selectedEntities[0].id).toBe(unit.id);
  });

  it('should handle pause on space', () => {
    const state = initGame(defaultConfig);
    const input = createInputState();
    const layout = computeLayout(1280, 720);
    
    expect(state.paused).toBe(false);
    
    handleKeyDown(input, state, ' ', false, 'humans');
    
    expect(state.paused).toBe(true);
    
    handleKeyDown(input, state, ' ', false, 'humans');
    
    expect(state.paused).toBe(false);
    
    // Suppress unused variable warnings
    void layout;
  });

  it('should handle escape to cancel', () => {
    const state = initGame(defaultConfig);
    const input = createInputState();
    const layout = computeLayout(1280, 720);
    
    input.placementMode = 'farm';
    
    handleKeyDown(input, state, 'Escape', false, 'humans');
    
    expect(input.placementMode).toBeNull();
    
    // Suppress unused variable warnings
    void layout;
  });
});
