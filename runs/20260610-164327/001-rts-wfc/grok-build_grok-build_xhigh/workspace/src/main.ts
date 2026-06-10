import type { GameState, Faction, BuildingType, UnitType } from './types';
import { createInitialState, tickSimulation, issueOrder, selectEntities, togglePause, cycleSpeed, trainUnit, startConstruction } from './sim';
import { createRenderContext, render, renderMinimap, drawSelectionBox, drawHUD } from './render';
import type { RenderContext } from './render';
import { attachInput, createInputState, getBuildPreview as inputGetBuildPreview } from './input';
import type { InputState } from './input';
import { createUI, updateSelectionPanel, showWinLose } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('root')!;

let state: GameState;
let rc: RenderContext;
let input: InputState;
let ui: ReturnType<typeof createUI>;
let lastTime = performance.now();
let acc = 0;
let raf = 0;

let currentLevel = 0;
let unlockedLevels = 1; // start with level 1
let campaignSeed = 424242;

function getUrlSeed(): number | null {
  const p = new URLSearchParams(location.search);
  const s = p.get('seed');
  if (s) {
    const n = parseInt(s, 10);
    if (!isNaN(n)) return n >>> 0;
  }
  return null;
}

function startLevel(level: number, playerFaction: Faction, seedOverride?: number) {
  const seed = seedOverride ?? (getUrlSeed() ?? hashSeed(campaignSeed, level * 31 + 7));
  state = createInitialState(level, playerFaction, seed);
  rc.camX = state.camX;
  rc.camY = state.camY;

  // reset input
  input.buildMode = null;
  state.selectedIds.clear();

  // hide any win/lose
  const existing = root.querySelectorAll('.winlose, .menu');
  existing.forEach(el => el.remove());

  // kick off loop if needed
  if (!raf) gameLoop();
}

function showMainMenu() {
  cancelAnimationFrame(raf);
  raf = 0;

  const menu = document.createElement('div');
  menu.className = 'menu';

  const title = document.createElement('h1');
  title.textContent = 'WARBAND';
  menu.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Real-Time Strategy • WFC Maps • Seeded';
  subtitle.style.marginBottom = '18px';
  subtitle.style.color = '#888';
  menu.appendChild(subtitle);

  // Faction picker + start buttons
  const facRow = document.createElement('div');
  facRow.style.margin = '12px 0 16px';
  facRow.style.display = 'flex';
  facRow.style.gap = '12px';
  facRow.style.justifyContent = 'center';

  let chosenFaction: Faction = 'human';

  const humanBtn = document.createElement('button');
  humanBtn.textContent = 'HUMANS';
  humanBtn.style.borderColor = '#3a6db5';
  humanBtn.onclick = () => { chosenFaction = 'human'; refreshFac(); };
  const orcBtn = document.createElement('button');
  orcBtn.textContent = 'ORCS';
  orcBtn.style.borderColor = '#3f6f3f';
  orcBtn.onclick = () => { chosenFaction = 'orc'; refreshFac(); };

  function refreshFac() {
    humanBtn.style.background = chosenFaction === 'human' ? '#3a6db5' : '#222';
    orcBtn.style.background = chosenFaction === 'orc' ? '#3f6f3f' : '#222';
    humanBtn.style.color = '#fff';
    orcBtn.style.color = '#fff';
  }
  refreshFac();

  facRow.appendChild(humanBtn);
  facRow.appendChild(orcBtn);
  menu.appendChild(facRow);

  const startBtn = document.createElement('button');
  startBtn.textContent = 'START CAMPAIGN';
  startBtn.onclick = () => {
    menu.remove();
    currentLevel = 0;
    unlockedLevels = 1;
    startLevel(0, chosenFaction);
  };
  menu.appendChild(startBtn);

  // Level select
  const levelTitle = document.createElement('div');
  levelTitle.textContent = 'LEVEL SELECT';
  levelTitle.style.margin = '22px 0 6px';
  levelTitle.style.fontSize = '13px';
  levelTitle.style.color = '#888';
  menu.appendChild(levelTitle);

  const levelsDiv = document.createElement('div');
  levelsDiv.className = 'level';

  for (let i = 0; i < NUM_LEVELS; i++) {
    const lb = document.createElement('button');
    lb.className = 'level-btn';
    lb.textContent = String(i + 1);
    if (i >= unlockedLevels) {
      lb.classList.add('locked');
      lb.textContent += ' 🔒';
      lb.onclick = () => {};
    } else {
      lb.onclick = () => {
        menu.remove();
        currentLevel = i;
        startLevel(i, chosenFaction);
      };
    }
    levelsDiv.appendChild(lb);
  }
  menu.appendChild(levelsDiv);

  const seedInfo = document.createElement('div');
  seedInfo.style.marginTop = '24px';
  seedInfo.style.fontSize = '10px';
  seedInfo.style.color = '#555';
  seedInfo.textContent = `Seed: ${campaignSeed}  •  ?seed=XXXXXX in URL overrides`;
  menu.appendChild(seedInfo);

  root.appendChild(menu);
}

