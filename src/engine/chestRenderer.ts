// SPDX-License-Identifier: GPL-3.0-or-later
import {
  CELL,
  COLS,
  GRID_X,
  GRID_Y,
  SHEET_TO_WINDOW_Y,
  TITLE_X,
  WINDOW_W,
  hotbarY,
  playerInvY,
  windowHeight,
} from "./geometry";
import { regionKeyAt } from "./carve";
import { blit, makeRaster, type Raster } from "./raster";
import { originsOf, spacerString, type SpacerSet, NEXT_SPACERS } from "./spacers";

/**
 * Draws what the client would show: the vanilla chest window, then the painted sheets
 * composited where the title's cursor arithmetic actually puts them.
 *
 * The window is drawn procedurally in the vanilla greys (same palette as
 * `make_gui_template.py`), with each slot's 16×16 well at the canonical (8,18) grid and
 * its bevel outside it — the same three-part bevel/interior/highlight structure
 * `impliedAscent` detects on artist sheets.
 */

import {
  PANEL,
  PANEL_DARK,
  PANEL_EDGE,
  PANEL_LIGHT,
  drawSlotWell,
  put,
  rect,
} from "./paint";

export interface RenderOptions {
  rows: number;
  /** Hide the player inventory / hotbar wells, as `PaintedInventoryHook` does. */
  hideViewerInventory?: boolean;
  /** Individual container slots (raw index) removed from the drawn grid. */
  hiddenContainerSlots?: ReadonlySet<number>;
  /** Individual viewer-inventory slots removed: 0–26 main, 27–35 hotbar. */
  hiddenInvSlots?: ReadonlySet<number>;
  /**
   * Region keys (see `carve.ts`) punched clean out of the window: fully transparent,
   * with the window edge and bevel redrawn around the remaining shape.
   */
  holes?: ReadonlySet<string>;
  /**
   * Rows shaved off the window's top/bottom with the contour re-closed — a window that
   * would overflow the sheet is rebuilt shorter, never sliced raw.
   */
  cropTop?: number;
  cropBottom?: number;
}

/**
 * The bare window, top-left anchored, on a canvas exactly `WINDOW_W × windowHeight`.
 *
 * With `holes`, the panel is built from a mask instead: carved regions are fully
 * transparent and the edge (dark outline) plus bevel (light above/left, dark
 * below/right) redraw themselves around whatever shape remains — a notch in the window
 * looks exactly like a corner of the window.
 */
