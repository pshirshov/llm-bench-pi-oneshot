// HUD: top resource bar, bottom command/portrait panel, minimap. DOM-based.

import { type World, type EntityId } from './state.js';
import { FACTIONS, TILES, type TileId, UNIT_STATS, BUILDING_STATS, type UnitKind, type BuildingKind, type FactionId } from './data.js';
import { type RenderState } from './render.js';

export interface HudState {
  container: HTMLElement;
  top: HTMLElement;
  bottom: HTMLElement;
  selectionPanel: HTMLElement;
  commandPanel: HTMLElement;
  minimap: HTMLCanvasElement;
  onBuild: (bk: BuildingKind) => void;
  onTrain: (buildingId: EntityId, kind: UnitKind) => void;
  onCancelTrain: (buildingId: EntityId, index: number) => void;
}

export function buildHud(parent: HTMLElement, callbacks: { onBuild: (bk: BuildingKind) => void; onTrain: (id: EntityId, k: UnitKind) => void; onCancelTrain: (id: EntityId, i: number) => void }): HudState {
  parent.innerHTML = '';
  const top = document.createElement('div');
  top.className = 'hud-top';
  parent.appendChild(top);
  const bottom = document.createElement('div');
  bottom.className = 'hud-bottom';
  parent.appendChild(bottom);
  const selectionPanel = document.createElement('div');
  selectionPanel.className = 'selection-panel';
  bottom.appendChild(selectionPanel);
  const commandPanel = document.createElement('div');
  commandPanel.className = 'command-panel';
  bottom.appendChild(commandPanel);

  // minimap wrap
  const wrap = document.createElement('div');
  wrap.className = 'minimap-wrap';
  const minimap = document.createElement('canvas');
  minimap.id = 'minimap';
  minimap.width = 200;
  minimap.height = 200;
  wrap.appendChild(minimap);
  parent.appendChild(wrap);

  return {
    container: parent,
    top, bottom, selectionPanel, commandPanel, minimap,
    onBuild: callbacks.onBuild,
    onTrain: callbacks.onTrain,
    onCancelTrain: callbacks.onCancelTrain,
  };
}

const ICONS: Record<string, string> = {
  gold: '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#ffd700" stroke="#7a5a00"/></svg>',
  wood: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="3" y="2" width="10" height="12" fill="#8b5a2b" stroke="#3a1f0a"/><rect x="3" y="5" width="10" height="2" fill="#a0703b"/><rect x="3" y="9" width="10" height="2" fill="#a0703b"/></svg>',
  food: '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#a0d468" stroke="#3a5a18"/><circle cx="8" cy="8" r="2" fill="#3a5a18"/></svg>',
};

function res(name: string, value: string, klass: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `res ${klass}`;
  el.innerHTML = `${ICONS[name] ?? ''} <span>${value}</span>`;
  return el;
}

