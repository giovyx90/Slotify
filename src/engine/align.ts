// SPDX-License-Identifier: GPL-3.0-or-later
import type { Rect } from "./geometry";

/**
 * Aligning and distributing boxes. Every function returns one new position per input, in
 * the input's order, and never mutates — the editor decides what to do with them.
 *
 * With two or more boxes the alignment reference is the boxes' own bounding box; a lone
 * box aligns against `bounds` instead, which is how "centre this button in the window"
 * works without asking the user to select the window first.
 */

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type Axis = "h" | "v";

export interface Placement {
  x: number;
  y: number;
}

export function boundingBox(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function align(boxes: readonly Rect[], mode: AlignMode, bounds?: Rect): Placement[] {
  if (boxes.length === 0) return [];
  const reference = boxes.length > 1 ? boundingBox(boxes) : (bounds ?? boundingBox(boxes));

  return boxes.map((box) => {
    switch (mode) {
      case "left":
        return { x: reference.x, y: box.y };
      case "right":
        return { x: reference.x + reference.w - box.w, y: box.y };
      case "hcenter":
        return { x: reference.x + Math.floor((reference.w - box.w) / 2), y: box.y };
      case "top":
        return { x: box.x, y: reference.y };
      case "bottom":
        return { x: box.x, y: reference.y + reference.h - box.h };
      case "vcenter":
        return { x: box.x, y: reference.y + Math.floor((reference.h - box.h) / 2) };
    }
  });
}

/**
 * Even gaps between edges, outermost two left where they are. Under three boxes there is
 * nothing to distribute, so the positions come back unchanged.
 *
 * The gap is whole pixels and the remainder is spread one pixel at a time across the
 * leading gaps: on a pixel grid an even-looking row of whole pixels beats a
 * mathematically even row of fractional ones.
 */
export function distribute(boxes: readonly Rect[], axis: Axis): Placement[] {
  const positions = boxes.map((box) => ({ x: box.x, y: box.y }));
  if (boxes.length < 3) return positions;

  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => (axis === "h" ? a.box.x - b.box.x : a.box.y - b.box.y));

  const first = order[0]!.box;
  const last = order[order.length - 1]!.box;
  const start = axis === "h" ? first.x + first.w : first.y + first.h;
  const end = axis === "h" ? last.x : last.y;
  const occupied = order
    .slice(1, -1)
    .reduce((total, entry) => total + (axis === "h" ? entry.box.w : entry.box.h), 0);

  const gaps = order.length - 1;
  const free = end - start - occupied;
  const gap = Math.floor(free / gaps);
  let remainder = free - gap * gaps;

  let cursor = start;
  for (let index = 1; index < order.length - 1; index++) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    cursor += gap + extra;
    const entry = order[index]!;
    if (axis === "h") positions[entry.index]!.x = cursor;
    else positions[entry.index]!.y = cursor;
    cursor += axis === "h" ? entry.box.w : entry.box.h;
  }

  return positions;
}
