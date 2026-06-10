/**
 * Headless harness for the browser layer: stubs just enough DOM/canvas API
 * to construct a real GameSession and drive frames, input, and HUD rendering.
 * Catches runtime type errors in render/HUD/input code without a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (e: unknown) => void;

function makeCtxStub(canvas: unknown): CanvasRenderingContext2D {
  const target = {
    canvas,
    measureText: () => ({ width: 10 }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  } as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      return () => undefined; // every drawing method becomes a no-op
    },
    set(t, p, v) {
      t[p] = v; // style property assignments
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

interface CanvasStub {
  width: number;
  height: number;
  listeners: Map<string, Listener[]>;
  getContext: (kind: string) => CanvasRenderingContext2D;
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
  getBoundingClientRect: () => { left: number; top: number };
  fire: (type: string, e: Record<string, unknown>) => void;
}

function makeCanvasStub(width: number, height: number): CanvasStub {
  const listeners = new Map<string, Listener[]>();
  const stub: CanvasStub = {
    width,
    height,
    listeners,
    getContext: () => makeCtxStub(stub),
    addEventListener: (type, fn) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type) ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    fire: (type, e) => {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        fn({ preventDefault: () => undefined, ...e });
      }
    },
  };
  return stub;
}

describe('GameSession browser-layer smoke test', () => {
  let rafCallbacks: FrameRequestCallback[];
  let windowListeners: Map<string, Listener[]>;
  let now: number;

  beforeEach(() => {
    rafCallbacks = [];
    windowListeners = new Map();
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
        return makeCanvasStub(0, 0);
      },
    });
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: Listener) => {
        const list = windowListeners.get(type) ?? [];
        list.push(fn);
        windowListeners.set(type, list);
      },
      removeEventListener: () => undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function pumpFrames(count: number, stepMs = 33): void {
    for (let i = 0; i < count; i++) {
      now += stepMs;
      const cbs = rafCallbacks.splice(0, rafCallbacks.length);
      for (const cb of cbs) cb(now);
    }
  }

  function fireWindow(type: string, e: Record<string, unknown>): void {
    for (const fn of [...(windowListeners.get(type) ?? [])]) {
      fn({ preventDefault: () => undefined, ...e });
    }
  }

  it('boots, simulates, and survives a burst of UI input without throwing', async () => {
    const { GameSession } = await import('../src/app');
    const { Faction } = await import('../src/game/data');

    const canvas = makeCanvasStub(1280, 800);
    let result: string | null = null;
    const session = new GameSession(canvas as unknown as HTMLCanvasElement, {
      level: 1,
      campaignSeed: 90210,
      playerFaction: Faction.Humans,
      onResult: (r) => (result = r),
    });

    pumpFrames(60); // ~2 seconds of play
    expect(session.state.tick).toBeGreaterThan(30); // fixed-timestep advanced

    // Box-select around the player's start (centre of the screen).
    canvas.fire('mousedown', { button: 0, clientX: 500, clientY: 300 });
    canvas.fire('mousemove', { clientX: 800, clientY: 560 });
    fireWindow('mouseup', { button: 0, clientX: 800, clientY: 560 });
    pumpFrames(5);

    // Right-click order somewhere on the map.
    canvas.fire('contextmenu', { clientX: 700, clientY: 420 });
    pumpFrames(20);

    // Keyboard: pause/unpause, speed toggle, scroll, control group, escape.
    fireWindow('keydown', { key: ' ' });
    pumpFrames(3);
    fireWindow('keydown', { key: ' ' });
    fireWindow('keydown', { key: 'f' });
    fireWindow('keydown', { key: 'ArrowRight' });
    pumpFrames(10);
    fireWindow('keyup', { key: 'ArrowRight' });
    fireWindow('keydown', { key: '1', ctrlKey: true });
    fireWindow('keydown', { key: '1', ctrlKey: false });
    fireWindow('keydown', { key: 'Escape' });

    // Minimap click jumps the camera.
    canvas.fire('mousedown', { button: 0, clientX: 20, clientY: 700 });
    fireWindow('mouseup', { button: 0, clientX: 20, clientY: 700 });
    pumpFrames(30);

    expect(session.state.result).toBe('playing');
    expect(result).toBeNull();
    expect(session.state.units.length).toBeGreaterThan(0);
    session.dispose();
  });
});
