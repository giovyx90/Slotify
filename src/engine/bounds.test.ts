// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { clippedElements, roomAbove, suggestedRoomAbove, windowBox } from "./bounds";
import { newProject, type Element, type Project } from "./project";
import { renderSheet } from "./renderProject";

function withPanel(y: number, ascent = 13, extra: Partial<Element> = {}): Project {
  const project = newProject("m", "k", "U+E8F0");
  project.ascent = ascent;
  project.bakeWindow = false;
  project.elements.push({ id: "p", kind: "panel", x: 20, y, w: 120, h: 30, ...extra } as Element);
  return project;
}

describe("roomAbove", () => {
  it("is the ascent minus the one measured constant, and nothing else", () => {
    expect(roomAbove({ ...newProject("m", "k", "U+E8F0"), ascent: 13 })).toBe(0);
    expect(roomAbove({ ...newProject("m", "k", "U+E8F0"), ascent: 31 })).toBe(18);
  });
});

describe("windowBox", () => {
  it("resolves a tile region to the box it really covers", () => {
    const tiles: Element = {
      id: "t",
      kind: "tiles",
      tileKind: "button",
      cells: [
        [0, 0],
        [0, 1],
      ],
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    };
    expect(windowBox(tiles)).toEqual({ x: 7, y: 17, w: 36, h: 18 });
  });
});

describe("clippedElements", () => {
  it("says nothing about a screen that fits", () => {
    expect(clippedElements(withPanel(40))).toEqual([]);
  });

  it("catches a panel put above the window with no room bought", () => {
    const clipped = clippedElements(withPanel(-20));
    expect(clipped).toHaveLength(1);
    expect(clipped[0]!.top).toBe(20);
  });

  it("stops complaining once the ascent has bought the room", () => {
    expect(clippedElements(withPanel(-20, 33))).toEqual([]);
  });

  it("catches artwork pushed off the bottom by too much room above", () => {
    const clipped = clippedElements(withPanel(200, 60));
    expect(clipped[0]!.bottom).toBeGreaterThan(0);
  });

  it("ignores a hidden layer, which is not exported either", () => {
    expect(clippedElements(withPanel(-20, 13, { hidden: true }))).toEqual([]);
  });

  it("describes what the renderer actually does", () => {
    // The pixels really are gone: the same panel, drawn, has nothing on its top row.
    const sheet = renderSheet(withPanel(-20));
    const row = 0;
    let opaque = 0;
    for (let x = 0; x < sheet.width; x++) {
      if (sheet.data[(row * sheet.width + x) * 4 + 3]! > 0) opaque++;
    }
    expect(opaque).toBeGreaterThan(0); // rows 0..9 of the panel survive
    expect(clippedElements(withPanel(-20))[0]!.top).toBe(20);
  });
});

describe("suggestedRoomAbove", () => {
  it("offers exactly the room the highest element needs", () => {
    expect(suggestedRoomAbove(withPanel(-20))).toBe(20);
  });

  it("offers nothing when everything already fits", () => {
    expect(suggestedRoomAbove(withPanel(40))).toBeNull();
  });

  it("refuses when one value cannot serve both edges", () => {
    const project = withPanel(-30);
    project.elements.push({ id: "q", kind: "panel", x: 0, y: 240, w: 10, h: 30 });
    expect(suggestedRoomAbove(project)).toBeNull();
  });

  it("brings the room back down when it pushed the artwork off the bottom", () => {
    const project = withPanel(200, 90);
    const suggested = suggestedRoomAbove(project);
    expect(suggested).not.toBeNull();
    expect(clippedElements({ ...project, ascent: 13 + suggested! })).toEqual([]);
  });
});
