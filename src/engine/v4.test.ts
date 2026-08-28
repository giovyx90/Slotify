// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { regionKeyAt, regionRect } from "./carve";
import { renderWindow } from "./chestRenderer";
import { buildMono5Font } from "./mono5";
import { cropToOpaque, drawNinepatch } from "./ninepatch";
import { hueShiftedBevels, rgbToHsl, PANEL, WELL_FILL } from "./paint";
import { newProject } from "./project";
import { alphaAt, makeRaster, type Raster } from "./raster";
import { renderSheet } from "./renderProject";
import { drawTileRegion, regionBBox, cellAt, tileRect } from "./tiles";
import { advanceOfGlyph, hexToRgb, renderTextShadowed, shadowOf } from "./textFont";

function rgbAt(raster: Raster, x: number, y: number): [number, number, number] {
  const index = (y * raster.width + x) * 4;
  return [raster.data[index]!, raster.data[index + 1]!, raster.data[index + 2]!];
}

function pixel(raster: Raster, x: number, y: number, rgba: [number, number, number, number]): void {
  raster.data.set(rgba, (y * raster.width + x) * 4);
}

describe("mono 5x5 font", () => {
  const font = buildMono5Font();

  it("is strictly monospace — the space included", () => {
    for (const char of "AZ09.?# ") {
      expect(advanceOfGlyph(font.glyphs.get(char.codePointAt(0)!)), char).toBe(6);
    }
  });

  it("maps lowercase onto the uppercase art", () => {
    expect(font.glyphs.get(0x61)).toBe(font.glyphs.get(0x41));
  });
});

describe("hue-shifted bevels", () => {
  it("shifts a saturated fill's highlight toward yellow and its shadow toward violet", () => {
    const green: [number, number, number, number] = [60, 160, 60, 255];
    const bevels = hueShiftedBevels(green);
    const hueOf = (rgba: number[]) => rgbToHsl(rgba[0]!, rgba[1]!, rgba[2]!)[0];
    const base = hueOf([...green]);

    expect(hueOf([...bevels.light])).toBeLessThan(base); // toward 60°
    expect(hueOf([...bevels.dark])).toBeGreaterThan(base); // toward 250°
    // Never plain white or black.
    expect(bevels.light.slice(0, 3)).not.toEqual([255, 255, 255]);
    expect(bevels.dark.slice(0, 3)).not.toEqual([0, 0, 0]);
  });

  it("degrades to a plain grey ramp on a grey fill", () => {
    const bevels = hueShiftedBevels(PANEL);
    expect(bevels.light[0]).toBe(bevels.light[1]);
    expect(bevels.light[0]).toBeGreaterThan(PANEL[0]);
    expect(bevels.dark[0]).toBeLessThan(PANEL[0]);
  });
});

describe("text shadows", () => {
  it("quarters the colour and offsets it in the chosen direction", () => {
    const font = buildMono5Font();
    expect(shadowOf([200, 100, 40])).toEqual([50, 25, 10]);

    const plain = renderTextShadowed(font, "I", { color: hexToRgb("#FFFFFF") }, "none");
    const shadowed = renderTextShadowed(font, "I", { color: hexToRgb("#FFFFFF") }, "below-right");
    expect(shadowed.width).toBe(plain.width + 1);
    expect(shadowed.height).toBe(plain.height + 1);
    // The I's top-centre pixel: body at (2,0), its shadow at (3,1).
    expect(rgbAt(shadowed, 2, 0)).toEqual([255, 255, 255]);
    expect(rgbAt(shadowed, 3, 1)).toEqual([63, 63, 63]);
  });
});

describe("connectable tiles", () => {
  it("maps window pixels to lattice cells sharing the slot borders", () => {
    expect(cellAt(8, 18)).toEqual([0, 0]); // slot 0 interior
    expect(cellAt(7 + 18, 17)).toEqual([0, 1]);
    expect(tileRect(0, 0)).toEqual({ x: 7, y: 17, w: 18, h: 18 });
    expect(regionBBox([[0, 0], [0, 1]])).toEqual({ x: 7, y: 17, w: 36, h: 18 });
  });

  it("bevels the merged outline, not the shared edge — two cells read as one button", () => {
    const raster = makeRaster(64, 64);
    const bevels = hueShiftedBevels([120, 80, 200, 255]);
    drawTileRegion(raster, [[0, 0], [0, 1]], [120, 80, 200, 255], bevels, false);

    // The shared border column between the two cells (x=24/25) is fill, not bevel.
    expect(rgbAt(raster, 24, 26)).toEqual([120, 80, 200]);
    expect(rgbAt(raster, 25, 26)).toEqual([120, 80, 200]);
    // The region's own outline is bevelled: light top, dark bottom, dark right end.
    expect(rgbAt(raster, 10, 17)).toEqual(bevels.light.slice(0, 3));
    expect(rgbAt(raster, 10, 34)).toEqual(bevels.dark.slice(0, 3));
    expect(rgbAt(raster, 7 + 36 - 1, 26)).toEqual(bevels.dark.slice(0, 3));
  });

  it("renders tile infoboxes over the region box with the skin", () => {
    // A 6×6 skin with unmistakable corners.
    const skin = makeRaster(6, 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) pixel(skin, x, y, [10, 10, 10, 255]);
    pixel(skin, 0, 0, [255, 0, 0, 255]);
    pixel(skin, 5, 0, [0, 255, 0, 255]);
    pixel(skin, 0, 5, [0, 0, 255, 255]);
    pixel(skin, 5, 5, [255, 255, 0, 255]);

    const project = newProject("m", "k", "U+E8F0");
    project.elements.push({
      id: "t", kind: "tiles", tileKind: "infobox", cells: [[0, 0], [0, 1], [1, 0], [1, 1]],
      x: 7, y: 17, w: 36, h: 36, lines: [],
    });
    const sheet = renderSheet(project, undefined, { infoboxSkin: { raster: skin, border: 2 } });

    expect(rgbAt(sheet, 7, 17 + 13 - 13)).toEqual([255, 0, 0]); // wait: ascent 13 ⇒ dy 0
    expect(rgbAt(sheet, 7 + 35, 17)).toEqual([0, 255, 0]);
    expect(rgbAt(sheet, 7, 17 + 35)).toEqual([0, 0, 255]);
    expect(rgbAt(sheet, 7 + 35, 17 + 35)).toEqual([255, 255, 0]);
  });
});

