// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  extractPalette,
  findSwatch,
  freeSwatchId,
  isNamed,
  resolveColour,
  swatchId,
  toHex,
  type Swatch,
} from "./palette";
import { newProject, type Project } from "./project";
import { renderSheet } from "./renderProject";
import { makeRaster, type Raster } from "./raster";

const palette: Swatch[] = [
  { id: "brand.red", name: "Brand red", hex: "#D92632" },
  { id: "ink", name: "Ink", hex: "#0B0D10" },
];

describe("named colours", () => {
  it("tells a reference from a literal", () => {
    expect(isNamed("@brand.red")).toBe(true);
    expect(isNamed("#D92632")).toBe(false);
    expect(isNamed(undefined)).toBe(false);
  });

  it("resolves a reference through the palette", () => {
    expect(resolveColour("@brand.red", palette)).toBe("#D92632");
    expect(findSwatch("@ink", palette)?.name).toBe("Ink");
  });

  it("passes a literal through untouched", () => {
    expect(resolveColour("#123456", palette)).toBe("#123456");
  });

  it("falls back rather than throwing when the palette lost the entry", () => {
    expect(resolveColour("@gone", palette, "#FF00FF")).toBe("#FF00FF");
  });

  it("hands back the fallback for an absent value", () => {
    expect(resolveColour(undefined, palette, "#C6C6C6")).toBe("#C6C6C6");
  });
});

describe("swatch ids", () => {
  it("makes a name safe to put after an @", () => {
    expect(swatchId("Brand Red!")).toBe("brand-red");
    expect(swatchId("***")).toBe("colour");
  });

  it("never collides with an id already in the palette", () => {
    expect(freeSwatchId("Ink", palette)).toBe("ink-2");
  });
});

describe("contrast", () => {
  it("scores black on white at the maximum", () => {
    expect(Math.round(contrastRatio("#000000", "#FFFFFF"))).toBe(21);
  });

  it("scores a colour against itself at the minimum", () => {
    expect(contrastRatio("#8B8B8B", "#8B8B8B")).toBeCloseTo(1, 5);
  });
});

describe("extractPalette", () => {
  const paint = (raster: Raster, index: number, rgb: [number, number, number], alpha = 255) => {
    raster.data.set([...rgb, alpha], index * 4);
  };

  it("returns the commonest colours first and skips transparency", () => {
    const raster = makeRaster(4, 1);
    paint(raster, 0, [255, 0, 0]);
    paint(raster, 1, [255, 0, 0]);
    paint(raster, 2, [0, 0, 255]);
    paint(raster, 3, [0, 255, 0], 0);
    expect(extractPalette(raster).map((swatch) => swatch.hex)).toEqual(["#FF0000", "#0000FF"]);
  });

  it("collapses colours a pixel apart into the commoner one", () => {
    const raster = makeRaster(3, 1);
    paint(raster, 0, [100, 100, 100]);
    paint(raster, 1, [100, 100, 100]);
    paint(raster, 2, [101, 100, 100]);
    expect(extractPalette(raster)).toHaveLength(1);
  });

  it("stops at the limit", () => {
    const raster = makeRaster(8, 1);
    for (let index = 0; index < 8; index++) paint(raster, index, [index * 30, 0, 0]);
    expect(extractPalette(raster, 3)).toHaveLength(3);
  });
});

describe("toHex", () => {
  it("pads and upper-cases", () => {
    expect(toHex(11, 13, 16)).toBe("#0B0D10");
  });
});

describe("named colours reach the sheet", () => {
  const button = (colour: string): Project => {
    const project = newProject("m", "k", "U+E8F0");
    project.elements.push({ id: "b", kind: "button", x: 20, y: 30, w: 40, h: 18, color: colour });
    return project;
  };

  it("draws a reference exactly as the literal it stands for", () => {
    const named = button("@brand.red");
    named.palette = [{ id: "brand.red", name: "Brand red", hex: "#D92632" }];
    expect(renderSheet(named).data).toEqual(renderSheet(button("#D92632")).data);
  });

  it("lets the project's palette shadow the pack's", () => {
    const named = button("@brand.red");
    named.palette = [{ id: "brand.red", name: "Local", hex: "#00FF00" }];
    const drawn = renderSheet(named, undefined, { palette: [...palette] });
    expect(drawn.data).toEqual(renderSheet(button("#00FF00")).data);
  });

  it("draws the vanilla plate when nothing defines the reference", () => {
    const uncoloured = newProject("m", "k", "U+E8F0");
    uncoloured.elements.push({ id: "b", kind: "button", x: 20, y: 30, w: 40, h: 18 });
    expect(renderSheet(button("@missing")).data).toEqual(renderSheet(uncoloured).data);
  });
});
