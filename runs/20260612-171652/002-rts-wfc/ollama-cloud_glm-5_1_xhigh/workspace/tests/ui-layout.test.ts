/** UI layout tests. */

import { describe, it, expect } from "vitest";
import { computeLayout, hitTest, validateLayout } from "../src/ui/layout";

describe("UI layout", () => {
  const sizes = [
    [1280, 720] as const,
    [1920, 1080] as const,
  ];

  for (const [w, h] of sizes) {
    describe(`${w}x${h}`, () => {
      it("all interactive elements are inside viewport", () => {
        const layout = computeLayout(w, h);
        const errors = validateLayout(layout, w, h);
        expect(errors).toHaveLength(0);
      });

      it("minimap and selection panel do not overlap resource bar", () => {
        const layout = computeLayout(w, h);
        // Minimap should not overlap resource bar
        expect(layout.minimap.y).toBeGreaterThanOrEqual(layout.resourceBar.h);
        // Selection panel should not overlap resource bar
        expect(layout.selectionPanel.y).toBeGreaterThanOrEqual(layout.resourceBar.h);
      });

      it("hit-test returns correct element at center of each interactive area", () => {
        const layout = computeLayout(w, h);
        // Minimap center
        const mm = hitTest(
          layout.minimap.x + layout.minimap.w / 2,
          layout.minimap.y + layout.minimap.h / 2,
          layout, []
        );
        expect(mm.type).toBe("minimap");

        // Speed button center
        const sb = hitTest(
          layout.speedButton.x + layout.speedButton.w / 2,
          layout.speedButton.y + layout.speedButton.h / 2,
          layout, []
        );
        expect(sb.type).toBe("speed_button");

        // Game area center
        const ga = hitTest(w / 2, h / 2, layout, []);
        expect(ga.type).toBe("game_area");
      });

      it("no sibling interactive rectangles overlap", () => {
        const layout = computeLayout(w, h);
        const rects = [
          layout.minimap,
          layout.selectionPanel,
          layout.speedButton,
          layout.pauseButton,
        ];
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            // Check no overlap
            const overlaps = a.x < b.x + b.w && a.x + a.w > b.x &&
              a.y < b.y + b.h && a.y + a.h > b.y;
            expect(overlaps).toBe(false);
          }
        }
      });
    });
  }
});