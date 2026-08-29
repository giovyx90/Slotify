// SPDX-License-Identifier: GPL-3.0-or-later
import type { Rect } from "./geometry";
import { rect, type BevelSet, type PlateStyle, type RGBA } from "./paint";
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

/**
 * The lattice covers the whole 256 sheet, not just the window — an infobox can sit
 * beside or below the GUI, Coreline-style. Cells that would overflow the sheet canvas
 * are refused (12 is the last full 18px cell on a 256 canvas).
 */
export function cellAt(x: number, y: number): TileCell | null {
  const col = Math.floor((x - TILE_X0) / TILE);
  const row = Math.floor((y - TILE_Y0) / TILE);
  return row >= 0 && col >= 0 && row <= 12 && col <= 12 ? [row, col] : null;
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
  style: PlateStyle = "single",
): void {
  const claimed = new Set(cells.map(([row, col]) => key(row, col)));
  const top = style === "flat" ? bevels.edge : pressed ? bevels.dark : bevels.light;
  const bottom = style === "flat" ? bevels.edge : pressed ? bevels.light : bevels.dark;
  // A wide region wants a deeper edge; one pixel across four merged cells disappears.
  const depth = style === "double" ? 2 : 1;

  for (const [row, col] of cells) {
    const cell = tileRect(row, col);
    rect(raster, cell.x, cell.y + offsetY, cell.w, cell.h, fill);
  }

  // Dark (facing) edges first, light after — top-left dominance like a vanilla plate.
  for (let ring = 0; ring < depth; ring++) {
    for (const [row, col] of cells) {
      const cell = tileRect(row, col);
      const y = cell.y + offsetY;
      if (!claimed.has(key(row + 1, col))) {
        for (let x = cell.x; x < cell.x + cell.w; x++) put(raster, x, y + cell.h - 1 - ring, bottom);
      }
      if (!claimed.has(key(row, col + 1))) {
        for (let dy = 0; dy < cell.h; dy++) put(raster, cell.x + cell.w - 1 - ring, y + dy, bottom);
      }
    }
    for (const [row, col] of cells) {
      const cell = tileRect(row, col);
      const y = cell.y + offsetY;
      if (!claimed.has(key(row - 1, col))) {
        // A raised plate leaves its top-right pixel to the dark edge — but only at the
        // plate's real end. Shortening every cell instead punched a hole in the
        // highlight at each seam, which is what made one wide button read as several.
        const ends = !claimed.has(key(row, col + 1));
        for (let x = cell.x; x < cell.x + cell.w - (ends ? 1 : 0); x++) put(raster, x, y + ring, top);
      }
      if (!claimed.has(key(row, col - 1))) {
        const ends = !claimed.has(key(row + 1, col));
        for (let dy = 0; dy < cell.h - (ends ? 1 : 0); dy++) put(raster, cell.x + ring, y + dy, top);
      }
    }
  }
}

/**
 * The lattice cells a free-standing box covers — how a plate dragged to any size is
 * snapped back onto the grid when it turns into connectable tiles.
 */
export function cellsCovering(box: Rect): TileCell[] {
  const colStart = Math.max(0, Math.round((box.x - TILE_X0) / TILE));
  const rowStart = Math.max(0, Math.round((box.y - TILE_Y0) / TILE));
  const colEnd = Math.max(colStart, Math.min(12, Math.round((box.x + box.w - TILE_X0) / TILE) - 1));
  const rowEnd = Math.max(rowStart, Math.min(12, Math.round((box.y + box.h - TILE_Y0) / TILE) - 1));

  const cells: TileCell[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) cells.push([row, col]);
  }
  return cells;
}
