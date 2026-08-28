// SPDX-License-Identifier: GPL-3.0-or-later
import {
  CELL,
  COLS,
  GRID_X,
  GRID_Y,
  SHEET_TO_WINDOW_Y,
  TITLE_X,
  WELL,
  WINDOW_W,
  hotbarY,
  playerInvY,
  windowHeight,
} from "./geometry";
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

const PANEL: RGBA = [198, 198, 198, 255];
const PANEL_LIGHT: RGBA = [255, 255, 255, 255];
const PANEL_DARK: RGBA = [85, 85, 85, 255];
const PANEL_EDGE: RGBA = [55, 55, 55, 255];
const WELL_FILL: RGBA = [139, 139, 139, 255];
const WELL_SHADOW: RGBA = [55, 55, 55, 255];
const WELL_LIGHT: RGBA = [255, 255, 255, 255];

type RGBA = [number, number, number, number];

function put(raster: Raster, x: number, y: number, colour: RGBA): void {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return;
  raster.data.set(colour, (y * raster.width + x) * 4);
}

function rect(raster: Raster, x: number, y: number, w: number, h: number, colour: RGBA): void {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) put(raster, x + dx, y + dy, colour);
}

/** One slot with its 16×16 well at (wellX, wellY): shadow above/left, light below/right. */
function drawSlot(raster: Raster, wellX: number, wellY: number): void {
  rect(raster, wellX, wellY, WELL, WELL, WELL_FILL);
  for (let i = -1; i < WELL; i++) {
    put(raster, wellX + i, wellY - 1, WELL_SHADOW);
    put(raster, wellX - 1, wellY + i, WELL_SHADOW);
    put(raster, wellX + i + 1, wellY + WELL, WELL_LIGHT);
    put(raster, wellX + WELL, wellY + i, WELL_LIGHT);
  }
}

export interface RenderOptions {
  rows: number;
  /** Hide the player inventory / hotbar wells, as `PaintedInventoryHook` does. */
  hideViewerInventory?: boolean;
}

/** The bare window, top-left anchored, on a canvas exactly `WINDOW_W × windowHeight`. */
export function renderWindow(options: RenderOptions): Raster {
  const height = windowHeight(options.rows);
  const raster = makeRaster(WINDOW_W, height);

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

  for (let index = 0; index < COLS * options.rows; index++) {
    drawSlot(raster, GRID_X + (index % COLS) * CELL, GRID_Y + Math.floor(index / COLS) * CELL);
  }

  if (!options.hideViewerInventory) {
    const invY = playerInvY(options.rows);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < COLS; col++) {
        drawSlot(raster, GRID_X + col * CELL, invY + row * CELL);
      }
    }
    const hbY = hotbarY(options.rows);
    for (let col = 0; col < COLS; col++) drawSlot(raster, GRID_X + col * CELL, hbY);
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
}

/**
 * The full preview: window plus every sheet the title would draw, each at
 * `(TITLE_X + origin, SHEET_TO_WINDOW_Y − ascent)` — so an advance bug displaces
 * overlays here exactly as it would in game.
 */
export function renderScreen(options: ComposeOptions): Raster {
  const pad = options.pad ?? 0;
  const window = renderWindow(options);
  const raster = makeRaster(
    Math.max(window.width, 264) + 2 * pad,
    Math.max(window.height, 256) + 2 * pad,
  );
  blit(raster, window, pad, pad);

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
