// SPDX-License-Identifier: GPL-3.0-or-later
import { CELL, GAP_BEFORE_HOTBAR, WELL } from "./geometry";
import { WELL_FILL, WELL_SHADOW } from "./paint";
import type { Raster } from "./raster";
import type { ContainerKind, ContainerProfile, SlotSpec } from "./containers";

/**
 * Reading a container's geometry off its own texture.
 *
 * SLOTIFY-VISION.md §0: a profile is measured, never typed. Everything a container
 * screen's background can tell us is in the pixels — a vanilla slot well is an exact
 * signature, and finding all of them gives the slot grid, the viewer's inventory and the
 * window's size without a single coordinate typed by a human.
 *
 * What the pixels cannot say is where the client draws the *title*, because that number
 * lives in client code and appears in no file. That one is calibrated against a
 * screenshot (`TitleOrigin`), and until it is, a profile stays honestly incomplete.
 *
 * No Mojang asset ships with Slotify. Detection runs on a texture the user already has.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A found slot: the top-left of its 16×16 item area, in window coordinates. */
export interface Well {
  x: number;
  y: number;
}

export interface Detection {
  /** The window's rectangle inside the texture. Slot coordinates are relative to it. */
  window: Rect;
  /** The container's own wells, reading order (top to bottom, then left to right). */
  container: Well[];
  /** The viewer's 27 main-inventory wells, reading order. Empty when not drawn. */
  inventory: Well[];
  /** The viewer's 9 hotbar wells, left to right. Empty when not drawn. */
  hotbar: Well[];
  /**
   * Rectangles that look like a well's interior but carry no bevel — a restyled pack, or
   * art that happens to be the vanilla grey. Reported so "found nothing" can say why.
   */
  unbevelled: Well[];
  notes: string[];
}

function alpha(raster: Raster, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return 0;
  return raster.data[(y * raster.width + x) * 4 + 3]!;
}

function isColour(raster: Raster, x: number, y: number, rgb: readonly number[]): boolean {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return false;
  const i = (y * raster.width + x) * 4;
  return (
    raster.data[i + 3]! === 255 &&
    raster.data[i]! === rgb[0] &&
    raster.data[i + 1]! === rgb[1] &&
    raster.data[i + 2]! === rgb[2]
  );
}

/**
 * The biggest connected run of opaque pixels, as a rectangle.
 *
 * Not the opaque bounding box: a container texture may carry loose sprites elsewhere in
 * the same file (a furnace's flame, an arrow, a scroll bar), and a bounding box would
 * swallow them and report a window half again too tall. Connectivity separates the
 * background from everything that is merely stored next to it.
 */
export function largestOpaqueRegion(raster: Raster): Rect | null {
  const { width, height } = raster;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let best: Rect | null = null;
  let bestArea = 0;

  for (let start = 0; start < width * height; start++) {
    if (seen[start] || alpha(raster, start % width, (start / width) | 0) === 0) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let area = 0;

    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = (index / width) | 0;
      area++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;

      const visit = (next: number, nx: number, ny: number): void => {
        if (seen[next] || alpha(raster, nx, ny) === 0) return;
        seen[next] = 1;
        queue[tail++] = next;
      };
      if (x > 0) visit(index - 1, x - 1, y);
      if (x + 1 < width) visit(index + 1, x + 1, y);
      if (y > 0) visit(index - width, x, y - 1);
      if (y + 1 < height) visit(index + width, x, y + 1);
    }

    if (area > bestArea) {
      bestArea = area;
      best = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
  }

  return best;
}

/**
 * Every vanilla slot well in the raster.
 *
 * The signature, from `drawSlotWell`: a 16×16 field of `#8B8B8B` with `#373737` along the
 * row above and the column left of it. The highlight below and right is deliberately not
 * required — two adjacent slots share that pixel column, and a well against the window's
 * own edge can lose it entirely.
 */
export function detectWells(raster: Raster, region?: Rect): { wells: Well[]; unbevelled: Well[] } {
  const area = region ?? { x: 0, y: 0, w: raster.width, h: raster.height };
  const wells: Well[] = [];
  const unbevelled: Well[] = [];

  for (let y = area.y; y <= area.y + area.h - WELL; y++) {
    for (let x = area.x; x <= area.x + area.w - WELL; x++) {
      // Only the top-left corner of a grey field counts. Inside a field larger than a
      // slot every offset matches, and reporting all of them buries the real slots in a
      // smear of near-duplicates.
      if (isColour(raster, x - 1, y, WELL_FILL) || isColour(raster, x, y - 1, WELL_FILL)) continue;

      let filled = true;
      for (let dy = 0; dy < WELL && filled; dy++) {
        for (let dx = 0; dx < WELL && filled; dx++) {
          if (!isColour(raster, x + dx, y + dy, WELL_FILL)) filled = false;
        }
      }
      if (!filled) continue;

      let bevelled = true;
      for (let i = 0; i < WELL; i++) {
        if (!isColour(raster, x + i, y - 1, WELL_SHADOW)) bevelled = false;
        if (!isColour(raster, x - 1, y + i, WELL_SHADOW)) bevelled = false;
      }
      (bevelled ? wells : unbevelled).push({ x, y });
    }
  }

  const order = (a: Well, b: Well): number => a.y - b.y || a.x - b.x;
  return { wells: wells.sort(order), unbevelled: unbevelled.sort(order) };
}

