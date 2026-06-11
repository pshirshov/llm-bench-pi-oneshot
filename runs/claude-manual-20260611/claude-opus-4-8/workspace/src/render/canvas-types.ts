/**
 * Canvas context type alias for render modules.
 *
 * The DOM lib provides CanvasRenderingContext2D as a global interface.
 * In tests a minimal stub object satisfying the same shape is passed in.
 * We define a local interface here that covers the subset of the DOM API
 * used by the renderers, keeping the render modules testable without a
 * real browser context.
 */

/** Subset of CanvasRenderingContext2D used by the renderers. */
export interface CanvasCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;

  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  save(): void;
  restore(): void;
}
