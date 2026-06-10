import type { Vec2 } from "../core/vec.js";

export enum FogState {
  Unexplored = 0,
  Explored = 1,
  Visible = 2,
}

/**
 * Per-faction fog of war. Three states per tile. Recomputed each tick: all
 * currently-visible tiles decay to explored, then sight discs of friendly
 * entities re-light tiles to visible.
 */
export class FogMap {
  readonly width: number;
  readonly height: number;
  readonly state: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.state = new Uint8Array(width * height).fill(FogState.Unexplored);
  }

  at(x: number, y: number): FogState {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return FogState.Unexplored;
    return this.state[y * this.width + x] as FogState;
  }

  isVisible(x: number, y: number): boolean {
    return this.at(x, y) === FogState.Visible;
  }

  isExplored(x: number, y: number): boolean {
    return this.at(x, y) !== FogState.Unexplored;
  }

  /** Decay visible -> explored before re-lighting. */
  beginFrame(): void {
    const s = this.state;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === FogState.Visible) s[i] = FogState.Explored;
    }
  }

  /** Light a sight disc around a friendly entity. */
  reveal(center: Vec2, sight: number): void {
    const r = sight;
    const r2 = r * r;
    const minX = Math.max(0, Math.floor(center.x - r));
    const maxX = Math.min(this.width - 1, Math.ceil(center.x + r));
    const minY = Math.max(0, Math.floor(center.y - r));
    const maxY = Math.min(this.height - 1, Math.ceil(center.y + r));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        if (dx * dx + dy * dy <= r2) {
          this.state[y * this.width + x] = FogState.Visible;
        }
      }
    }
  }

  revealAll(): void {
    this.state.fill(FogState.Visible);
  }
}
