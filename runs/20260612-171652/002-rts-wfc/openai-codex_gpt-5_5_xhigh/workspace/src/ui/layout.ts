import type { BuildingKind, Rect, UnitKind } from '../sim/types';
import { rectContains, rectsOverlap } from '../sim/utils';

export type HudElementKind = 'resourceBar' | 'minimap' | 'selectionPanel' | 'button' | 'speed' | 'pause';
export type HudButtonAction =
  | { type: 'train'; unit: UnitKind }
  | { type: 'build'; building: BuildingKind }
  | { type: 'speed' }
  | { type: 'pause' };

export interface HudElement {
  id: string;
  kind: HudElementKind;
  rect: Rect;
  parentId?: string;
  action?: HudButtonAction;
  label: string;
}

export interface HudLayout {
  viewport: Rect;
  resourceBar: HudElement;
  minimap: HudElement;
  selectionPanel: HudElement;
  buttons: HudElement[];
  elements: HudElement[];
}

const barHeight = 36;
const panelHeight = 176;
const minimapSize = 156;
const gap = 10;
const buttonSize = 42;

export function computeHudLayout(width: number, height: number): HudLayout {
  const viewport = { x: 0, y: 0, w: width, h: height };
  const resourceBar = element('resourceBar', 'resourceBar', { x: 0, y: 0, w: width, h: barHeight }, 'Resources');
  const minimap = element('minimap', 'minimap', { x: gap, y: height - panelHeight + gap, w: minimapSize, h: minimapSize }, 'Minimap');
  const selectionPanel = element('selectionPanel', 'selectionPanel', { x: minimap.rect.x + minimap.rect.w + gap, y: height - panelHeight + gap, w: width - minimap.rect.w - gap * 3, h: panelHeight - gap * 2 }, 'Selection');
  const buttons = makeButtons(selectionPanel);
  const speed = element('speed', 'speed', { x: width - 104, y: 4, w: 46, h: 28 }, '2x', undefined, { type: 'speed' });
  const pause = element('pause', 'pause', { x: width - 52, y: 4, w: 46, h: 28 }, 'Pause', undefined, { type: 'pause' });
  const allButtons = [...buttons, speed, pause];
  return { viewport, resourceBar, minimap, selectionPanel, buttons: allButtons, elements: [resourceBar, minimap, selectionPanel, ...allButtons] };
}

export function hitTest(layout: HudLayout, x: number, y: number): HudElement | undefined {
  for (let i = layout.buttons.length - 1; i >= 0; i -= 1) {
    const button = layout.buttons[i];
    if (rectContains(button.rect, { x, y })) {
      return button;
    }
  }
  const panels = [layout.minimap, layout.selectionPanel, layout.resourceBar];
  return panels.find(item => rectContains(item.rect, { x, y }));
}

export function interactiveSiblingsDoNotOverlap(layout: HudLayout): boolean {
  for (let i = 0; i < layout.buttons.length; i += 1) {
    for (let j = i + 1; j < layout.buttons.length; j += 1) {
      if (layout.buttons[i].parentId === layout.buttons[j].parentId && rectsOverlap(layout.buttons[i].rect, layout.buttons[j].rect)) {
        return false;
      }
    }
  }
  return true;
}

function makeButtons(panel: HudElement): HudElement[] {
  const actions: Array<{ id: string; label: string; action: HudButtonAction }> = [
    { id: 'train-worker', label: 'Worker', action: { type: 'train', unit: 'worker' } },
    { id: 'train-melee', label: 'Melee', action: { type: 'train', unit: 'melee' } },
    { id: 'train-ranged', label: 'Ranged', action: { type: 'train', unit: 'ranged' } },
    { id: 'train-heavy', label: 'Heavy', action: { type: 'train', unit: 'heavy' } },
    { id: 'build-farm', label: 'Farm', action: { type: 'build', building: 'farm' } },
    { id: 'build-barracks', label: 'Barracks', action: { type: 'build', building: 'barracks' } },
    { id: 'build-lumber', label: 'Mill', action: { type: 'build', building: 'lumberMill' } },
    { id: 'build-tower', label: 'Tower', action: { type: 'build', building: 'guardTower' } }
  ];
  return actions.map((action, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const rect = { x: panel.rect.x + gap + col * (buttonSize + gap), y: panel.rect.y + gap + row * (buttonSize + gap), w: buttonSize, h: buttonSize };
    return element(action.id, 'button', rect, action.label, panel.id, action.action);
  });
}

function element(id: string, kind: HudElementKind, rect: Rect, label: string, parentId?: string, action?: HudButtonAction): HudElement {
  return { id, kind, rect, label, parentId, action };
}
