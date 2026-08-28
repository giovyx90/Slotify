// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  advanceOf,
  impliedAscent,
  makeRaster,
  rightmostOpaqueColumn,
  stripIsolated,
  type Raster,
} from "./raster";

function setPixel(raster: Raster, x: number, y: number, rgba: [number, number, number, number]): void {
  raster.data.set(rgba, (y * raster.width + x) * 4);
}

describe("advanceOf", () => {
  it("is the rightmost opaque column plus two", () => {
    // The RobberyGlyphs calibration: last opaque pixel at column 175 -> advance 177.
    const raster = makeRaster(256, 256);
    setPixel(raster, 175, 40, [10, 10, 10, 255]);
    expect(advanceOf(raster)).toBe(177);
  });

  it("is zero on a fully transparent sheet", () => {
    expect(advanceOf(makeRaster(256, 256))).toBe(0);
    expect(rightmostOpaqueColumn(makeRaster(16, 16))).toBe(-1);
  });

  it("counts any non-zero alpha as opaque", () => {
    const raster = makeRaster(64, 64);
    setPixel(raster, 30, 5, [0, 0, 0, 1]);
    expect(advanceOf(raster)).toBe(32);
  });
});

describe("stripIsolated", () => {
  it("removes the stray pixel that would wreck the advance", () => {
    const raster = makeRaster(256, 256);
    // A solid 10x10 block of artwork...
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setPixel(raster, x, y, [50, 50, 50, 255]);
    // ...and one slip of the pen far to the right, like the three delivered locker sheets.
    setPixel(raster, 245, 100, [50, 50, 50, 255]);

    expect(advanceOf(raster)).toBe(247);
    expect(stripIsolated(raster)).toBe(1);
    expect(advanceOf(raster)).toBe(11);
  });

  it("removes a lone pair too — each has only one neighbour", () => {
    const raster = makeRaster(32, 32);
    setPixel(raster, 5, 5, [1, 1, 1, 255]);
    setPixel(raster, 6, 5, [1, 1, 1, 255]);
    expect(stripIsolated(raster)).toBe(2);
  });

  it("keeps a 2x2 block — three neighbours each", () => {
    const raster = makeRaster(32, 32);
    for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]] as const) {
      setPixel(raster, x, y, [1, 1, 1, 255]);
    }
    expect(stripIsolated(raster)).toBe(0);
  });

  it("counts neighbours against the pre-pass image, like the Python original", () => {
    // A diagonal line: every pixel has exactly 2 neighbours except the two ends (1 each).
    // A fixpoint erosion would eat the whole line end-in; the single pass removes only the ends.
    const raster = makeRaster(32, 32);
    for (let i = 0; i < 8; i++) setPixel(raster, 4 + i, 4 + i, [9, 9, 9, 255]);
    expect(stripIsolated(raster)).toBe(2);
  });
});

describe("impliedAscent", () => {
  function sheetWithCell(ascent: number, containerRow: number, column = 2): Raster {
    const raster = makeRaster(256, 256);
    const x0 = 8 + 18 * column;
    const y = ascent + 5 + 18 * containerRow; // first interior row

    for (let x = x0; x < x0 + 16; x++) {
      setPixel(raster, x, y - 1, [55, 55, 55, 255]); // bevel
      for (let dy = 0; dy < 16; dy++) setPixel(raster, x, y + dy, [120, 90 + dy, 60, 255]); // any fill
      setPixel(raster, x, y + 16, [255, 255, 255, 255]); // highlight
    }
    return raster;
  }

  it("derives the ascent from a drawn cell (round-trip with the formula)", () => {
    for (const [ascent, row] of [
      [26, 0],
      [27, 1],
      [29, 0],
      [16, 2],
    ] as const) {
      expect(impliedAscent(sheetWithCell(ascent, row), row)).toBe(ascent);
    }
  });

  it("is colour-blind about the interior — gradients are legal fills", () => {
    expect(impliedAscent(sheetWithCell(28, 0), 0)).toBe(28);
  });

  it("returns null when no full cell structure exists", () => {
    const raster = makeRaster(256, 256);
    // A dark underline that is not 16 wide at a cell column.
    for (let x = 8; x < 18; x++) setPixel(raster, x, 30, [55, 55, 55, 255]);
    expect(impliedAscent(raster, 0)).toBeNull();
  });
});
