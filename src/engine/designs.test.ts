// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { allDesigns, BUILT_IN_DESIGNS, cornerRadius, designById } from "./designs";
import { drawPlate, PANEL, VANILLA_BEVELS, rect } from "./paint";
import { newProject } from "./project";
import { alphaAt, makeRaster, type Raster } from "./raster";
import { renderSheet } from "./renderProject";

function rgbAt(raster: Raster, x: number, y: number): [number, number, number] {
  const index = (y * raster.width + x) * 4;
  return [raster.data[index]!, raster.data[index + 1]!, raster.data[index + 2]!];
}

describe("the design set", () => {
  it("answers to a built-in id and shrugs at an unknown one", () => {
    expect(designById("vanilla")?.name).toBe("Vanilla");
    expect(designById("no-such-design")).toBeUndefined();
    expect(designById(undefined)).toBeUndefined();
  });

  it("lets a pack shadow a built-in by id, and never lists one twice", () => {
    const packs = allDesigns([
      { kind: "recipe", id: "vanilla", name: "The pack's vanilla", bevel: "flat", corners: "cut" },
    ]);
    expect(packs.filter((design) => design.id === "vanilla")).toHaveLength(1);
    expect(packs[0]!.name).toBe("The pack's vanilla");
    expect(packs).toHaveLength(BUILT_IN_DESIGNS.length);
  });

  it("measures the bite each corner treatment takes", () => {
    expect(cornerRadius("square")).toBe(0);
    expect(cornerRadius("cut")).toBe(1);
    expect(cornerRadius("round")).toBe(2);
  });
});

describe("corner treatments", () => {
  /** A plate on a field of a known colour, so "what came back" is checkable. */
  function plate(radius: number, w = 20, h = 14): Raster {
    const raster = makeRaster(w + 4, h + 4);
    rect(raster, 0, 0, w + 4, h + 4, [10, 20, 30, 255]);
    const corners = radius === 0 ? "square" : radius === 1 ? "cut" : "round";
    drawPlate(raster, 2, 2, w, h, PANEL, VANILLA_BEVELS, false, "single", cornerRadius(corners));
    return raster;
  }

  it("leaves a square plate exactly as it always was", () => {
    const before = makeRaster(24, 18);
    rect(before, 0, 0, 24, 18, [10, 20, 30, 255]);
    drawPlate(before, 2, 2, 20, 14, PANEL, VANILLA_BEVELS, false, "single");
    expect([...plate(0).data]).toEqual([...before.data]);
  });

  it("gives a cut corner back to what was under it, not to transparency", () => {
    const cut = plate(1);
    // The corner pixel is the background again — the button was never there.
    expect(rgbAt(cut, 2, 2)).toEqual([10, 20, 30]);
    expect(alphaAt(cut, 2, 2)).toBe(255);
    // And the rim closes along the new diagonal.
    expect(rgbAt(cut, 3, 2)).toEqual([255, 255, 255]);
    expect(rgbAt(cut, 2, 3)).toEqual([255, 255, 255]);
  });

  it("takes three pixels per corner when rounded, and re-lights the diagonal", () => {
    const round = plate(2);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3]] as const) {
      expect(rgbAt(round, x, y), `${x},${y}`).toEqual([10, 20, 30]);
    }
    // dx + dy === 2 is the new edge: light at the top left, dark at the bottom right.
    expect(rgbAt(round, 4, 2)).toEqual([255, 255, 255]);
    expect(rgbAt(round, 3, 3)).toEqual([255, 255, 255]);
    expect(rgbAt(round, 19, 15)).toEqual([85, 85, 85]);
  });

  it("refuses to eat a plate smaller than the bite", () => {
    const tiny = makeRaster(8, 8);
    rect(tiny, 0, 0, 8, 8, [10, 20, 30, 255]);
    drawPlate(tiny, 2, 2, 3, 3, PANEL, VANILLA_BEVELS, false, "single", 2);
    // 3×3 cannot lose two pixels from every corner and still be a plate: it stays whole.
    expect(rgbAt(tiny, 2, 2)).toEqual([255, 255, 255]);
  });
});

describe("a design on a real element", () => {
  it("draws a named recipe, and an unknown id falls back to the plain plate", () => {
    const base = newProject("m", "k", "U+E8F0");
    base.rows = 3;
    base.elements = [{ id: "e1", kind: "button", x: 20, y: 20, w: 40, h: 18 }];

    const plain = renderSheet(base);

    const named = newProject("m", "k", "U+E8F0");
    named.rows = 3;
    named.elements = [{ id: "e1", kind: "button", x: 20, y: 20, w: 40, h: 18, design: "no-such-design" }];
    expect([...renderSheet(named).data]).toEqual([...plain.data]);

    const rounded = newProject("m", "k", "U+E8F0");
    rounded.rows = 3;
    // No window baked underneath, so a corner given back is given back to nothing.
    rounded.bakeWindow = false;
    rounded.elements = [{ id: "e1", kind: "button", x: 20, y: 20, w: 40, h: 18, design: "round" }];
    const sheet = renderSheet(rounded);
    // ascent 13 puts window y on sheet y, so the button's own corner is at (20, 20).
    expect(alphaAt(sheet, 20, 20)).toBe(0);
    expect(rgbAt(sheet, 22, 20)).toEqual([255, 255, 255]);
  });
});
