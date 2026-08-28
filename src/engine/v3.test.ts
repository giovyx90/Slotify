// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { componentFromElements, instantiate, parseComponent, serializeComponent, slugify } from "./components";
import type { ParsedBitmap } from "./fontJson";
import { newProject, type Element } from "./project";
import { alphaAt, makeRaster, type Raster } from "./raster";
import { renderSheet } from "./renderProject";
import { snapToEdges } from "./snap";
import { renderTag } from "./tagGenerator";
import { advanceOfGlyph, hexToRgb, loadBitmapFont, measureText, renderText } from "./textFont";

function pixel(raster: Raster, x: number, y: number, rgba: [number, number, number, number]): void {
  raster.data.set(rgba, (y * raster.width + x) * 4);
}

function rgbAt(raster: Raster, x: number, y: number): [number, number, number] {
  const index = (y * raster.width + x) * 4;
  return [raster.data[index]!, raster.data[index + 1]!, raster.data[index + 2]!];
}

/** A 2×2-cell synthetic font texture: A is 5 wide, B is 3 wide, C fills its cell. */
function syntheticFont() {
  const texture = makeRaster(16, 16);
  for (let x = 0; x < 5; x++) pixel(texture, x, 2, [255, 255, 255, 255]); // A at cell (0,0)
  for (let x = 0; x < 3; x++) pixel(texture, 8 + x, 3, [255, 255, 255, 255]); // B at cell (0,1)
  for (let x = 0; x < 8; x++) pixel(texture, x, 8 + 4, [255, 255, 255, 255]); // C at cell (1,0)

  const provider: ParsedBitmap = {
    kind: "bitmap",
    file: "font/test.png",
    ascent: 7,
    height: 8,
    grid: [
      [0x41, 0x42],
      [0x43, 0],
    ],
    index: 0,
  };
  return loadBitmapFont(provider, texture);
}

describe("bitmap font", () => {
  const font = syntheticFont();

  it("measures glyph widths from the pixels and spaces empty cells at 4", () => {
    expect(font.glyphs.get(0x41)?.width).toBe(5);
    expect(font.glyphs.get(0x42)?.width).toBe(3);
    expect(advanceOfGlyph(font.glyphs.get(0x41))).toBe(6);
    expect(advanceOfGlyph(undefined)).toBe(4); // the space
    expect(measureText(font, "AB")).toEqual({ w: 9, h: 8 });
  });

  it("renders a tight line and tints it", () => {
    const line = renderText(font, "AB", { color: hexToRgb("#FF0000") });
    expect(line.width).toBe(9);
    expect(alphaAt(line, 0, 2)).toBe(255);
    expect(rgbAt(line, 0, 2)).toEqual([255, 0, 0]);
    expect(alphaAt(line, 6, 3)).toBe(255); // B starts at cursor 6
  });

  it("runs a gradient over the whole line, per destination row", () => {
    const line = renderText(font, "AC", { color: hexToRgb("#000000"), gradientTo: hexToRgb("#FFFFFF") });
    const top = rgbAt(line, 0, 2);
    const bottom = rgbAt(line, 6, 4); // C's mark sits lower
    expect(bottom[0]).toBeGreaterThan(top[0]);
  });
});

describe("tag generator", () => {
  const font = syntheticFont();

  it("adds outline, shadow and a bordered plate around the text", () => {
    const tag = renderTag(font, "A", {
      scale: 1,
      fill: "#FFFFFF",
      outline: "#000000",
      shadow: "#101010",
      shadowOffset: [1, 1],
      background: { fill: "#333344", border: "#F0A831", paddingX: 2, paddingY: 2 },
    });
    // width: text 5 + outline 2 + padding 4 + shadow 1
    expect(tag.width).toBe(12);
    expect(rgbAt(tag, 0, 0)).toEqual(hexToRgb("#F0A831")); // border corner
    expect(rgbAt(tag, 1, 1)).toEqual(hexToRgb("#333344")); // plate
  });

  it("scales nearest-neighbour", () => {
    const one = renderTag(font, "A", { scale: 1, fill: "#FFFFFF" });
    const three = renderTag(font, "A", { scale: 3, fill: "#FFFFFF" });
    expect(three.width).toBe(one.width * 3);
    expect(rgbAt(three, 2, 8)).toEqual(rgbAt(one, 0, 2));
  });
});