/**
 * Pull the viewer's inventory out of a set of wells.
 *
 * The client draws it as four rows of nine at an 18px pitch, with a 4px break before the
 * hotbar — so the rows sit at y, y+18, y+36 and then y+58, and no other run of four rows
 * in a container background can. Matching that shape rather than "the bottom four rows"
 * is what lets a screen with slots below its inventory still be read correctly.
 */
export function splitViewerInventory(wells: readonly Well[]): {
  container: Well[];
  inventory: Well[];
  hotbar: Well[];
} {
  const rows = new Map<number, Well[]>();
  for (const well of wells) {
    const row = rows.get(well.y) ?? [];
    row.push(well);
    rows.set(well.y, row);
  }
  for (const row of rows.values()) row.sort((a, b) => a.x - b.x);

  const isNine = (y: number, xs?: number[]): number[] | null => {
    const row = rows.get(y);
    if (!row || row.length !== 9) return null;
    for (let i = 1; i < 9; i++) {
      if (row[i]!.x - row[i - 1]!.x !== CELL) return null;
    }
    const found = row.map((well) => well.x);
    if (xs && found.some((x, i) => x !== xs[i])) return null;
    return found;
  };

  const hotbarGap = CELL + GAP_BEFORE_HOTBAR;
  for (const top of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = isNine(top);
    if (!xs) continue;
    if (!isNine(top + CELL, xs) || !isNine(top + 2 * CELL, xs)) continue;
    if (!isNine(top + 2 * CELL + hotbarGap, xs)) continue;

    const invRows = [top, top + CELL, top + 2 * CELL];
    const barRow = top + 2 * CELL + hotbarGap;
    const taken = new Set([...invRows, barRow]);
    return {
      container: wells.filter((well) => !taken.has(well.y)),
      inventory: wells.filter((well) => invRows.includes(well.y)),
      hotbar: wells.filter((well) => well.y === barRow),
    };
  }

  return { container: [...wells], inventory: [], hotbar: [] };
}

/** Measure a container background: window, container slots, viewer inventory. */
export function detectContainer(raster: Raster, kind?: ContainerKind): Detection {
  const notes: string[] = [];
  const window = largestOpaqueRegion(raster);
  if (!window) {
    return { window: { x: 0, y: 0, w: 0, h: 0 }, container: [], inventory: [], hotbar: [], unbevelled: [], notes: ["the texture is empty"] };
  }
  if (window.w !== raster.width || window.h !== raster.height) {
    notes.push(`window ${window.w}×${window.h} at (${window.x},${window.y}) in a ${raster.width}×${raster.height} file`);
  }

  const { wells, unbevelled } = detectWells(raster, window);
  const relative = (well: Well): Well => ({ x: well.x - window.x, y: well.y - window.y });
  const split = splitViewerInventory(wells.map(relative));

  if (split.inventory.length === 0) {
    notes.push("no viewer inventory found — the screen hides it, or this texture is restyled");
  }
  if (unbevelled.length > 0) {
    notes.push(`${unbevelled.length} grey field(s) the size of a slot but without the dark bevel — restyled slots are not detected`);
  }
  if (kind && split.container.length !== kind.slotCount) {
    notes.push(`${split.container.length} of ${kind.slotCount} container slots found`);
  }

  return {
    window,
    container: split.container,
    inventory: split.inventory,
    hotbar: split.hotbar,
    unbevelled: unbevelled.map(relative),
    notes,
  };
}

/**
 * Turn a measurement into a profile.
 *
 * Raw indices are the one thing detection cannot settle: reading order is a proposal, and
 * `ContainerKind.indexOrder` overrides it where the real numbering is known. A profile
 * built without one says so (`indicesVerified: false`) rather than looking finished.
 */
export function profileFromDetection(
  id: string,
  name: string,
  detection: Detection,
  kind?: ContainerKind,
): ContainerProfile {
  const notes = [...detection.notes];
  const order = kind?.indexOrder;
  const usable = order !== undefined && order.length === detection.container.length;
  if (order !== undefined && !usable) {
    notes.push(
      `index order for ${kind!.id} lists ${order.length} slots but ${detection.container.length} were found — falling back to reading order`,
    );
  }

  const slots: SlotSpec[] = detection.container.map((well, position) => ({
    index: usable ? order![position]! : position,
    x: well.x,
    y: well.y,
  }));
  slots.sort((a, b) => a.index - b.index);

  // Built from the wells that were actually found, never re-derived from the chest's
  // origin: a screen whose inventory sits somewhere else would come back wrong, and
  // wrong-but-plausible is the one outcome this whole file exists to avoid.
  const inventory: SlotSpec[] =
    detection.inventory.length === 27 && detection.hotbar.length === 9
      ? [
          ...detection.inventory.map((well, i) => ({ index: i, x: well.x, y: well.y })),
          ...detection.hotbar.map((well, i) => ({ index: 27 + i, x: well.x, y: well.y })),
        ]
      : [];

  return {
    id,
    name,
    windowW: detection.window.w,
    windowH: detection.window.h,
    titleOrigin: null,
    slots,
    inventory,
    clientDraws: [],
    source: "detected",
    indicesVerified: usable,
    notes,
  };
}