function gameLoop() {
  const now = performance.now();
  let frameTime = now - lastTime;
  lastTime = now;
  if (frameTime > 120) frameTime = 120; // clamp spiral

  acc += frameTime;

  const stepsPerFrame = state ? state.speed : 1;
  const targetSteps = Math.floor(acc / SIM_DT);

  if (state && !state.paused && state.gameOver === 'none') {
    const doSteps = Math.min(targetSteps, 6); // safety
    if (doSteps > 0) {
      tickSimulation(state, doSteps * stepsPerFrame);
      acc -= doSteps * SIM_DT;
    }
  } else {
    acc = 0;
  }

  // camera sync
  if (state) {
    state.camX = rc.camX;
    state.camY = rc.camY;
  }

  // render
  if (state) {
    const buildPrev = inputGetBuildPreview(state, input, rc);
    render(rc, state, undefined, buildPrev);

    // draw drag selection box
    if (input.isDragging && input.mouseDown) {
      drawSelectionBox(rc.ctx, input.dragStartX, input.dragStartY, input.mouseX, input.mouseY);
    }

    drawHUD(rc.ctx, state, rc.w);

    // minimap
    const mm = ui.minimap as HTMLCanvasElement;
    const mmCtx = mm.getContext('2d')!;
    renderMinimap(mmCtx, state, 160, 0, 0);

    // selection panel
    updateSelectionPanel(ui.panel, state, (bt: BuildingType) => {
      // enter build mode
      input.buildMode = bt;
    }, (ut: UnitType) => {
      const ok = trainUnit(state, ut);
      // no feedback sound, just visual
    });

    // status
    const statusEl = document.getElementById('status')!;
    if (state.gameOver !== 'none') {
      statusEl.classList.remove('hidden');
      statusEl.textContent = state.gameOver.toUpperCase();
      statusEl.style.color = state.gameOver === 'victory' ? '#5f5' : '#f55';
    } else {
      statusEl.classList.add('hidden');
    }

    // win/lose modal
    if (state.gameOver !== 'none') {
      const exists = root.querySelector('.winlose');
      if (!exists) {
        showWinLose(root, state, (nextLevel?: boolean) => {
          if (nextLevel && state.gameOver === 'victory') {
            unlockedLevels = Math.max(unlockedLevels, state.level + 2);
            currentLevel = Math.min(NUM_LEVELS - 1, state.level + 1);
            const nextSeed = hashSeed(campaignSeed, currentLevel * 31 + 7);
            startLevel(currentLevel, state.playerFaction, nextSeed);
          } else {
            startLevel(state.level, state.playerFaction);
          }
        });
      }
    }
  }

  // handle build preview cursor style
  if (input.buildMode) {
    canvas.style.cursor = 'crosshair';
  } else {
    canvas.style.cursor = input.hoveredEntityId ? 'pointer' : 'default';
  }

  raf = requestAnimationFrame(gameLoop);
}

// Global controls for keyboard
(window as any).__warbandTogglePause = () => {
  if (state) {
    togglePause(state);
  }
};
(window as any).__warbandCycleSpeed = () => {
  if (state) cycleSpeed(state);
};

// Boot
function boot() {
  rc = createRenderContext(canvas);
  input = createInputState();
  ui = createUI(root, null as any, () => {});

  // Attach input handlers
  attachInput(
    canvas,
    rc,
    null as any, // will be rebound on level start
    input,
    (bt: BuildingType, fx: number, fy: number) => {
      if (!state) return;
      // attempt immediate construction (worker order happens via right-click usually)
      const ok = startConstruction(state, bt, fx, fy);
      if (ok) {
        // if we spent, auto-order nearest worker to it (if selected or idle)
        const workers = Array.from(state.entities.values()).filter(
          e => e.faction === state.playerFaction && e.type === 'worker' && e.order === 'idle'
        );
        if (workers.length > 0) {
          const nearest = workers.reduce((a, b) =>
            Math.hypot(a.pos.x - fx - 0.5, a.pos.y - fy - 0.5) <
            Math.hypot(b.pos.x - fx - 0.5, b.pos.y - fy - 0.5) ? a : b
          );
          // issue build order to nearest
          issueOrder(state, { type: 'build', pos: { x: fx + 0.5, y: fy + 0.5 }, buildingType: bt });
          // move the chosen one explicitly
          selectEntities(state, [nearest.id], false);
        }
      }
      input.buildMode = null;
    },
    (ut: UnitType) => {
      if (state) trainUnit(state, ut);
    },
    () => ui.panel
  );

  // initial camera position
  rc.camX = 3;
  rc.camY = 3;

  // Start at main menu
  showMainMenu();

  // Expose for debugging
  (window as any).warband = {
    getState: () => state,
    setSpeed: (s: 1|2) => { if (state) state.speed = s; },
    forceTick: (n = 1) => { if (state) tickSimulation(state, n); }
  };

  // Keyboard global pause/speed already wired via the __warband* hooks
  // Bonus: click outside canvas etc handled naturally
}

boot();