describe("ninepatch", () => {
  it("crops to the opaque box", () => {
    const source = makeRaster(10, 10);
    pixel(source, 3, 4, [9, 9, 9, 255]);
    pixel(source, 6, 7, [9, 9, 9, 255]);
    const cropped = cropToOpaque(source);
    expect(cropped.width).toBe(4);
    expect(cropped.height).toBe(4);
    expect(rgbAt(cropped, 0, 0)).toEqual([9, 9, 9]);
  });
});

describe("carved holes", () => {
  it("maps every window pixel to exactly one region", () => {
    // rows=6: container rows at y 17..124, gap, inv rows, hotbar band.
    expect(regionKeyAt(10, 20, 6)).toBe("con:0:0");
    expect(regionKeyAt(3, 20, 6)).toBe("con:0:-1"); // left margin
    expect(regionKeyAt(100, 5, 6)).toBe("top:0:5");
    expect(regionKeyAt(100, 130, 6)).toBe("gap:0:5");
    expect(regionKeyAt(100, 145, 6)).toBe("inv:0:5");
    expect(regionKeyAt(100, 200, 6)).toBe("hot:0:5");
    expect(regionKeyAt(-1, 20, 6)).toBeNull();
    expect(regionKeyAt(0, 300, 6)).toBeNull();
  });

  it("frames holes outside the grid, and leaves grid holes to the slots' own rings", () => {
    const carved = renderWindow({ rows: 2, holes: new Set(["top:0:2", "con:0:0"]) });

    // The top-band hole: transparent, and the window contour redraws under it.
    expect(alphaAt(carved, 50, 8)).toBe(0);
    expect(rgbAt(carved, 50, 17)).toEqual([55, 55, 55]); // closed border below the void

    // The slot-cell hole: transparent, but NXMenu-clean — no extra frame. The left
    // margin beside it stays flat panel…
    const region = regionRect("con:0:0", 2);
    expect(alphaAt(carved, region.x + 9, region.y + 9)).toBe(0);
    expect(rgbAt(carved, 5, region.y + 9)).toEqual([198, 198, 198]);
    // …and the neighbouring slot closes itself with its own ring.
    expect(rgbAt(carved, region.x + region.w, region.y + 9)).toEqual([55, 55, 55]);

    // The window's own outer corner is still an edge.
    expect(rgbAt(carved, 0, 0)).toEqual([55, 55, 55]);
  });

  it("bakes the carved window into the sheet when bakeWindow is on", () => {
    const project = newProject("m", "k", "U+E8F0");
    project.rows = 2;
    project.holes = ["top:0:0"];
    const sheet = renderSheet(project); // ascent 13 ⇒ window at sheet (0,0)
    expect(alphaAt(sheet, 10, 5)).toBe(0); // carved top band cell
    expect(rgbAt(sheet, 100, 5)).not.toEqual([0, 0, 0]); // rest of the band survives
    expect(rgbAt(sheet, 10, 20)).toEqual(WELL_FILL.slice(0, 3)); // slot 0 well intact
  });
});

describe("removable slots", () => {
  it("skips hidden container and inventory wells", () => {
    const full = renderWindow({ rows: 2 });
    const holed = renderWindow({
      rows: 2,
      hiddenContainerSlots: new Set([0]),
      hiddenInvSlots: new Set([27]), // first hotbar slot
    });

    // Slot 0's well interior: grey well on the full window, plain panel on the holed one.
    expect(rgbAt(full, 10, 20)).toEqual(WELL_FILL.slice(0, 3));
    expect(rgbAt(holed, 10, 20)).toEqual(PANEL.slice(0, 3));
    // And its neighbour keeps its own bevel — the contour redraws itself.
    expect(rgbAt(holed, 8 + 18, 20)).toEqual(WELL_FILL.slice(0, 3));
    expect(alphaAt(holed, 0, 0)).toBe(255);
  });
});
