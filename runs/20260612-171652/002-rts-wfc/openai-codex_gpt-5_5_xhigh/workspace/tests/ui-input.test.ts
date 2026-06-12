// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { TILE_SIZE } from '../src/sim/constants';
import { setResource } from './helpers';
import { makeWorld } from './helpers';
import type { Point, Rect } from '../src/sim/types';
import { InputController, type CameraState } from '../src/ui/input';
import { computeHudLayout, hitTest, interactiveSiblingsDoNotOverlap } from '../src/ui/layout';

function setupInput(): { canvas: HTMLCanvasElement; world: ReturnType<typeof makeWorld>; camera: CameraState; input: InputController; rect: Rect } {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.append(canvas);
  const world = makeWorld(40, 40);
  const camera = { x: 0, y: 0, zoom: 1 };
  const rect = { x: 20, y: 30, w: 1280, h: 960 };
  const input = new InputController({ canvas, world, camera, rectSource: { getRect: () => rect } });
  input.bind();
  return { canvas, world, camera, input, rect };
}

function client(rect: Rect, screen: Point, canvas: HTMLCanvasElement): Point {
  return { x: rect.x + (screen.x / canvas.width) * rect.w, y: rect.y + (screen.y / canvas.height) * rect.h };
}

function worldClient(rect: Rect, point: Point, canvas: HTMLCanvasElement): Point {
  return client(rect, { x: point.x * TILE_SIZE, y: point.y * TILE_SIZE }, canvas);
}

function mouse(canvas: HTMLCanvasElement, type: string, point: Point, button = 0, shiftKey = false): void {
  canvas.dispatchEvent(new MouseEvent(type, { clientX: point.x, clientY: point.y, button, buttons: button === 0 ? 1 : 2, shiftKey, bubbles: true }));
}

describe('input wiring through DOM events', () => {
  test('click selects a unit, shift-click adds, and drag box selects exactly enclosed units', () => {
    const { canvas, world, input, rect } = setupInput();
    const a = world.spawnUnit(1, 'worker', { x: 5, y: 5 });
    const b = world.spawnUnit(1, 'worker', { x: 7, y: 5 });
    const c = world.spawnUnit(1, 'worker', { x: 20, y: 20 });
    const aPoint = worldClient(rect, { x: 5.5, y: 5.5 }, canvas);
    mouse(canvas, 'mousedown', aPoint);
    mouse(canvas, 'mouseup', aPoint);
    expect(Array.from(world.selectedIds)).toEqual([a]);
    const bPoint = worldClient(rect, { x: 7.5, y: 5.5 }, canvas);
    mouse(canvas, 'mousedown', bPoint, 0, true);
    mouse(canvas, 'mouseup', bPoint, 0, true);
    expect(world.selectedIds.has(a)).toBe(true);
    expect(world.selectedIds.has(b)).toBe(true);
    const start = worldClient(rect, { x: 4, y: 4 }, canvas);
    const end = worldClient(rect, { x: 9, y: 7 }, canvas);
    mouse(canvas, 'mousedown', start);
    mouse(canvas, 'mouseup', end);
    expect(world.selectedIds.has(a)).toBe(true);
    expect(world.selectedIds.has(b)).toBe(true);
    expect(world.selectedIds.has(c)).toBe(false);
    input.unbind();
  });

  test('right-click dispatches move, attack, and harvest orders through the real control path', () => {
    const { canvas, world, input, rect } = setupInput();
    const worker = world.spawnUnit(1, 'worker', { x: 5, y: 5 });
    const enemy = world.spawnUnit(2, 'worker', { x: 12, y: 5 });
    world.selectedIds.add(worker);
    mouse(canvas, 'mousedown', worldClient(rect, { x: 10, y: 6 }, canvas), 2);
    expect(world.units.get(worker)?.order.kind).toBe('move');
    mouse(canvas, 'mousedown', worldClient(rect, { x: 12.5, y: 5.5 }, canvas), 2);
    expect(world.units.get(worker)?.order).toEqual({ kind: 'attack', targetId: enemy });
    setResource(world.map, { x: 15, y: 5 }, 'goldMine');
    mouse(canvas, 'mousedown', worldClient(rect, { x: 15.5, y: 5.5 }, canvas), 2);
    expect(world.units.get(worker)?.order.kind).toBe('harvest');
    input.unbind();
  });

  test('control groups and HUD train button enqueue through DOM events', () => {
    const { canvas, world, input, rect } = setupInput();
    const worker = world.spawnUnit(1, 'worker', { x: 5, y: 5 });
    const hall = world.spawnBuilding(1, 'townHall', { x: 10, y: 10 });
    world.selectedIds.add(worker);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }));
    world.selectedIds.clear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(Array.from(world.selectedIds)).toEqual([worker]);
    world.selectedIds.clear();
    world.selectedIds.add(hall);
    const layout = computeHudLayout(canvas.width, canvas.height);
    const train = layout.buttons.find(button => button.id === 'train-worker');
    if (train === undefined) {
      throw new Error('train button missing');
    }
    const center = client(rect, { x: train.rect.x + train.rect.w / 2, y: train.rect.y + train.rect.h / 2 }, canvas);
    mouse(canvas, 'mousedown', center);
    expect(world.requireBuilding(hall).queue.length).toBe(1);
    input.unbind();
  });
});

describe('HUD layout', () => {
  test('interactive HUD rectangles fit and hit-test at centers for 1280x720', () => {
    assertLayout(1280, 720);
  });

  test('interactive HUD rectangles fit and hit-test at centers for 1920x1080', () => {
    assertLayout(1920, 1080);
  });
});

function assertLayout(width: number, height: number): void {
  const layout = computeHudLayout(width, height);
  expect(interactiveSiblingsDoNotOverlap(layout)).toBe(true);
  for (const element of layout.elements) {
    expect(element.rect.x).toBeGreaterThanOrEqual(0);
    expect(element.rect.y).toBeGreaterThanOrEqual(0);
    expect(element.rect.x + element.rect.w).toBeLessThanOrEqual(width);
    expect(element.rect.y + element.rect.h).toBeLessThanOrEqual(height);
    expect(hitTest(layout, element.rect.x + element.rect.w / 2, element.rect.y + element.rect.h / 2)?.id).toBe(element.id);
  }
  expect(layout.minimap.rect.y).toBeGreaterThanOrEqual(layout.resourceBar.rect.y + layout.resourceBar.rect.h);
  expect(layout.selectionPanel.rect.y).toBeGreaterThanOrEqual(layout.resourceBar.rect.y + layout.resourceBar.rect.h);
}
