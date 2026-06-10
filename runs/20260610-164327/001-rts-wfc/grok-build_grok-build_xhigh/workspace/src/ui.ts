import type { GameState, BuildingType, UnitType } from './types';
import { BUILDING_DATA, UNIT_DATA } from './data';
import { trainUnit, startConstruction } from './sim';

export function createUI(root: HTMLElement, state: GameState, onAction: (action: string, payload?: any) => void) {
  // Top HUD is drawn on canvas mostly. This adds the side selection panel + build buttons.

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'selection-panel';
  panel.style.width = '260px';
  panel.style.right = '8px';
  panel.style.bottom = '8px';
  panel.style.maxHeight = '280px';
  panel.style.overflowY = 'auto';
  panel.style.fontSize = '12px';
  root.appendChild(panel);

  // Minimap canvas
  const minimap = document.createElement('canvas');
  minimap.id = 'minimap';
  minimap.width = 160;
  minimap.height = 160;
  minimap.className = 'minimap';
  minimap.style.left = '8px';
  minimap.style.bottom = '48px';
  root.appendChild(minimap);

  const status = document.createElement('div');
  status.className = 'status hidden';
  status.id = 'status';
  root.appendChild(status);

  return { panel, minimap, status };
}

export function updateSelectionPanel(
  panel: HTMLElement,
  state: GameState,
  triggerBuild: (bt: BuildingType) => void,
  triggerTrain: (ut: UnitType) => void
): void {
  panel.innerHTML = '';

  const selIds = Array.from(state.selectedIds);
  if (selIds.length === 0) {
    panel.innerHTML = '<div style="color:#777;padding:6px">No selection</div>';
    return;
  }

  const sel = selIds.map(id => state.entities.get(id)).filter(Boolean);
  if (sel.length === 0) return;

  const first = sel[0]!;
  const isPlayer = first.faction === state.playerFaction;

  const title = document.createElement('div');
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '4px';
  if (sel.length > 1) {
    title.textContent = `${sel.length} units/buildings`;
  } else {
    const nm = first.kind === 'unit'
      ? (UNIT_DATA[first.faction] as any)[first.type].name
      : (BUILDING_DATA[first.faction] as any)[first.type].name;
    title.textContent = `${nm} (${Math.floor(first.hp)}/${first.maxHp} HP)`;
  }
  panel.appendChild(title);

  if (!isPlayer) return;

  // Commands
  const cmds = document.createElement('div');
  cmds.style.display = 'flex';
  cmds.style.gap = '4px';
  cmds.style.flexWrap = 'wrap';
  cmds.style.margin = '6px 0';

  const addBtn = (label: string, action: () => void, titleText = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = titleText;
    b.style.fontSize = '10px';
    b.style.padding = '2px 6px';
    b.style.background = '#222';
    b.style.border = '1px solid #555';
    b.style.color = '#ffcc66';
    b.style.cursor = 'pointer';
    b.onclick = (e) => { e.stopImmediatePropagation(); action(); };
    cmds.appendChild(b);
  };

  const anyWorker = sel.some(e => e && e.type === 'worker');
  const anyBarracks = sel.some(e => e && e.kind === 'building' && e.type === 'barracks' && (e as any).isBuilt);
  const anyTH = sel.some(e => e && e.kind === 'building' && e.type === 'th' && (e as any).isBuilt);
  const hasLumber = Array.from(state.entities.values()).some(e =>
    e && e.faction === state.playerFaction && e.kind === 'building' && e.type === 'lumbermill' && (e as any).isBuilt
  );

  if (anyWorker) {
    addBtn('Build Farm (F)', () => triggerBuild('farm'), 'Farm: +supply');
    addBtn('Build Barracks (B)', () => triggerBuild('barracks'), 'Trains infantry');
    addBtn('Build Lumber Mill (L)', () => triggerBuild('lumbermill'), 'Unlocks ranged');
    addBtn('Build Tower (T)', () => triggerBuild('tower'), 'Defense');
  }

  if (anyTH || anyBarracks) {
    addBtn('Train Peasant/W (W)', () => triggerTrain('worker'));
    addBtn('Train Footman (I)', () => triggerTrain('inf'));
  }
  if (anyBarracks && hasLumber) {
    addBtn('Train Archer (R)', () => triggerTrain('ranged'));
  }
  if (anyBarracks && hasLumber) {
    addBtn('Train Knight (H)', () => triggerTrain('heavy'));
  }

  panel.appendChild(cmds);

  // Resource costs for selected producer
  const costDiv = document.createElement('div');
  costDiv.style.fontSize = '10px';
  costDiv.style.opacity = '0.85';
  if (anyTH || anyBarracks) {
    costDiv.innerHTML = `Worker 65g | Footman 95g<br>`;
  }
  if (anyBarracks && hasLumber) {
    costDiv.innerHTML += `Archer 85g+40w | Knight 185g+55w`;
  }
  if (anyWorker) {
    costDiv.innerHTML += `<br>Farm 140g+85w &nbsp; Barracks 180g+110w`;
  }
  panel.appendChild(costDiv);
}

export function showWinLose(root: HTMLElement, state: GameState, onRestart: (nextLevel?: boolean) => void): void {
  const existing = root.querySelector('.winlose');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'winlose';

  const msg = document.createElement('div');
  if (state.gameOver === 'victory') {
    msg.innerHTML = `<span style="color:#5f5">VICTORY</span><br><span style="font-size:0.55em">Level ${state.level+1} complete</span>`;
  } else {
    msg.innerHTML = `<span style="color:#f55">DEFEAT</span>`;
  }
  overlay.appendChild(msg);

  const btns = document.createElement('div');
  btns.style.marginTop = '16px';

  if (state.gameOver === 'victory') {
    const nextBtn = document.createElement('button');
    nextBtn.textContent = state.level < 4 ? 'NEXT LEVEL →' : 'RESTART CAMPAIGN';
    nextBtn.onclick = () => { onRestart(true); overlay.remove(); };
    btns.appendChild(nextBtn);
  }

  const restartBtn = document.createElement('button');
  restartBtn.textContent = 'RESTART LEVEL';
  restartBtn.style.marginLeft = '8px';
  restartBtn.onclick = () => { onRestart(false); overlay.remove(); };
  btns.appendChild(restartBtn);

  overlay.appendChild(btns);
  root.appendChild(overlay);
}

export function updateMinimap(minimap: HTMLCanvasElement, state: GameState): void {
  const ctx = minimap.getContext('2d')!;
  // renderMinimap is in render.ts but we call it from main
  // here we just clear; actual draw done in main loop
}
