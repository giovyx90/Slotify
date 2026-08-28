// SPDX-License-Identifier: GPL-3.0-or-later
import type { Raster } from "./raster";

/**
 * Low-level pixel painting shared by the chest renderer and the component library.
 * The palette is the vanilla container grey family — the same numbers
 * `make_gui_template.py` uses and `impliedAscent` detects.
 */

export type RGBA = [number, number, number, number];

export const PANEL: RGBA = [198, 198, 198, 255];
export const PANEL_LIGHT: RGBA = [255, 255, 255, 255];
export const PANEL_DARK: RGBA = [85, 85, 85, 255];
export const PANEL_EDGE: RGBA = [55, 55, 55, 255];
export const WELL_FILL: RGBA = [139, 139, 139, 255];
export const WELL_SHADOW: RGBA = [55, 55, 55, 255];
export const WELL_LIGHT: RGBA = [255, 255, 255, 255];

export function put(raster: Raster, x: number, y: number, colour: RGBA): void {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return;
  raster.data.set(colour, (y * raster.width + x) * 4);
}

export function rect(raster: Raster, x: number, y: number, w: number, h: number, colour: RGBA): void {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) put(raster, x + dx, y + dy, colour);
}

export function outline(raster: Raster, x: number, y: number, w: number, h: number, colour: RGBA): void {
  for (let dx = 0; dx < w; dx++) {
    put(raster, x + dx, y, colour);
    put(raster, x + dx, y + h - 1, colour);
  }
  for (let dy = 0; dy < h; dy++) {
    put(raster, x, y + dy, colour);
    put(raster, x + w - 1, y + dy, colour);
  }
}

/**
 * One vanilla slot with its 16×16 well interior at (wellX, wellY): shadow above/left,
 * light below/right — the exact three-part structure `impliedAscent` recognises.
 */
export function drawSlotWell(raster: Raster, wellX: number, wellY: number): void {
  rect(raster, wellX, wellY, 16, 16, WELL_FILL);
  for (let i = -1; i < 16; i++) {
    put(raster, wellX + i, wellY - 1, WELL_SHADOW);
    put(raster, wellX - 1, wellY + i, WELL_SHADOW);
    put(raster, wellX + i + 1, wellY + 16, WELL_LIGHT);
    put(raster, wellX + 16, wellY + i, WELL_LIGHT);
  }
}

/** A raised plate — light on top/left, dark on bottom/right: reads as a button. */
export function drawRaised(raster: Raster, x: number, y: number, w: number, h: number, fill: RGBA = PANEL): void {
  rect(raster, x, y, w, h, fill);
  for (let dx = 0; dx < w - 1; dx++) {
    put(raster, x + dx, y, PANEL_LIGHT);
    put(raster, x + dx + 1, y + h - 1, PANEL_DARK);
  }
  for (let dy = 0; dy < h - 1; dy++) {
    put(raster, x, y + dy, PANEL_LIGHT);
    put(raster, x + w - 1, y + dy + 1, PANEL_DARK);
  }
}

/** The same plate pressed in — bevel inverted. */
export function drawInset(raster: Raster, x: number, y: number, w: number, h: number, fill: RGBA = WELL_FILL): void {
  rect(raster, x, y, w, h, fill);
  for (let dx = 0; dx < w - 1; dx++) {
    put(raster, x + dx, y, WELL_SHADOW);
    put(raster, x + dx + 1, y + h - 1, WELL_LIGHT);
  }
  for (let dy = 0; dy < h - 1; dy++) {
    put(raster, x, y + dy, WELL_SHADOW);
    put(raster, x + w - 1, y + dy + 1, WELL_LIGHT);
  }
}
