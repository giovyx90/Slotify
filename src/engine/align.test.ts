// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { align, boundingBox, distribute } from "./align";

const box = (x: number, y: number, w = 10, h = 10) => ({ x, y, w, h });

describe("boundingBox", () => {
  it("covers every box", () => {
    expect(boundingBox([box(10, 10), box(30, 40, 20, 5)])).toEqual({ x: 10, y: 10, w: 40, h: 35 });
  });
});

describe("align", () => {
  it("pulls a group to its own left edge", () => {
    expect(align([box(10, 0), box(30, 20)], "left")).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ]);
  });

  it("aligns right on the far edge, so different widths still line up", () => {
    const result = align([box(10, 0, 40), box(30, 20, 10)], "right");
    expect(result[0]!.x + 40).toBe(result[1]!.x + 10);
  });

  it("centres a lone box in the given bounds, not in itself", () => {
    expect(align([box(0, 0, 20, 8)], "hcenter", { x: 0, y: 0, w: 176, h: 222 })).toEqual([
      { x: 78, y: 0 },
    ]);
  });

  it("leaves a lone box alone when there are no bounds", () => {
    expect(align([box(5, 7)], "hcenter")).toEqual([{ x: 5, y: 7 }]);
  });

  it("never moves a box on the other axis", () => {
    expect(align([box(1, 2), box(3, 4)], "top").map((placement) => placement.x)).toEqual([1, 3]);
  });
});

describe("distribute", () => {
  it("does nothing under three boxes", () => {
    expect(distribute([box(0, 0), box(50, 0)], "h")).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
  });

  it("evens the gaps and keeps the ends put", () => {
    const result = distribute([box(0, 0), box(20, 0), box(100, 0)], "h");
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[2]).toEqual({ x: 100, y: 0 });
    expect(result[1]!.x - 10).toBe(100 - (result[1]!.x + 10));
  });

  it("keeps every position a whole pixel when the gap does not divide", () => {
    const result = distribute([box(0, 0), box(20, 0), box(30, 0), box(101, 0)], "h");
    for (const placement of result) expect(Number.isInteger(placement.x)).toBe(true);
  });

  it("distributes vertically off the boxes' own heights", () => {
    const result = distribute([box(0, 0, 10, 10), box(0, 30, 10, 20), box(0, 100, 10, 10)], "v");
    expect(result[1]!.y - 10).toBe(100 - (result[1]!.y + 20));
  });

  it("works from the boxes' order on screen, not the array's", () => {
    const result = distribute([box(100, 0), box(0, 0), box(20, 0)], "h");
    expect(result[1]).toEqual({ x: 0, y: 0 });
    expect(result[0]).toEqual({ x: 100, y: 0 });
  });
});
