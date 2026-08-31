// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { calibrationSheet } from "./calibrate";
import { renderWindow } from "./chestRenderer";
import { chestProfile } from "./containers";
import { blit, makeRaster, type Raster } from "./raster";
import { put } from "./paint";
import { calibrateFromScreenshot, detectScaledWells, findMarkerClusters, locateWindow, upscale } from "./screenshot";

const chest = chestProfile(6);

/**
 * A screenshot of the chest as the client would draw it: the window magnified by whole
 * pixels onto a dark background, with the calibration sheet's marker composited where the
 * chest's own title origin (x=8, k=13) puts it.
 */
function fakeScreenshot(scale: number, ox: number, oy: number, marker: { x: number; y: number }, ascent: number): Raster {
  const shot = makeRaster(ox + chest.windowW * scale + 200, oy + chest.windowH * scale + 200);
  for (let i = 0; i < shot.width * shot.height; i++) {
    shot.data.set([24, 24, 28, 255], i * 4);
  }

  blit(shot, upscale(renderWindow({ rows: 6 }), scale), ox, oy);

  // Where the client puts sheet pixel (sx, sy): window x = 8 + 0 + sx (no spacer run),
  // window y = sy - ascent + 13.
  const sheet = calibrationSheet(marker.x, marker.y);
  for (let sy = 0; sy < sheet.height; sy++) {
    for (let sx = 0; sx < sheet.width; sx++) {
      if (sheet.data[(sy * sheet.width + sx) * 4 + 3] === 0) continue;
      const wx = chest.titleOrigin!.x + sx;
      const wy = sy - ascent + chest.titleOrigin!.k;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          put(shot, ox + wx * scale + dx, oy + wy * scale + dy, [255, 0, 255, 255]);
        }
      }
    }
  }

  return shot;
}

describe("detectScaledWells", () => {
  it("finds the same 90 wells however big the client drew them", () => {
    for (const scale of [1, 2, 3]) {
      const wells = detectScaledWells(upscale(renderWindow({ rows: 6 }), scale), scale);
      expect(wells, `scale ${scale}`).toHaveLength(54 + 36);
    }
  });
});

describe("locateWindow", () => {
  it("finds the window's corner and the GUI scale, wherever it sits", () => {
    for (const scale of [1, 2, 3, 4]) {
      const shot = fakeScreenshot(scale, 311, 97, { x: 60, y: 30 }, 13);
      const found = locateWindow(shot, chest);
      expect(found, `scale ${scale}`).toMatchObject({ x: 311, y: 97, scale });
      expect(found!.votes).toBeGreaterThanOrEqual(54);
    }
  });

  it("is not fooled by items sitting in some of the slots", () => {
    const shot = fakeScreenshot(3, 200, 120, { x: 60, y: 30 }, 13);
    // Scribble over twelve wells, the way a chest with things in it looks.
    for (let n = 0; n < 12; n++) {
      const slot = chest.slots[n]!;
      for (let y = 0; y < 16 * 3; y++) {
        for (let x = 0; x < 16 * 3; x++) {
          put(shot, 200 + slot.x * 3 + x, 120 + slot.y * 3 + y, [180, 60, 40, 255]);
        }
      }
    }
    expect(locateWindow(shot, chest)).toMatchObject({ x: 200, y: 120, scale: 3 });
  });

  it("says nothing rather than guessing when the screen has no slot grid", () => {
    const blank = makeRaster(400, 300);
    expect(locateWindow(blank, chest)).toBeNull();
  });
});

describe("findMarkerClusters", () => {
  it("boxes the cross and nothing else", () => {
    const shot = fakeScreenshot(2, 40, 40, { x: 60, y: 30 }, 13);
    const clusters = findMarkerClusters(shot);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.w).toBe(9 * 2);
    expect(clusters[0]!.h).toBe(9 * 2);
  });
});

describe("calibrateFromScreenshot", () => {
  it("recovers the chest's own title origin from a dropped image, with nothing typed", () => {
    for (const scale of [1, 2, 3, 4]) {
      for (const ascent of [13, 49]) {
        const marker = { x: 60, y: 30 + ascent };
        const shot = fakeScreenshot(scale, 271, 63, marker, ascent);
        const result = calibrateFromScreenshot(shot, chest, marker, ascent);
        expect(result.ok, `scale ${scale} ascent ${ascent}`).toBe(true);
        expect(result.ok && result.origin).toEqual({ x: 8, k: 13 });
        expect(result.ok && result.scale).toBe(scale);
      }
    }
  });

  it("names the missing piece when the marker is not on screen", () => {
    const shot = fakeScreenshot(2, 60, 60, { x: 60, y: 30 }, 13);
    for (let i = 0; i < shot.width * shot.height; i++) {
      if (shot.data[i * 4] === 255 && shot.data[i * 4 + 1] === 0) shot.data.set([24, 24, 28, 255], i * 4);
    }
    const result = calibrateFromScreenshot(shot, chest, { x: 60, y: 30 }, 13);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("no marker");
  });

  it("names the missing piece when the window is not on screen", () => {
    const blank = makeRaster(600, 400);
    const result = calibrateFromScreenshot(blank, chest, { x: 60, y: 30 }, 13);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain("no slot grid");
  });
});
