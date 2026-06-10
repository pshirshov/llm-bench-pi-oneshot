import { GameSession } from './app';
import { Faction, FACTIONS } from './game/data';
import { GameResult } from './game/state';
import { LEVELS } from './map/levels';

const UNLOCK_KEY = 'warband.unlocked';

interface AppState {
  campaignSeed: number;
  faction: Faction;
  unlocked: number; // highest unlocked level (1-based)
}

function readSeed(): number {
  const param = new URLSearchParams(window.location.search).get('seed');
  if (param !== null) {
    const n = Number(param);
    if (Number.isFinite(n)) return n >>> 0;
  }
  // No seed given: derive one from the clock, then expose it in the UI/URL so
  // the session stays reproducible.
  return Date.now() >>> 0;
}

function readUnlocked(): number {
  const raw = window.localStorage.getItem(UNLOCK_KEY);
  const n = raw === null ? 1 : Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, LEVELS.length) : 1;
}

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const app: AppState = {
  campaignSeed: readSeed(),
  faction: Faction.Humans,
  unlocked: readUnlocked(),
};

let session: GameSession | null = null;
let canvas: HTMLCanvasElement | null = null;

function clear(): void {
  if (session) {
    session.dispose();
    session = null;
  }
  root!.innerHTML = '';
  canvas = null;
}

function el(tag: string, props: Record<string, string>, ...children: (HTMLElement | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function button(label: string, onClick: () => void, cls = ''): HTMLElement {
  const b = el('button', cls ? { class: cls } : {});
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ---------------------------------------------------------------------------
// Screens

function showMainMenu(): void {
  clear();
  const screen = el('div', { class: 'screen' });
  screen.append(el('h1', {}, 'WARBAND'));
  screen.append(el('p', {}, 'A real-time strategy game of two warring factions. Gather gold and wood, raise an army, and raze the enemy to the ground.'));
  screen.append(el('p', { class: 'small' }, `Campaign seed: ${app.campaignSeed} — set ?seed=<number> in the URL to replay a campaign.`));

  const row = el('div', { class: 'row' });
  for (const f of [Faction.Humans, Faction.Orcs]) {
    const def = FACTIONS[f];
    const b = button(`Play ${def.name}`, () => {
      app.faction = f;
      showLevelSelect();
    }, 'faction-btn');
    b.style.borderColor = def.color;
    row.append(b);
  }
  screen.append(row);
  screen.append(el('p', { class: 'small' }, 'Campaign progress is saved in this browser.'));
  root!.append(screen);
}

function showLevelSelect(): void {
  clear();
  const screen = el('div', { class: 'screen' });
  screen.append(el('h2', {}, `Campaign — ${FACTIONS[app.faction].name}`));
  for (const lvl of LEVELS) {
    const locked = lvl.id > app.unlocked;
    const b = button(
      `${lvl.id}. ${lvl.name} — ${lvl.size}×${lvl.size}, difficulty ${lvl.difficulty}${locked ? ' 🔒' : ''}`,
      () => startLevel(lvl.id),
    );
    if (locked) b.setAttribute('disabled', 'disabled');
    screen.append(b);
  }
  screen.append(button('Back', showMainMenu));
  root!.append(screen);
}

function startLevel(level: number): void {
  clear();
  canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  root!.append(canvas);

  session = new GameSession(canvas, {
    level,
    campaignSeed: app.campaignSeed,
    playerFaction: app.faction,
    onResult: (result) => showResult(result, level),
  });
}

function showResult(result: GameResult, level: number): void {
  // Keep the finished game rendering underneath the overlay.
  const overlay = el('div', { class: 'screen' });
  overlay.style.background = 'rgba(8, 8, 14, 0.82)';
  if (result === 'victory') {
    if (level >= app.unlocked && level < LEVELS.length) {
      app.unlocked = level + 1;
      window.localStorage.setItem(UNLOCK_KEY, String(app.unlocked));
    }
    overlay.append(el('h2', {}, 'Victory!'));
    overlay.append(el('p', {}, `${LEVELS[level - 1].name} is yours.`));
    if (level < LEVELS.length) {
      overlay.append(button(`Next level: ${LEVELS[level].name}`, () => startLevel(level + 1)));
    } else {
      overlay.append(el('p', {}, 'The campaign is complete. Well fought!'));
    }
  } else {
    overlay.append(el('h2', {}, 'Defeat'));
    overlay.append(el('p', {}, 'Your last building has fallen.'));
    overlay.append(button('Retry level', () => startLevel(level)));
  }
  overlay.append(button('Level select', showLevelSelect));
  overlay.append(button('Main menu', showMainMenu));
  root!.append(overlay);
}

window.addEventListener('resize', () => {
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
});

showMainMenu();
