// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  blankLayer,
  decodeLayer,
  ditherPoints,
  ellipsePoints,
  encodeLayer,
  fillAll,
  floodFill,
  isCorner,
  line,
  mirrored,
  pixelAt,
  rectanglePoints,
  replaceColour,
  setPixel,
  stamp,
} from "./paintLayer";
import type { RGBA } from "./paint";
import { newProject, type Project } from "./project";
import { bakeSheet } from "./renderProject";

const RED: RGBA = [217, 38, 50, 255];
const BLUE: RGBA = [37, 112, 212, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

describe("storage", () => {
  it("round-trips a painted layer through the project file", () => {
    const raster = blankLayer(8, 8);
    setPixel(raster, 3, 4, RED);
    const restored = decodeLayer(encodeLayer(raster));
    expect(pixelAt(restored, 3, 4)).toEqual(RED);
    expect(pixelAt(restored, 0, 0)).toEqual(CLEAR);
  });

  it("keeps the layer's size", () => {
    const restored = decodeLayer(encodeLayer(blankLayer(176, 222)));
    expect([restored.width, restored.height]).toEqual([176, 222]);
  });

  it("hands back the same decode for the same pixels", () => {
    const text = encodeLayer(blankLayer(4, 4));
    expect(decodeLayer(text)).toBe(decodeLayer(text));
  });
});

describe("the nib", () => {
  it("stamps a square centred on the point", () => {
    const raster = blankLayer(8, 8);
    stamp(raster, 4, 4, 3, RED);
    expect(pixelAt(raster, 3, 3)).toEqual(RED);
    expect(pixelAt(raster, 5, 5)).toEqual(RED);
    expect(pixelAt(raster, 2, 4)).toEqual(CLEAR);
  });

  it("clips at the edges instead of wrapping", () => {
    const raster = blankLayer(4, 4);
    stamp(raster, 0, 0, 3, RED);
    expect(pixelAt(raster, 3, 3)).toEqual(CLEAR);
  });
});

describe("line", () => {
  it("leaves no gap on a fast diagonal drag", () => {
    const points = line({ x: 0, y: 0 }, { x: 5, y: 5 });
    expect(points).toHaveLength(6);
    for (let index = 1; index < points.length; index++) {
      const step = Math.max(
        Math.abs(points[index]!.x - points[index - 1]!.x),
        Math.abs(points[index]!.y - points[index - 1]!.y),
      );
      expect(step).toBe(1);
    }
  });

  it("returns the single point when nothing moved", () => {
    expect(line({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });
});

describe("pixel-perfect", () => {
  it("spots the knee of an L", () => {
    expect(isCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBe(true);
  });

  it("leaves a straight run alone", () => {
    expect(isCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(false);
  });
});

describe("mirror", () => {
  it("gives one twin per axis and four with both", () => {
    expect(mirrored({ x: 1, y: 2 }, 10, 10, true, false)).toEqual([
      { x: 1, y: 2 },
      { x: 8, y: 2 },
    ]);
    expect(mirrored({ x: 1, y: 2 }, 10, 10, true, true)).toHaveLength(4);
  });

  it("does not paint the centre line twice", () => {
    expect(mirrored({ x: 2, y: 0 }, 5, 5, true, false)).toHaveLength(1);
  });
});

describe("fill", () => {
  it("fills only the region it was asked about", () => {
    const raster = blankLayer(5, 1);
    setPixel(raster, 2, 0, BLUE);
    expect(floodFill(raster, 0, 0, RED)).toBe(2);
    expect(pixelAt(raster, 1, 0)).toEqual(RED);
    expect(pixelAt(raster, 3, 0)).toEqual(CLEAR);
  });

  it("refuses to walk forever filling with the colour already there", () => {
    const raster = blankLayer(4, 4);
    expect(floodFill(raster, 0, 0, CLEAR)).toBe(0);
  });

  it("ignores a point outside the layer", () => {
    expect(floodFill(blankLayer(4, 4), 9, 9, RED)).toBe(0);
  });
});

describe("replaceColour", () => {
  it("recolours every matching pixel and no others", () => {
    const raster = blankLayer(3, 1);
    setPixel(raster, 0, 0, RED);
    setPixel(raster, 1, 0, BLUE);
    setPixel(raster, 2, 0, RED);
    expect(replaceColour(raster, RED, BLUE)).toBe(2);
    expect(pixelAt(raster, 1, 0)).toEqual(BLUE);
  });
});

describe("shapes", () => {
  it("draws a rectangle outline one pixel thick", () => {
    expect(rectanglePoints({ x: 0, y: 0 }, { x: 3, y: 3 }, false)).toHaveLength(12);
  });

  it("fills the same rectangle solid", () => {
    expect(rectanglePoints({ x: 0, y: 0 }, { x: 3, y: 3 }, true)).toHaveLength(16);
  });

  it("draws an ellipse inside its box, never outside it", () => {
    const points = ellipsePoints({ x: 0, y: 0 }, { x: 10, y: 6 }, true);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(10);
      expect(point.y).toBeLessThanOrEqual(6);
    }
    expect(points.length).toBeGreaterThan(0);
  });

  it("gives an ellipse outline fewer pixels than the solid one", () => {
    const outline = ellipsePoints({ x: 0, y: 0 }, { x: 12, y: 12 }, false);
    const solid = ellipsePoints({ x: 0, y: 0 }, { x: 12, y: 12 }, true);
    expect(outline.length).toBeLessThan(solid.length);
  });

  it("dithers every other pixel", () => {
    expect(ditherPoints(rectanglePoints({ x: 0, y: 0 }, { x: 3, y: 3 }, true))).toHaveLength(8);
  });
});

describe("stray stripping and hand-painted art", () => {
  const painted = (strip: boolean | undefined): Project => {
    const project = newProject("m", "k", "U+E8F0");
    project.bakeWindow = false;
    project.stripStrays = strip;
    const layer = blankLayer(40, 40);
    // A short diagonal: every pixel but the two ends has two neighbours.
    for (const point of line({ x: 5, y: 5 }, { x: 12, y: 12 })) setPixel(layer, point.x, point.y, RED);
    project.elements.push({
      id: "p",
      kind: "paint",
      x: 10,
      y: 10,
      w: 40,
      h: 40,
      paint: encodeLayer(layer),
    });
    return project;
  };

  it("eats the ends of a hand-drawn line when left on", () => {
    expect(bakeSheet(painted(undefined)).straysRemoved).toBe(2);
  });

  it("keeps every painted pixel when turned off", () => {
    const baked = bakeSheet(painted(false));
    expect(baked.straysRemoved).toBe(0);
    // The element sits at window (10,10) and the line starts at layer (5,5); a new
    // project's ascent is 13, so sheet coordinates equal window ones.
    const index = (15 * baked.sheet.width + 15) * 4;
    expect(baked.sheet.data[index + 3]).toBe(255);
  });
});

describe("fillAll", () => {
  it("covers the layer, transparency included", () => {
    const raster = blankLayer(3, 2);
    expect(fillAll(raster, RED)).toBe(6);
    expect(pixelAt(raster, 0, 0)).toEqual(RED);
    expect(pixelAt(raster, 2, 1)).toEqual(RED);
  });

  it("can wipe a layer back to nothing", () => {
    const raster = blankLayer(2, 2);
    setPixel(raster, 1, 1, RED);
    fillAll(raster, CLEAR);
    expect(pixelAt(raster, 1, 1)).toEqual(CLEAR);
  });
});