describe("component library", () => {
  const elements: Element[] = [
    { id: "a", kind: "button", x: 30, y: 40, w: 40, h: 18, label: "OK", color: "#4A6B2A" },
    { id: "b", kind: "slot", x: 80, y: 44, w: 16, h: 16 },
  ];

  it("re-anchors a composite to its own top-left and round-trips as JSON", () => {
    const component = componentFromElements("ok-row", "OK row", elements);
    expect(component.w).toBe(66);
    expect(component.h).toBe(20);
    expect(component.elements![0]!.x).toBe(0);
    expect(component.elements![1]!.x).toBe(50);
    expect(parseComponent(serializeComponent(component))).toEqual(component);
  });

  it("instantiates with fresh ids at the drop point, fully editable", () => {
    const component = componentFromElements("ok-row", "OK row", elements);
    let counter = 0;
    const placed = instantiate(component, 10, 100, () => `n${++counter}`);
    expect(placed.map((element) => element.id)).toEqual(["n1", "n2"]);
    expect(placed[0]!.x).toBe(10);
    expect(placed[1]!.x).toBe(60);
    expect(placed[0]!.label).toBe("OK");
  });

  it("slugifies names the NXMenu way", () => {
    expect(slugify("Cube Buzzer!")).toBe("cube-buzzer");
    expect(() => slugify("???")).toThrow();
  });
});

describe("snapToEdges", () => {
  it("locks flush against a neighbour within the threshold, per axis", () => {
    const other = { x: 50, y: 20, w: 30, h: 18 };
    // Moving box's left edge 2px short of the other's right edge -> snaps flush.
    expect(snapToEdges({ x: 82, y: 100, w: 20, h: 10 }, [other])).toEqual({ x: 80, y: 100 });
    // And alignment of tops.
    expect(snapToEdges({ x: 200, y: 22, w: 20, h: 10 }, [other])).toEqual({ x: 200, y: 20 });
  });

  it("does nothing outside the threshold", () => {
    expect(snapToEdges({ x: 10, y: 10, w: 5, h: 5 }, [{ x: 50, y: 50, w: 5, h: 5 }])).toEqual({ x: 10, y: 10 });
  });
});

describe("rendering the new element kinds", () => {
  const font = syntheticFont();

  it("draws coloured buttons with a centred label", () => {
    const project = newProject("m", "k", "U+E8F0");
    project.elements.push({ id: "b", kind: "button", x: 20, y: 30, w: 40, h: 18, color: "#204060", label: "AB", textColor: "#FFFFFF" });
    const sheet = renderSheet(project, undefined, { fonts: { minecraft: font } });
    expect(rgbAt(sheet, 30, 40)).toEqual([32, 64, 96]); // custom fill (window==sheet at ascent 13)
    // The label: A's mark row 2 within the 8px line, centred in the 18px button.
    const labelY = 30 + Math.floor((18 - 8) / 2) + 2;
    const labelX = 20 + Math.floor((40 - 9) / 2);
    expect(rgbAt(sheet, labelX, labelY)).toEqual([255, 255, 255]);
  });

  it("draws the fallback infobox (black ring, inner border) and a placeholder for a missing sprite", () => {
    const project = newProject("m", "k", "U+E8F0");
    project.elements.push({ id: "i", kind: "infobox", x: 10, y: 60, w: 80, h: 30, lines: ["A"], borderColor: "#F0A831" });
    project.elements.push({ id: "s", kind: "sprite", x: 120, y: 60, w: 10, h: 10, sprite: "missing" });
    const sheet = renderSheet(project, undefined, { fonts: { minecraft: font } });
    expect(alphaAt(sheet, 10, 60)).toBe(0); // rounded corner stays open
    expect(rgbAt(sheet, 11, 60)).toEqual([0, 0, 0]); // outer black ring
    expect(rgbAt(sheet, 11, 61)).toEqual(hexToRgb("#F0A831")); // inner border
    expect(rgbAt(sheet, 14, 64)).toEqual(hexToRgb("#212121")); // measured NEXT fill
    expect(rgbAt(sheet, 120, 60)).toEqual([255, 90, 90]); // missing-sprite outline
  });

  it("blits a sprite from the context", () => {
    const sprite = makeRaster(4, 4);
    pixel(sprite, 0, 0, [1, 2, 3, 255]);
    const project = newProject("m", "k", "U+E8F0");
    project.elements.push({ id: "s", kind: "sprite", x: 100, y: 100, w: 4, h: 4, sprite: "dot" });
    const sheet = renderSheet(project, undefined, { sprites: new Map([["dot", sprite]]) });
    expect(rgbAt(sheet, 100, 100)).toEqual([1, 2, 3]);
  });
});