export function updateHud(h: HudState, w: World, rs: RenderState, seed: number, paused: boolean, speed: number): void {
  // top
  const f = w.factions.human;
  h.top.innerHTML = '';
  h.top.appendChild(res('gold', `${f.gold}`, 'gold'));
  h.top.appendChild(res('wood', `${f.wood}`, 'wood'));
  h.top.appendChild(res('food', `${f.supplyUsed}/${f.supplyCap}`, 'food'));
  const seedEl = document.createElement('div');
  seedEl.className = 'res seed';
  seedEl.textContent = `seed: ${seed}  |  L${w.level + 1}  |  ${paused ? 'PAUSE' : speed + 'x'}`;
  h.top.appendChild(seedEl);

  // selection panel
  h.selectionPanel.innerHTML = '';
  if (rs.selected.size === 0) {
    const empty = document.createElement('div');
    empty.style.color = '#888';
    empty.style.padding = '8px';
    empty.textContent = 'Select units or buildings (left-click, drag, or Ctrl+1..9)';
    h.selectionPanel.appendChild(empty);
  } else {
    let first = true;
    for (const id of rs.selected) {
      const u = w.units.get(id);
      const b = w.buildings.get(id);
      const e = u || b;
      if (!e) continue;
      const card = document.createElement('div');
      card.className = 'portrait';
      const art = document.createElement('div');
      art.className = 'art';
      if (u) {
        const fac = FACTIONS[u.faction];
        art.style.background = fac.primary;
        art.style.borderRadius = '50%';
        art.style.border = `2px solid ${fac.dark}`;
        art.innerHTML = `<div style="text-align:center;padding-top:20px;font-weight:bold;color:${fac.unitAccent}">${u.unitKind[0]?.toUpperCase() ?? '?'}</div>`;
      } else if (b) {
        const fac = FACTIONS[b.faction];
        art.style.background = fac.buildingWall;
        art.style.border = `2px solid ${fac.dark}`;
        art.innerHTML = `<div style="text-align:center;padding-top:20px;font-weight:bold;color:${fac.buildingRoof}">${b.buildingKind[0]?.toUpperCase() ?? '?'}</div>`;
      }
      card.appendChild(art);
      const name = document.createElement('div');
      name.className = 'name';
      if (u) {
        const fac = FACTIONS[u.faction];
        const stats = UNIT_STATS[u.unitKind];
        name.textContent = fac.id === u.faction ? (stats.nameIdx === 0 ? fac.workerName : stats.nameIdx === 1 ? fac.meleeName : stats.nameIdx === 2 ? fac.rangedName : fac.heavyName) : 'Unit';
      } else if (b) {
        const fac = FACTIONS[b.faction];
        const stats = BUILDING_STATS[b.buildingKind];
        const labels: Record<number, string> = { 0: fac.baseName, 1: fac.farmName, 2: fac.barracksName, 3: fac.millName, 4: fac.towerName };
        name.textContent = labels[stats.nameIdx] ?? b.buildingKind;
      }
      card.appendChild(name);
      const hp = document.createElement('div');
      hp.className = 'hp';
      const fill = document.createElement('div');
      fill.className = 'fill';
      const max = u ? UNIT_STATS[u.unitKind].hp : (b ? b.maxHp : 1);
      const cur = u ? u.hp : (b ? b.hp : 0);
      fill.style.width = `${Math.max(0, Math.min(100, (cur / max) * 100))}%`;
      hp.appendChild(fill);
      card.appendChild(hp);
      h.selectionPanel.appendChild(card);
      if (first && rs.selected.size <= 1) {
        // detail text below
        if (u) {
          const stats = UNIT_STATS[u.unitKind];
          const d = document.createElement('div');
          d.style.fontSize = '10px';
          d.style.color = '#ccc';
          d.style.padding = '4px 0';
          d.innerHTML = `HP ${u.hp}/${stats.hp} | DMG ${stats.damage.min}-${stats.damage.max}<br/>Armor ${stats.armor} | Range ${stats.attackRange}<br/>Cost ${stats.cost.gold}g ${stats.cost.wood}w | Supply ${stats.supply}`;
          h.selectionPanel.appendChild(d);
        }
        first = false;
      }
    }
  }

  // command panel
  h.commandPanel.innerHTML = '';
  const sel = rs.selected;
  if (sel.size === 1) {
    const id = sel.values().next().value as EntityId;
    const b = w.buildings.get(id);
    if (b && b.faction === 'human') {
      // show training queue
      for (let i = 0; i < b.trainQueue.length; i++) {
        const k = b.trainQueue[i] as UnitKind;
        const btn = document.createElement('button');
        btn.className = 'cmd-btn cancel';
        btn.innerHTML = `<div class="label">${k}</div><div class="cost">cancel</div>`;
        btn.onclick = () => h.onCancelTrain(b.id, i);
        h.commandPanel.appendChild(btn);
      }
      // currently training: progress bar
      if (b.trainQueue.length > 0) {
        const k = b.trainQueue[0] as UnitKind;
        const s = UNIT_STATS[k];
        const prog = b.trainProgress / s.buildTime;
        const bar = document.createElement('div');
        bar.className = 'cmd-btn';
        bar.style.cursor = 'default';
        bar.innerHTML = `<div class="label">Training ${k}</div><div class="progress" style="width:${prog * 100}%"></div>`;
        h.commandPanel.appendChild(bar);
      }
      // available train options
      if (b.buildingKind === 'townhall' || b.buildingKind === 'barracks') {
        const opts: UnitKind[] = b.buildingKind === 'townhall' ? ['worker'] : ['melee', 'ranged', 'heavy'];
        for (const k of opts) {
          const s = UNIT_STATS[k];
          const btn = document.createElement('button');
          btn.className = 'cmd-btn';
          btn.innerHTML = `<div class="ico" style="background:${FACTIONS[b.faction].primary}"></div><div class="label">${k}</div><div class="cost">${s.cost.gold}g ${s.cost.wood}w</div>`;
          btn.disabled = !canTrainHere(w, b.faction, b.buildingKind, k);
          btn.onclick = () => h.onTrain(b.id, k);
          h.commandPanel.appendChild(btn);
        }
      }
    }
  }
  // build buttons (always available for the player)
  for (const bk of (['farm', 'barracks', 'mill', 'tower'] as BuildingKind[])) {
    const s = BUILDING_STATS[bk];
    const fac = FACTIONS.human;
    const labels: Record<BuildingKind, string> = {
      townhall: fac.baseName, farm: fac.farmName, barracks: fac.barracksName, mill: fac.millName, tower: fac.towerName,
    };
    const btn = document.createElement('button');
    btn.className = 'cmd-btn';
    btn.innerHTML = `<div class="ico" style="background:${fac.buildingRoof}"></div><div class="label">${labels[bk]}</div><div class="cost">${s.cost.gold}g ${s.cost.wood}w</div>`;
    btn.disabled = w.factions.human.gold < s.cost.gold || w.factions.human.wood < s.cost.wood;
    btn.onclick = () => h.onBuild(bk);
    h.commandPanel.appendChild(btn);
  }
}

