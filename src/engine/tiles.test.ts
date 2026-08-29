// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { PANEL, VANILLA_BEVELS, type RGBA } from "./paint";
import { makeRaster, type Raster } from "./raster";
import { drawTileRegion, TILE, TILE_X0, TILE_Y0, type TileCell } from "./tiles";

/**
 * The merged region has to read as one plate. It is drawn cell by cell, so every rule
 * written for a single plate has to be asked "and what about the seam?" — these pin the
 * answer, because the failure is a one-pixel hole nobody notices until a wide button
 * looks like three narrow ones.
 */

const LIGHT = 255;
const DARK = 85;
const FILL = 198;

function drawn(cells: TileCell[]): Raster {
  const raster = makeRaster(120, 120);
  drawTileRegion(raster, cells, PANEL as RGBA, VANILLA_BEVELS, false, 0);
  return raster;
}

const channelAt = (raster: Raster, x: number, y: number): number =>
  raster.data[(y * raster.width + x) * 4]!;

describe("a merged region's outline", () => {
  it("keeps the top highlight unbroken across every seam", () => {
    const raster = drawn([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    // Every pixel of the top edge is light, except the last one, which the dark edge
    // takes the way it does on a single plate.
    for (let x = TILE_X0; x < TILE_X0 + TILE * 3 - 1; x++) {
      expect(channelAt(raster, x, TILE_Y0), `x=${x}`).toBe(LIGHT);
    }
    expect(channelAt(raster, TILE_X0 + TILE * 3 - 1, TILE_Y0)).toBe(DARK);
  });

  it("keeps the left highlight unbroken down every seam", () => {
    const raster = drawn([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    for (let y = TILE_Y0; y < TILE_Y0 + TILE * 3 - 1; y++) {
      expect(channelAt(raster, TILE_X0, y), `y=${y}`).toBe(LIGHT);
    }
    expect(channelAt(raster, TILE_X0, TILE_Y0 + TILE * 3 - 1)).toBe(DARK);
  });

  it("leaves the interior of a block flat, with no seam showing", () => {
    const cells: TileCell[] = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) cells.push([row, col]);
    const raster = drawn(cells);

    // One pixel in from every edge of the 3x3 block: nothing but fill.
    for (let y = TILE_Y0 + 1; y < TILE_Y0 + TILE * 3 - 1; y++) {
      for (let x = TILE_X0 + 1; x < TILE_X0 + TILE * 3 - 1; x++) {
        expect(channelAt(raster, x, y), `${x},${y}`).toBe(FILL);
      }
    }
  });

  it("still ends an L-shaped region cleanly where it actually ends", () => {
    // Two cells across, one hanging below the left one: the highlight must break where
    // the region genuinely stops, and only there.
    const raster = drawn([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(channelAt(raster, TILE_X0, TILE_Y0)).toBe(LIGHT);
    // The right end of the top run takes its dark corner.
    expect(channelAt(raster, TILE_X0 + TILE * 2 - 1, TILE_Y0)).toBe(DARK);
    // The left edge runs on into the second row rather than stopping at the seam.
    expect(channelAt(raster, TILE_X0, TILE_Y0 + TILE)).toBe(LIGHT);
  });

  it("draws a lone cell exactly as a single plate", () => {
    const raster = drawn([[0, 0]]);
    expect(channelAt(raster, TILE_X0, TILE_Y0)).toBe(LIGHT);
    expect(channelAt(raster, TILE_X0 + TILE - 1, TILE_Y0)).toBe(DARK);
    expect(channelAt(raster, TILE_X0, TILE_Y0 + TILE - 1)).toBe(DARK);
  });
});
