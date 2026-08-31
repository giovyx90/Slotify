// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { MARKER_ARM, calibrationSheet, guiScale, sheetToWindow, solveTitleOrigin } from "./calibrate";
import { chestProfile } from "./containers";
import { SHEET_TO_WINDOW_Y, TITLE_X, WINDOW_W, windowHeight } from "./geometry";
import { alphaAt } from "./raster";

describe("calibrationSheet", () => {
  it("draws a cross whose centre is the only pixel on both arms", () => {
    const sheet = calibrationSheet(100, 60);
    expect(alphaAt(sheet, 100, 60)).toBe(255);
    expect(alphaAt(sheet, 100 + MARKER_ARM, 60)).toBe(255);
    expect(alphaAt(sheet, 100, 60 + MARKER_ARM)).toBe(255);
    expect(alphaAt(sheet, 100 + MARKER_ARM + 1, 60)).toBe(0);
    expect(alphaAt(sheet, 101, 61)).toBe(0);
  });

  it("refuses a marker whose arms would fall off the sheet", () => {
    expect(() => calibrationSheet(2, 60)).toThrow();
    expect(() => calibrationSheet(100, 254)).toThrow();
  });
});

describe("guiScale", () => {
  it("takes only whole scales that both dimensions agree on", () => {
    expect(guiScale({ x: 0, y: 0, w: 352, h: 444 }, 176, 222)).toBe(2);
    expect(guiScale({ x: 0, y: 0, w: 176, h: 222 }, 176, 222)).toBe(1);
    // A rectangle dragged one pixel wide of the window: refused, not rounded.
    expect(guiScale({ x: 0, y: 0, w: 353, h: 444 }, 176, 222)).toBeNull();
    expect(guiScale({ x: 0, y: 0, w: 352, h: 666 }, 176, 222)).toBeNull();
  });
});

describe("solveTitleOrigin", () => {
  const chest = chestProfile(6);

  /** A screenshot of the chest, at `scale`, with the window's corner at (ox, oy). */
  const shot = (scale: number, ox: number, oy: number, marker: { x: number; y: number }, ascent: number) => {
    const where = sheetToWindow(chest.titleOrigin!, ascent, 0, marker.x, marker.y);
    return {
      marker,
      ascent,
      window: { w: WINDOW_W, h: windowHeight(6) },
      windowRect: { x: ox, y: oy, w: WINDOW_W * scale, h: windowHeight(6) * scale },
      markerAt: { x: ox + where.x * scale, y: oy + where.y * scale },
    };
  };

  it("recovers the chest's own origin from a synthetic screenshot", () => {
    // The chest is the one screen already measured, so a solver that cannot rediscover
    // its numbers cannot be trusted with a screen nobody has measured.
    for (const scale of [1, 2, 3, 4]) {
      for (const ascent of [13, 49, 96]) {
        const result = solveTitleOrigin(shot(scale, 640, 300, { x: 40, y: 120 }, ascent));
        expect(result).toEqual({
          ok: true,
          scale,
          origin: { x: TITLE_X, k: SHEET_TO_WINDOW_Y },
        });
      }
    }
  });

  it("does not care where the window sits on screen", () => {
    const a = solveTitleOrigin(shot(3, 0, 0, { x: 12, y: 200 }, 49));
    const b = solveTitleOrigin(shot(3, 977, 41, { x: 12, y: 200 }, 49));
    expect(a).toEqual(b);
  });

  it("refuses a window rectangle that is not a whole multiple", () => {
    const input = shot(2, 100, 100, { x: 40, y: 120 }, 13);
    input.windowRect.w += 3;
    const result = solveTitleOrigin(input);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("not a whole multiple");
  });

  it("refuses a marker clicked between pixels rather than rounding it", () => {
    const input = shot(4, 100, 100, { x: 40, y: 120 }, 13);
    input.markerAt.x += 2;
    const result = solveTitleOrigin(input);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("centre pixel");
  });
});

describe("sheetToWindow", () => {
  it("is the exporter's arithmetic, run forwards", () => {
    const origin = { x: TITLE_X, k: SHEET_TO_WINDOW_Y };
    // With ascent 13 the sheet and the window share a vertical origin, which is what
    // `newProject` relies on; the -8 shift is what pulls column 0 to the window's edge.
    expect(sheetToWindow(origin, 13, -8, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(sheetToWindow(origin, 49, -8, 0, 49)).toEqual({ x: 0, y: 13 });
  });
});
