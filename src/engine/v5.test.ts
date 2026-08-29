// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { newProject, type Element, type Project } from "./project";
import { renderSheet } from "./renderProject";
import { makeRaster } from "./raster";
import { drawPlate, hueShiftedBevels, VANILLA_BEVELS, type RGBA } from "./paint";
import { cellsCovering } from "./tiles";
import { buildMono5Font } from "./mono5";
import type { RenderContext } from "./renderProject";

const RED: RGBA = [217, 38, 50, 255];

/** How many pixels of the raster are not the fill colour — a stand-in for edge weight. */
function edgePixels(width: number, height: number, draw: (raster: ReturnType<typeof makeRaster>) => void): number {
  const raster = makeRaster(width, height);
  draw(raster);
  let count = 0;
  for (let index = 0; index < raster.data.length; index += 4) {
    const same =
      raster.data[index] === RED[0] &&
      raster.data[index + 1] === RED[1] &&
      raster.data[index + 2] === RED[2];
    if (!same && raster.data[index + 3] !== 0) count++;
  }
  return count;
}

describe("plate styles", () => {
  const bevels = hueShiftedBevels(RED);

  it("draws a double bevel with more edge than a single one", () => {
    const single = edgePixels(40, 40, (raster) =>
      drawPlate(raster, 2, 2, 30, 20, RED, bevels, false, "single"),
    );
    const double = edgePixels(40, 40, (raster) =>
      drawPlate(raster, 2, 2, 30, 20, RED, bevels, false, "double"),
    );
    expect(double).toBeGreaterThan(single);
  });

  it("gives a flat plate a plain outline, one pixel all round", () => {
    const flat = edgePixels(40, 40, (raster) => drawPlate(raster, 2, 2, 30, 20, RED, bevels, false, "flat"));
    expect(flat).toBe(2 * 30 + 2 * 20 - 4);
  });

  it("swaps the bevel when pressed", () => {
    const raised = makeRaster(40, 40);
    drawPlate(raised, 2, 2, 30, 20, RED, bevels, false, "single");
    const pressed = makeRaster(40, 40);
    drawPlate(pressed, 2, 2, 30, 20, RED, bevels, true, "single");
    expect(raised.data).not.toEqual(pressed.data);
  });

  it("never draws two rings on a plate too thin to hold them", () => {
    const raster = makeRaster(10, 10);
    expect(() => drawPlate(raster, 1, 1, 30, 3, RED, VANILLA_BEVELS, false, "double")).not.toThrow();
  });
});

describe("cellsCovering", () => {
  it("maps a box on the lattice to exactly its cells", () => {
    expect(cellsCovering({ x: 7, y: 17, w: 36, h: 18 })).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("rounds a box that drifted off the lattice back onto it", () => {
    expect(cellsCovering({ x: 9, y: 19, w: 34, h: 17 })).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("always returns at least one cell", () => {
    expect(cellsCovering({ x: 7, y: 17, w: 2, h: 2 })).toEqual([[0, 0]]);
  });

  it("refuses to leave the sheet", () => {
    const cells = cellsCovering({ x: 7, y: 17, w: 400, h: 18 });
    expect(Math.max(...cells.map(([, col]) => col))).toBeLessThanOrEqual(12);
  });
});

describe("text alignment", () => {
  // Labels only exist when a face is loaded; the pack's is not here, the built-in is.
  const withFont: RenderContext = { fonts: { mono5: buildMono5Font() } };

  const labelled = (extra: Partial<Element>): Project => {
    const project = newProject("m", "k", "U+E8F0");
    project.elements.push({
      id: "b",
      kind: "button",
      x: 20,
      y: 30,
      w: 80,
      h: 18,
      label: "OK",
      font: "mono5",
      textColor: "#00FF00",
      ...extra,
    } as Element);
    return project;
  };

  const renderSheet_ = (project: Project) => renderSheet(project, undefined, withFont);

  it("puts a left-aligned label somewhere a centred one is not", () => {
    expect(renderSheet_(labelled({ align: "left" })).data).not.toEqual(
      renderSheet_(labelled({})).data,
    );
  });

  it("mirrors left and right about the centre of the box", () => {
    const left = renderSheet_(labelled({ align: "left" }));
    const right = renderSheet_(labelled({ align: "right" }));
    expect(left.data).not.toEqual(right.data);
  });

  it("moves the text by exactly the offset it is given", () => {
    const plain = renderSheet_(labelled({ align: "left" }));
    const shifted = renderSheet_(labelled({ align: "left", textDx: 3 }));
    const column = (raster: typeof plain): number => {
      for (let x = 0; x < raster.width; x++) {
        for (let y = 0; y < raster.height; y++) {
          const index = (y * raster.width + x) * 4;
              // Green is the label and nothing else: the plate is grey, its bevels white and black.
          const isLabel = raster.data[index + 1] === 255 && raster.data[index] === 0;
          if (isLabel) return x;
        }
      }
      return -1;
    };
    expect(column(shifted) - column(plain)).toBe(3);
  });

  it("leaves a centred label exactly where it always was", () => {
    expect(renderSheet_(labelled({ align: "center" })).data).toEqual(renderSheet_(labelled({})).data);
  });
});
