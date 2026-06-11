/**
 * Lightweight DOM overlay menus.
 *
 * Each menu is created lazily on first `show*` call and kept in the DOM,
 * toggled visible/hidden via CSS display.
 *
 * Guard: all DOM access is wrapped in functions that check for a global
 * `document` so the module can be imported in Node (test) environments
 * without crashing — as long as callers do not invoke `show*` / `hide*` in
 * a headless context.
 *
 * T17/T18 wire these into the screen flow.
 */

// ---------------------------------------------------------------------------
// Utility: safe document access
// ---------------------------------------------------------------------------

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  return e;
}

function css(e: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(e.style, styles);
}

// ---------------------------------------------------------------------------
// Shared overlay style
// ---------------------------------------------------------------------------

function applyOverlayStyle(root: HTMLElement): void {
  css(root, {
    position: "fixed",
    inset: "0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.80)",
    color: "#ffffff",
    fontFamily: "sans-serif",
    zIndex: "100",
  });
}

function applyBoxStyle(box: HTMLElement): void {
  css(box, {
    background: "#1a1a2e",
    border: "2px solid #4169e1",
    borderRadius: "8px",
    padding: "32px 40px",
    minWidth: "320px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    alignItems: "center",
  });
}

// ---------------------------------------------------------------------------
// Callbacks type
// ---------------------------------------------------------------------------

export interface MainMenuCallbacks {
  onStart: (seed: string) => void;
}

export interface LevelSelectCallbacks {
  onSelect: (levelIndex: number) => void;
  onBack: () => void;
}

export interface VictoryCallbacks {
  onRestart: () => void;
  onMainMenu: () => void;
}

export interface DefeatCallbacks {
  onRestart: () => void;
  onMainMenu: () => void;
}

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

let mainMenuEl: HTMLElement | null = null;

/**
 * Shows the main menu overlay.  Creates the DOM element on first call.
 * No-op in headless environments (no `document`).
 */
export function showMainMenu(callbacks: MainMenuCallbacks): void {
  if (!hasDocument()) return;

  if (mainMenuEl === null) {
    mainMenuEl = buildMainMenu(callbacks);
    document.body.appendChild(mainMenuEl);
  }
  mainMenuEl.style.display = "flex";
}

/** Hides the main menu. No-op if never shown or no `document`. */
export function hideMainMenu(): void {
  if (mainMenuEl !== null) {
    mainMenuEl.style.display = "none";
  }
}

function buildMainMenu(callbacks: MainMenuCallbacks): HTMLElement {
  const root = el("div", "menu-main");
  applyOverlayStyle(root);

  const box = el("div");
  applyBoxStyle(box);

  const title = el("h1");
  title.textContent = "Warband";
  css(title, { margin: "0", fontSize: "36px", letterSpacing: "4px" });
  box.appendChild(title);

  // Seed input
  const seedLabel = el("label");
  seedLabel.textContent = "Seed (optional):";
  css(seedLabel, { alignSelf: "flex-start", fontSize: "13px" });
  box.appendChild(seedLabel);

  const seedInput = document.createElement("input");
  seedInput.type = "text";
  seedInput.placeholder = "e.g. 12345";
  css(seedInput, {
    width: "100%",
    padding: "6px 10px",
    borderRadius: "4px",
    border: "1px solid #555",
    background: "#111",
    color: "#fff",
    fontSize: "14px",
    boxSizing: "border-box",
  });
  box.appendChild(seedInput);

  const startBtn = document.createElement("button");
  startBtn.textContent = "Start Game";
  css(startBtn, {
    padding: "10px 32px",
    fontSize: "16px",
    cursor: "pointer",
    background: "#4169e1",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
  });
  startBtn.addEventListener("click", () => {
    callbacks.onStart(seedInput.value.trim());
  });
  box.appendChild(startBtn);

  root.appendChild(box);
  return root;
}

// ---------------------------------------------------------------------------
// Level select
// ---------------------------------------------------------------------------

const LEVEL_COUNT = 4;
let levelSelectEl: HTMLElement | null = null;

/**
 * Shows the level-select overlay.  Creates the DOM element on first call.
 * No-op in headless environments.
 */
export function showLevelSelect(callbacks: LevelSelectCallbacks): void {
  if (!hasDocument()) return;

  if (levelSelectEl === null) {
    levelSelectEl = buildLevelSelect(callbacks);
    document.body.appendChild(levelSelectEl);
  }
  levelSelectEl.style.display = "flex";
}

