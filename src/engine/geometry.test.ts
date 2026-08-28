// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { renderWindow } from "./chestRenderer";
import {
  ascentForCell,
  slotSheetRect,
  slotWindowRect,
  windowHeight,
} from "./geometry";
import { impliedAscent } from "./raster";

describe("windowHeight", () => {
  it("is 114 + 18N, matching the shipped 6-row screen at 222", () => {
    expect(windowHeight(6)).toBe(222);
    for (let rows = 1; rows <= 6; rows++) {
      expect(windowHeight(rows)).toBe(114 + 18 * rows);
    }
  });
});

describe("slot rectangles", () => {
  it("puts slot 0's item area at the canonical (8,18)", () => {
    expect(slotWindowRect(0, 0)).toEqual({ x: 8, y: 18, w: 16, h: 16 });
  });

  it("agrees with the sheet formula: sheet rect = window rect shifted by ascent − 13", () => {
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 9; col++) {
        for (const ascent of [16, 26, 29, 30]) {
          const window = slotWindowRect(row, col);
          const sheet = slotSheetRect(row, col, ascent);
          expect(sheet.x).toBe(window.x);
          expect(sheet.y).toBe(window.y + ascent - 13);
        }
      }
    }
  });

  it("round-trips through ascentForCell", () => {
    for (let row = 0; row < 6; row++) {
      for (const ascent of [14, 26, 27, 28, 29, 30]) {
        expect(ascentForCell(slotSheetRect(row, 0, ascent).y, row)).toBe(ascent);
      }
    }
  });
});

describe("renderWindow", () => {
  it("draws slots that impliedAscent recognises, implying the calibration constant 13", () => {
    // A sheet whose artwork starts exactly at the window origin needs ascent 13
    // (windowY = sheetY − 13 + 13). The rendered window, read back as if it were a
    // sheet, must therefore imply 13 — this ties renderer, detector and the server's
    // measured constant together in one assertion.
    for (let rows = 1; rows <= 6; rows++) {
      expect(impliedAscent(renderWindow({ rows }), 0)).toBe(13);
    }
  });

  it("hides the viewer inventory when asked, as PaintedInventoryHook does", () => {
    const shown = renderWindow({ rows: 3 });
    const hidden = renderWindow({ rows: 3, hideViewerInventory: true });
    expect(hidden.data).not.toEqual(shown.data);
    // The container rows themselves are identical.
    const rowBytes = 176 * 4;
    const upTo = (18 + 3 * 18) * rowBytes;
    expect(hidden.data.slice(0, upTo)).toEqual(shown.data.slice(0, upTo));
  });
});
