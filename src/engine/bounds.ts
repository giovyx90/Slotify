// SPDX-License-Identifier: GPL-3.0-or-later
import { SHEET_CANVAS, SHEET_TO_WINDOW_Y } from "./geometry";
import type { Element, Project } from "./project";
import { regionBBox, type TileCell } from "./tiles";

/**
 * What falls off the 256×256 sheet.
 *
 * The ascent decides which rows of the sheet land above the chest window and which land
 * below it: the client draws the glyph at `windowY = sheetY − ascent + 13`, so an ascent
 * of 13 puts sheet row 0 on window row 0, and every pixel above the window has to come
 * from a sheet row the artwork was pushed down to make room for.
 *
 * Elements are authored in window coordinates and baked at `sheetY = windowY + ascent −
 * 13`. Put a title panel above the window without buying that room first and its pixels
 * land on negative sheet rows — where `blit` and `put` drop them without a word. The
 * sheet exports, the pack loads, the panel is simply missing its top. This is the check
 * that turns that into a sentence on screen.
 */

export interface Clipped {
  id: string;
  kind: string;
  /** Pixels lost off each edge of the sheet. Zero on the edges that are fine. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The box an element occupies in window coordinates, tiles resolved to their region. */
export function windowBox(element: Element): { x: number; y: number; w: number; h: number } {
  if (element.kind === "tiles") {
    const cells = (element.cells ?? []) as TileCell[];
    if (cells.length > 0) return regionBBox(cells);
  }
  return { x: element.x, y: element.y, w: element.w, h: element.h };
}

/** How far the artwork sits down the sheet: the friendly face of the ascent. */
export function roomAbove(project: Project): number {
  return project.ascent - SHEET_TO_WINDOW_Y;
}

export function clippedElements(project: Project, elements = project.elements): Clipped[] {
  const dy = roomAbove(project);
  const clipped: Clipped[] = [];

  for (const element of elements) {
    if (element.hidden) continue;
    const box = windowBox(element);
    const top = Math.max(0, -(box.y + dy));
    const bottom = Math.max(0, box.y + dy + box.h - SHEET_CANVAS);
    const left = Math.max(0, -box.x);
    const right = Math.max(0, box.x + box.w - SHEET_CANVAS);
    if (top || bottom || left || right) {
      clipped.push({ id: element.id, kind: element.kind, top, bottom, left, right });
    }
  }

  return clipped;
}

/**
 * The `room above` that would bring everything back onto the sheet, or null when no
 * single value can: artwork hanging off the top and off the bottom at once needs a
 * shorter screen, not a different ascent, and saying so beats offering a fix that
 * trades one clipped element for another.
 */
export function suggestedRoomAbove(project: Project, elements = project.elements): number | null {
  const visible = elements.filter((element) => !element.hidden);
  if (visible.length === 0) return null;

  const boxes = visible.map(windowBox);
  const highest = Math.min(...boxes.map((box) => box.y));
  const lowest = Math.max(...boxes.map((box) => box.y + box.h));

  // Room enough for the topmost element, and no more than the lowest one can afford.
  const needed = -highest;
  const affordable = SHEET_CANVAS - lowest;
  if (needed > affordable) return null;

  const current = roomAbove(project);
  if (current >= needed && current <= affordable) return null;
  return Math.max(needed, Math.min(current, affordable));
}
