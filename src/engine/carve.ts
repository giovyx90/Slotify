// SPDX-License-Identifier: GPL-3.0-or-later
import type { Rect } from "./geometry";
import { CELL, COLS, GRID_X, GRID_Y, WINDOW_W, hotbarY, playerInvY, windowHeight } from "./geometry";

/**
 * Carving the window itself: every pixel of the chest window belongs to exactly one
 * **region tile** — a container cell, an inventory cell, the hotbar strip, the top
 * band, the gap band, or a side margin. Tapping a region with the erase tool punches a
 * fully transparent hole there, and the window's own edge and bevel redraw dynamically
 * around whatever shape is left.
 *
 * Regions rather than a bare 18px lattice because the player-inventory rows sit 14px
 * off the container grid — lattice-aligned holes would cut slots in half.
 */

/** `null` outside the window. Keys look like `con:2:4`, `inv:0:8`, `top:0:-1`. */
export function regionKeyAt(x: number, y: number, rows: number): string | null {
  if (x < 0 || x >= WINDOW_W || y < 0 || y >= windowHeight(rows)) return null;

  const col = x < GRID_X - 1 ? -1 : x >= GRID_X - 1 + COLS * CELL ? COLS : Math.floor((x - (GRID_X - 1)) / CELL);
  const invY = playerInvY(rows) - 1;
  const hotY = hotbarY(rows) - 1;

  if (y < GRID_Y - 1) return `top:0:${col}`;
  if (y < GRID_Y - 1 + rows * CELL) return `con:${Math.floor((y - (GRID_Y - 1)) / CELL)}:${col}`;
  if (y < invY) return `gap:0:${col}`;
  if (y < invY + 3 * CELL) return `inv:${Math.floor((y - invY) / CELL)}:${col}`;
  return `hot:0:${col}`;
}

/** The pixel rectangle of one region, for editor overlays. */
export function regionRect(key: string, rows: number): Rect {
  const [band, rowText, colText] = key.split(":") as [string, string, string];
  const row = Number(rowText);
  const col = Number(colText);

  const x = col < 0 ? 0 : col >= COLS ? GRID_X - 1 + COLS * CELL : GRID_X - 1 + col * CELL;
  const w = col < 0 ? GRID_X - 1 : col >= COLS ? WINDOW_W - (GRID_X - 1 + COLS * CELL) : CELL;
  const invY = playerInvY(rows) - 1;
  const hotY = hotbarY(rows) - 1;

  switch (band) {
    case "top":
      return { x, y: 0, w, h: GRID_Y - 1 };
    case "con":
      return { x, y: GRID_Y - 1 + row * CELL, w, h: CELL };
    case "gap":
      return { x, y: GRID_Y - 1 + rows * CELL, w, h: invY - (GRID_Y - 1 + rows * CELL) };
    case "inv":
      return { x, y: invY + row * CELL, w, h: CELL };
    default:
      return { x, y: hotY, w, h: windowHeight(rows) - hotY };
  }
}
