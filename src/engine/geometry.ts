// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The chest-window geometry, from `tools/gui-templates/make_gui_template.py` — the one
 * derivation in the NEXT repository that is cross-checked against a shipped screen.
 *
 * Origin is the canonical **(8,18)**: `AbstractContainerScreen` places slot 0's 16×16
 * item area at `leftPos+8, topPos+18`. (The farm templates' (7,17) is that same slot's
 * 1px bevel origin and is a known off-by-one; importers tolerate it, nothing else does.)
 *
 * The one server-measured constant: a title glyph's row `sheetY` lands on window row
 * `sheetY − ascent + 13`, so the ascent that puts container row r's interior where it
 * belongs is `sheetY − 5 − 18·r`.
 */

export const SHEET_CANVAS = 256;
export const WINDOW_W = 176;
export const CELL = 18;
export const WELL = 16;
export const COLS = 9;
export const GRID_X = 8;
export const GRID_Y = 18;
export const GAP_BEFORE_PLAYER_INV = 14;
export const GAP_BEFORE_HOTBAR = 4;
export const BOTTOM_MARGIN = 6;
/** windowY = sheetY − ascent + SHEET_TO_WINDOW_Y. */
export const SHEET_TO_WINDOW_Y = 13;
/** Where the client puts a title's first pixel, relative to the window. */
export const TITLE_X = 8;

/** 114 + 18·rows: 222 for the classic 6-row screen. */
export function windowHeight(rows: number): number {
  return GRID_Y + rows * CELL + GAP_BEFORE_PLAYER_INV + 3 * CELL + GAP_BEFORE_HOTBAR + CELL + BOTTOM_MARGIN;
}

export function playerInvY(rows: number): number {
  return GRID_Y + rows * CELL + GAP_BEFORE_PLAYER_INV;
}

export function hotbarY(rows: number): number {
  return playerInvY(rows) + 3 * CELL + GAP_BEFORE_HOTBAR;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Slot (row, col)'s 16×16 item area in window coordinates. */
export function slotWindowRect(row: number, col: number): Rect {
  return { x: GRID_X + CELL * col, y: GRID_Y + CELL * row, w: WELL, h: WELL };
}

/** The same slot's rectangle on a sheet drawn with the given ascent. */
export function slotSheetRect(row: number, col: number, ascent: number): Rect {
  return { x: GRID_X + CELL * col, y: ascent + 5 + CELL * row, w: WELL, h: WELL };
}

/** The ascent a sheet needs, given the sheet row its container-row-r interior starts on. */
export function ascentForCell(sheetY: number, row: number): number {
  return sheetY - 5 - CELL * row;
}

/** Raw slot index (as `InventoryClickEvent.getRawSlot` reports it) for a container slot. */
export function slotIndex(row: number, col: number): number {
  return row * COLS + col;
}