/** Hides the level-select overlay. */
export function hideLevelSelect(): void {
  if (levelSelectEl !== null) {
    levelSelectEl.style.display = "none";
  }
}

function buildLevelSelect(callbacks: LevelSelectCallbacks): HTMLElement {
  const root = el("div", "menu-level-select");
  applyOverlayStyle(root);

  const box = el("div");
  applyBoxStyle(box);

  const title = el("h2");
  title.textContent = "Select Level";
  css(title, { margin: "0" });
  box.appendChild(title);

  for (let i = 0; i < LEVEL_COUNT; i++) {
    const btn = document.createElement("button");
    btn.textContent = `Level ${i + 1}`;
    css(btn, {
      padding: "8px 24px",
      fontSize: "15px",
      cursor: "pointer",
      background: "#333",
      color: "#fff",
      border: "1px solid #555",
      borderRadius: "4px",
      width: "100%",
    });
    const levelIndex = i;
    btn.addEventListener("click", () => callbacks.onSelect(levelIndex));
    box.appendChild(btn);
  }

  const backBtn = document.createElement("button");
  backBtn.textContent = "Back";
  css(backBtn, {
    padding: "8px 24px",
    fontSize: "14px",
    cursor: "pointer",
    background: "transparent",
    color: "#aaa",
    border: "1px solid #555",
    borderRadius: "4px",
    width: "100%",
  });
  backBtn.addEventListener("click", () => callbacks.onBack());
  box.appendChild(backBtn);

  root.appendChild(box);
  return root;
}

// ---------------------------------------------------------------------------
// Victory / Defeat
// ---------------------------------------------------------------------------

let victoryEl: HTMLElement | null = null;
let defeatEl: HTMLElement | null = null;

/**
 * Shows the victory overlay.  Creates the DOM element on first call.
 * No-op in headless environments.
 */
export function showVictory(callbacks: VictoryCallbacks): void {
  if (!hasDocument()) return;

  if (victoryEl === null) {
    victoryEl = buildResultScreen("Victory!", "#ffd700", callbacks.onRestart, callbacks.onMainMenu);
    document.body.appendChild(victoryEl);
  }
  victoryEl.style.display = "flex";
}

/** Hides the victory overlay. */
export function hideVictory(): void {
  if (victoryEl !== null) {
    victoryEl.style.display = "none";
  }
}

/**
 * Shows the defeat overlay.  Creates the DOM element on first call.
 * No-op in headless environments.
 */
export function showDefeat(callbacks: DefeatCallbacks): void {
  if (!hasDocument()) return;

  if (defeatEl === null) {
    defeatEl = buildResultScreen("Defeat", "#cc2200", callbacks.onRestart, callbacks.onMainMenu);
    document.body.appendChild(defeatEl);
  }
  defeatEl.style.display = "flex";
}

/** Hides the defeat overlay. */
export function hideDefeat(): void {
  if (defeatEl !== null) {
    defeatEl.style.display = "none";
  }
}

function buildResultScreen(
  heading: string,
  headingColor: string,
  onRestart: () => void,
  onMainMenu: () => void,
): HTMLElement {
  const root = el("div", "menu-result");
  applyOverlayStyle(root);

  const box = el("div");
  applyBoxStyle(box);

  const title = el("h1");
  title.textContent = heading;
  css(title, { margin: "0", fontSize: "48px", color: headingColor });
  box.appendChild(title);

  const restartBtn = document.createElement("button");
  restartBtn.textContent = "Restart";
  css(restartBtn, {
    padding: "10px 32px",
    fontSize: "16px",
    cursor: "pointer",
    background: "#4169e1",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
  });
  restartBtn.addEventListener("click", onRestart);
  box.appendChild(restartBtn);

  const menuBtn = document.createElement("button");
  menuBtn.textContent = "Main Menu";
  css(menuBtn, {
    padding: "10px 32px",
    fontSize: "16px",
    cursor: "pointer",
    background: "transparent",
    color: "#aaa",
    border: "1px solid #555",
    borderRadius: "4px",
  });
  menuBtn.addEventListener("click", onMainMenu);
  box.appendChild(menuBtn);

  root.appendChild(box);
  return root;
}
