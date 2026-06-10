import type { GameSession } from "../game/session.js";

/**
 * Binds DOM pointer/keyboard events on the canvas and forwards them to the
 * active {@link GameSession}. Holds no game logic of its own.
 */
export class InputController {
  private leftDown = false;
  private readonly onContext = (e: Event): void => e.preventDefault();
  private readonly onDown: (e: MouseEvent) => void;
  private readonly onMove: (e: MouseEvent) => void;
  private readonly onUp: (e: MouseEvent) => void;
  private readonly onLeave: () => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    session: GameSession,
  ) {
    const local = (e: MouseEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    this.onDown = (e) => {
      const { x, y } = local(e);
      if (e.button === 0) {
        this.leftDown = true;
        session.onLeftDown(x, y, e.shiftKey);
      } else if (e.button === 2) {
        session.onRightDown(x, y);
      }
    };
    this.onMove = (e) => {
      const { x, y } = local(e);
      session.onMouseMove(x, y, this.leftDown);
    };
    this.onUp = (e) => {
      const { x, y } = local(e);
      if (e.button === 0) {
        this.leftDown = false;
        session.onLeftUp(x, y, e.shiftKey);
      }
    };
    this.onLeave = () => {
      this.leftDown = false;
      session.setMouseInactive();
    };
    this.onKeyDown = (e) => {
      const k = e.key;
      if (k === " " || k.startsWith("Arrow")) e.preventDefault();
      session.onKeyDown(k, e.ctrlKey || e.metaKey);
    };
    this.onKeyUp = (e) => session.onKeyUp(e.key);

    canvas.addEventListener("contextmenu", this.onContext);
    canvas.addEventListener("mousedown", this.onDown);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseup", this.onUp);
    canvas.addEventListener("mouseleave", this.onLeave);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach(): void {
    this.canvas.removeEventListener("contextmenu", this.onContext);
    this.canvas.removeEventListener("mousedown", this.onDown);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    this.canvas.removeEventListener("mouseleave", this.onLeave);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
