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

/** Every region of a window with `rows` container rows, top band down to the hotbar. */
export function allRegionKeys(rows: number): string[] {
  const keys: string[] = [];
  const band = (name: string, row: number): void => {
    for (let col = -1; col <= COLS; col++) keys.push(`${name}:${row}:${col}`);
  };
  band("top", 0);
  for (let row = 0; row < rows; row++) band("con", row);
  band("gap", 0);
  for (let row = 0; row < 3; row++) band("inv", row);
  band("hot", 0);
  return keys;
}

/**
 * Every region whose box meets the rectangle between two window points — what a
 * shift-drag with the erase tool cuts. Region boxes, not the pixels under the pointer:
 * brushing a slot's corner takes the whole slot, never a sliver of one.
 */
export function regionKeysIn(
  a: { x: number; y: number },
  b: { x: number; y: number },
  rows: number,
): string[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);

  return allRegionKeys(rows).filter((key) => {
    const box = regionRect(key, rows);
    return box.x <= x1 && box.x + box.w > x0 && box.y <= y1 && box.y + box.h > y0;
  });
}
