// SPDX-License-Identifier: GPL-3.0-or-later
import type { Rect } from "./geometry";
import { rect, type BevelSet, type RGBA } from "./paint";
import { put } from "./paint";
import type { Raster } from "./raster";

/**
 * Connectable tiles — the NXMenu editing model. The window is an 18px lattice whose
 * cell borders coincide with the slot grid (origin (7,17): one pixel out from the slot
 * interiors at (8,18)). Tapping a cell claims it; adjacent claimed cells merge, and the
 * bevel is drawn around the **outline of the merged region**, so two cells side by side
 * read as one wide button, not two buttons touching.
 */

export const TILE = 18;
export const TILE_X0 = 7;
export const TILE_Y0 = 17;

export type TileCell = [number, number];

export function tileRect(row: number, col: number): Rect {
  return { x: TILE_X0 + TILE * col, y: TILE_Y0 + TILE * row, w: TILE, h: TILE };
}

export function cellAt(x: number, y: number): TileCell | null {
  const col = Math.floor((x - TILE_X0) / TILE);
  const row = Math.floor((y - TILE_Y0) / TILE);
  return row >= 0 && col >= 0 ? [row, col] : null;
}

export function regionBBox(cells: readonly TileCell[]): Rect {
  const rows = cells.map(([row]) => row);
  const cols = cells.map(([, col]) => col);
  const minRow = Math.min(...rows);
  const minCol = Math.min(...cols);
  return {
    x: TILE_X0 + TILE * minCol,
    y: TILE_Y0 + TILE * minRow,
    w: TILE * (Math.max(...cols) - minCol + 1),
    h: TILE * (Math.max(...rows) - minRow + 1),
  };
}

const key = (row: number, col: number): string => `${row},${col}`;

/**
 * The merged-region button: fill every cell, then bevel only the edges that face out
 * of the region — light above/left, dark below/right (swapped when pressed).
 */
export function drawTileRegion(
  raster: Raster,
  cells: readonly TileCell[],
  fill: RGBA,
  bevels: BevelSet,
  pressed: boolean,
  offsetY = 0,
): void {
  const claimed = new Set(cells.map(([row, col]) => key(row, col)));
  const top = pressed ? bevels.dark : bevels.light;
  const bottom = pressed ? bevels.light : bevels.dark;

  for (const [row, col] of cells) {
    const cell = tileRect(row, col);
    rect(raster, cell.x, cell.y + offsetY, cell.w, cell.h, fill);
  }

  // Dark (facing) edges first, light after — top-left dominance like a vanilla plate.
  for (const [row, col] of cells) {
    const cell = tileRect(row, col);
    const y = cell.y + offsetY;
    if (!claimed.has(key(row + 1, col))) {
      for (let x = cell.x; x < cell.x + cell.w; x++) put(raster, x, y + cell.h - 1, bottom);
    }
    if (!claimed.has(key(row, col + 1))) {
      for (let dy = 0; dy < cell.h; dy++) put(raster, cell.x + cell.w - 1, y + dy, bottom);
    }
  }
  for (const [row, col] of cells) {
    const cell = tileRect(row, col);
    const y = cell.y + offsetY;
    if (!claimed.has(key(row - 1, col))) {
      for (let x = cell.x; x < cell.x + cell.w - 1; x++) put(raster, x, y, top);
    }
    if (!claimed.has(key(row, col - 1))) {
      for (let dy = 0; dy < cell.h - 1; dy++) put(raster, cell.x, y + dy, top);
    }
  }
}