export function renderWindow(options: RenderOptions): Raster {
  const height = windowHeight(options.rows);
  const raster = makeRaster(WINDOW_W, height);
  const holes = options.holes;
  const cropTop = Math.max(0, options.cropTop ?? 0);
  const cropBottom = Math.max(0, options.cropBottom ?? 0);

  if ((!holes || holes.size === 0) && cropTop === 0 && cropBottom === 0) {
    rect(raster, 0, 0, WINDOW_W, height, PANEL);
    for (let x = 0; x < WINDOW_W; x++) {
      put(raster, x, 0, PANEL_EDGE);
      put(raster, x, height - 1, PANEL_EDGE);
    }
    for (let y = 0; y < height; y++) {
      put(raster, 0, y, PANEL_EDGE);
      put(raster, WINDOW_W - 1, y, PANEL_EDGE);
    }
    for (let x = 1; x < WINDOW_W - 1; x++) {
      put(raster, x, 1, PANEL_LIGHT);
      put(raster, x, height - 2, PANEL_DARK);
    }
    for (let y = 1; y < height - 1; y++) {
      put(raster, 1, y, PANEL_LIGHT);
      put(raster, WINDOW_W - 2, y, PANEL_DARK);
    }
  } else {
    // 0 outside (framed), 1 panel, 2 edge, 3 light bevel, 4 dark bevel,
    // 5 frameless hole — a slot cell punched out INSIDE the grid. The window contour
    // must not wrap those: the neighbouring slots' own rings already close the border,
    // NXMenu-style, and an extra edge+bevel there reads as a broken frame.
    const FRAMELESS = 5;
    const framelessHole = (key: string): boolean => {
      const [band, , colText] = key.split(":") as [string, string, string];
      const col = Number(colText);
      return (band === "con" || band === "inv" || band === "hot") && col >= 0 && col < COLS;
    };

    const mask = new Uint8Array(WINDOW_W * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < WINDOW_W; x++) {
        if (y < cropTop || y >= height - cropBottom) continue; // shaved: framed outside
        const key = regionKeyAt(x, y, options.rows);
        mask[y * WINDOW_W + x] =
          key === null ? 0 : holes?.has(key) ? (framelessHole(key) ? FRAMELESS : 0) : 1;
      }
    }

    const at = (x: number, y: number): number =>
      x >= 0 && x < WINDOW_W && y >= 0 && y < height ? mask[y * WINDOW_W + x]! : 0;
    const isPanelish = (x: number, y: number): boolean => {
      const value = at(x, y);
      return value >= 1 && value <= 4;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < WINDOW_W; x++) {
        if (!isPanelish(x, y)) continue;
        // Only a framed void makes an edge; a frameless grid hole leaves the panel flat.
        if (at(x - 1, y) === 0 || at(x + 1, y) === 0 || at(x, y - 1) === 0 || at(x, y + 1) === 0) {
          mask[y * WINDOW_W + x] = 2;
        }
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < WINDOW_W; x++) {
        if (mask[y * WINDOW_W + x] !== 1) continue;
        const edge = (dx: number, dy: number): boolean => at(x + dx, y + dy) === 2;
        if (edge(0, -1) || edge(-1, 0)) mask[y * WINDOW_W + x] = 3;
        else if (edge(0, 1) || edge(1, 0)) mask[y * WINDOW_W + x] = 4;
      }
    }

    const colours = [null, PANEL, PANEL_EDGE, PANEL_LIGHT, PANEL_DARK, null] as const;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < WINDOW_W; x++) {
        const colour = colours[mask[y * WINDOW_W + x]!];
        if (colour) put(raster, x, y, colour);
      }
    }
  }

  const carved = (key: string): boolean => holes?.has(key) ?? false;
  // A well whose ring would cross a shaved band is dropped whole — never half a slot.
  // The ring spans wellY-1 (shadow) to wellY+16 (light), 18 rows in all.
  const shaved = (wellY: number): boolean =>
    wellY - 1 < cropTop || wellY + 17 > height - cropBottom;

  for (let index = 0; index < COLS * options.rows; index++) {
    if (options.hiddenContainerSlots?.has(index)) continue;
    if (carved(`con:${Math.floor(index / COLS)}:${index % COLS}`)) continue;
    const wellY = GRID_Y + Math.floor(index / COLS) * CELL;
    if (shaved(wellY)) continue;
    drawSlotWell(raster, GRID_X + (index % COLS) * CELL, wellY);
  }

  if (!options.hideViewerInventory) {
    const invY = playerInvY(options.rows);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < COLS; col++) {
        if (options.hiddenInvSlots?.has(row * COLS + col)) continue;
        if (carved(`inv:${row}:${col}`)) continue;
        if (shaved(invY + row * CELL)) continue;
        drawSlotWell(raster, GRID_X + col * CELL, invY + row * CELL);
      }
    }
    const hbY = hotbarY(options.rows);
    for (let col = 0; col < COLS; col++) {
      if (options.hiddenInvSlots?.has(27 + col)) continue;
      if (carved(`hot:0:${col}`)) continue;
      if (shaved(hbY)) continue;
      drawSlotWell(raster, GRID_X + col * CELL, hbY);
    }
  }

  return raster;
}

export interface DrawnSheet {
  codepoint: number;
  /** Measured, never authored. */
  advance: number;
  ascent: number;
  texture: Raster;
}

export interface ComposeOptions extends RenderOptions {
  shift: number;
  base: DrawnSheet;
  overlays?: readonly (DrawnSheet | null)[];
  spacers?: SpacerSet;
  /** Transparent margin around the window, so overflowing artwork stays visible. */
  pad?: number;
  /**
   * Skip the procedural window entirely — for sheets that bake the (possibly carved)
   * window into their own pixels, the way real NEXT screens do over the erased
   * `generic_54` texture.
   */
  bare?: boolean;
}

/**
 * The full preview: window plus every sheet the title would draw, each at
 * `(TITLE_X + origin, SHEET_TO_WINDOW_Y − ascent)` — so an advance bug displaces
 * overlays here exactly as it would in game.
 */
export function renderScreen(options: ComposeOptions): Raster {
  const pad = options.pad ?? 0;
  const height = windowHeight(options.rows);
  const raster = makeRaster(Math.max(WINDOW_W, 264) + 2 * pad, Math.max(height, 256) + 2 * pad);
  if (!options.bare) blit(raster, renderWindow(options), pad, pad);

  const sheets = [options.base, ...(options.overlays ?? [])];
  const spacers = options.spacers ?? NEXT_SPACERS;

  // Recreate the title's flat run and replay it, rather than shortcutting to "they all
  // land at the base origin" — the point of the preview is showing what wrong numbers do.
  let flat = spacerString(options.shift, spacers);
  let drawn: number | null = null;
  const byCodepoint = new Map<number, DrawnSheet>();

  for (const sheet of sheets) {
    if (sheet === null) continue;
    byCodepoint.set(sheet.codepoint, sheet);
    if (drawn !== null) flat += spacerString(-drawn, spacers);
    flat += String.fromCodePoint(sheet.codepoint);
    drawn = sheet.advance;
  }

  for (const { codepoint, origin } of originsOf(flat, (cp) => byCodepoint.get(cp)!.advance, spacers)) {
    const sheet = byCodepoint.get(codepoint)!;
    blit(raster, sheet.texture, pad + TITLE_X + origin, pad + SHEET_TO_WINDOW_Y - sheet.ascent);
  }

  return raster;
}
