/**
 * Tests for UI layout: hit testing, element positioning.
 */

import { describe, it, expect } from 'vitest';
import { computeLayout, hitTest } from '../src/ui/layout';
import type { Rect } from '../src/ui/layout';

describe('UI Layout', () => {
  it('should compute layout for different viewport sizes', () => {
    const layout1 = computeLayout(1280, 720);
    const layout2 = computeLayout(1920, 1080);
    
    expect(layout1.viewport.width).toBe(1280);
    expect(layout1.viewport.height).toBe(720);
    expect(layout2.viewport.width).toBe(1920);
    expect(layout2.viewport.height).toBe(1080);
  });

  it('should have minimap inside viewport', () => {
    const layout = computeLayout(1280, 720);
    
    expect(layout.minimap.x).toBeGreaterThanOrEqual(0);
    expect(layout.minimap.y).toBeGreaterThanOrEqual(0);
    expect(layout.minimap.x + layout.minimap.width).toBeLessThanOrEqual(1280);
    expect(layout.minimap.y + layout.minimap.height).toBeLessThanOrEqual(720);
  });

  it('should have resource bar at top', () => {
    const layout = computeLayout(1280, 720);
    
    expect(layout.resourceBar.x).toBe(0);
    expect(layout.resourceBar.y).toBe(0);
    expect(layout.resourceBar.width).toBe(1280);
  });

  it('should have selection panel on right side', () => {
    const layout = computeLayout(1280, 720);
    
    expect(layout.selectionPanel.x).toBeGreaterThan(0);
    expect(layout.selectionPanel.x + layout.selectionPanel.width).toBeLessThanOrEqual(1280);
  });

  it('should have buttons inside selection panel', () => {
    const layout = computeLayout(1280, 720);
    
    for (const btn of layout.buttons) {
      expect(btn.rect.x).toBeGreaterThanOrEqual(layout.selectionPanel.x);
      expect(btn.rect.y).toBeGreaterThanOrEqual(layout.selectionPanel.y);
      expect(btn.rect.x + btn.rect.width).toBeLessThanOrEqual(
        layout.selectionPanel.x + layout.selectionPanel.width,
      );
    }
  });

  it('should hit test viewport correctly', () => {
    const layout = computeLayout(1280, 720);
    
    // Click in center of viewport (should be viewport)
    const result = hitTest(layout, 640, 400);
    expect(result).toBe('viewport');
  });

  it('should hit test minimap correctly', () => {
    const layout = computeLayout(1280, 720);
    
    // Click in center of minimap
    const centerX = layout.minimap.x + layout.minimap.width / 2;
    const centerY = layout.minimap.y + layout.minimap.height / 2;
    const result = hitTest(layout, centerX, centerY);
    expect(result).toBe('minimap');
  });

  it('should hit test resource bar correctly', () => {
    const layout = computeLayout(1280, 720);
    
    // Click in resource bar
    const result = hitTest(layout, 100, 20);
    expect(result).toBe('resourceBar');
  });

  it('should hit test selection panel correctly', () => {
    const layout = computeLayout(1280, 720);
    
    // Click in selection panel
    const centerX = layout.selectionPanel.x + layout.selectionPanel.width / 2;
    const centerY = layout.selectionPanel.y + layout.selectionPanel.height / 2;
    const result = hitTest(layout, centerX, centerY);
    expect(result).toBe('selectionPanel');
  });

  it('should hit test buttons correctly', () => {
    const layout = computeLayout(1280, 720);
    
    // Click each button
    for (const btn of layout.buttons) {
      const centerX = btn.rect.x + btn.rect.width / 2;
      const centerY = btn.rect.y + btn.rect.height / 2;
      const result = hitTest(layout, centerX, centerY);
      expect(result).toBe(btn.id);
    }
  });

  it('should not have overlapping sibling interactive elements', () => {
    const layout = computeLayout(1280, 720);
    
    // Check that top-level elements don't overlap
    // (Buttons inside selection panel are allowed to overlap with panel)
    const topLevel = [layout.minimap, layout.resourceBar, layout.selectionPanel];
    
    for (let i = 0; i < topLevel.length; i++) {
      for (let j = i + 1; j < topLevel.length; j++) {
        const overlap = rectsOverlap(topLevel[i], topLevel[j]);
        expect(overlap).toBe(false);
      }
    }
  });
});

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}