function canTrainHere(w: World, faction: FactionId, bk: BuildingKind, k: UnitKind): boolean {
  if (bk === 'townhall' && k !== 'worker') return false;
  if (bk === 'barracks' && k === 'worker') return false;
  if (k !== 'worker') {
    if ((k === 'ranged' || k === 'heavy') && !Array.from(w.buildings.values()).some((b) => b.faction === faction && b.buildingKind === 'mill' && !b.underConstruction)) {
      return false;
    }
  }
  const s = UNIT_STATS[k];
  const f = w.factions[faction];
  if (!f) return false;
  if (f.gold < s.cost.gold || f.wood < s.cost.wood) return false;
  if (f.supplyUsed + s.supply > f.supplyCap) return false;
  return true;
}

export function drawMinimap(canvas: HTMLCanvasElement, w: World, cam: CameraForMinimap): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const sx = W / w.map.width;
  const sy = H / w.map.height;
  for (let y = 0; y < w.map.height; y++) {
    for (let x = 0; x < w.map.width; x++) {
      const t = w.map.tiles[y * w.map.width + x] as TileId;
      const pal = TILE_PALETTE[t];
      ctx.fillStyle = pal;
      ctx.fillRect(x * sx, y * sy, Math.max(1, sx), Math.max(1, sy));
    }
  }
  // apply fog dim
  for (let y = 0; y < w.map.height; y++) {
    for (let x = 0; x < w.map.width; x++) {
      const v = w.factions.human.fog[y * w.map.width + x] as number;
      if (v === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
      } else if (v === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
      } else {
        continue;
      }
      ctx.fillRect(x * sx, y * sy, Math.max(1, sx), Math.max(1, sy));
    }
  }
  // units
  for (const u of w.units.values()) {
    const f = u.faction === 'human' ? '#ffd700' : u.faction === 'orc' ? '#f00' : '#888';
    ctx.fillStyle = f;
    ctx.fillRect(u.occ.x * sx, u.occ.y * sy, Math.max(1, sx * 0.7), Math.max(1, sy * 0.7));
  }
  // buildings
  for (const b of w.buildings.values()) {
    const f = b.faction === 'human' ? '#ffd700' : b.faction === 'orc' ? '#f00' : '#888';
    ctx.fillStyle = f;
    ctx.fillRect(b.pos.x * sx, b.pos.y * sy, Math.max(1, b.size.w * sx), Math.max(1, b.size.h * sy));
  }
  // viewport rect
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.strokeRect(cam.x * sx, cam.y * sy, cam.w * sx, cam.h * sy);
  void TILES;
}

const TILE_PALETTE: Record<TileId, string> = {
  grass: '#3aa15a',
  dirt: '#9b7a3a',
  forest: '#1f4a23',
  water: '#2c5a9b',
  rock: '#666',
  gold_mine: '#c79c2e',
};

export interface CameraForMinimap {
  x: number;
  y: number;
  w: number;
  h: number;
}
