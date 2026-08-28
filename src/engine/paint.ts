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

export interface BevelSet {
  light: RGBA;
  dark: RGBA;
  edge: RGBA;
}

/** The vanilla grey bevels — what an uncoloured plate uses. */
export const VANILLA_BEVELS: BevelSet = { light: PANEL_LIGHT, dark: PANEL_DARK, edge: PANEL_EDGE };

/**
 * Pixel-art bevels for a custom fill: never plain white and black. The highlight
 * lightens and hue-shifts toward warm yellow, the shadow darkens and shifts toward
 * blue-violet — the classic hue-shift rule, without which a recoloured button reads as
 * a grey one with paint spilled on it. A grey fill degrades to the vanilla ramp.
 */
export function hueShiftedBevels(fill: RGBA): BevelSet {
  const [h, s, l] = rgbToHsl(fill[0], fill[1], fill[2]);

  const make = (dl: number, targetHue: number, spin: number, ds: number): RGBA => {
    const hue = s < 0.05 ? h : shiftHueToward(h, targetHue, spin);
    const [r, g, b] = hslToRgb(hue, clamp01(s + ds), clamp01(l + dl));
    return [r, g, b, 255];
  };

  return {
    light: make(+0.24, 60, 18, -0.05),
    dark: make(-0.26, 250, 16, +0.08),
    edge: make(-0.4, 250, 22, +0.08),
  };
}

/** A raised plate — light on top/left, dark on bottom/right: reads as a button. */
export function drawRaised(
  raster: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: RGBA = PANEL,
  bevels: BevelSet = VANILLA_BEVELS,
): void {
  rect(raster, x, y, w, h, fill);
  for (let dx = 0; dx < w - 1; dx++) {
    put(raster, x + dx, y, bevels.light);
    put(raster, x + dx + 1, y + h - 1, bevels.dark);
  }
  for (let dy = 0; dy < h - 1; dy++) {
    put(raster, x, y + dy, bevels.light);
    put(raster, x + w - 1, y + dy + 1, bevels.dark);
  }
}

/** The same plate pressed in — bevel inverted. */
export function drawInset(
  raster: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: RGBA = WELL_FILL,
  bevels?: BevelSet,
): void {
  const set = bevels ?? { light: WELL_LIGHT, dark: WELL_SHADOW, edge: PANEL_EDGE };
  rect(raster, x, y, w, h, fill);
  for (let dx = 0; dx < w - 1; dx++) {
    put(raster, x + dx, y, set.dark);
    put(raster, x + dx + 1, y + h - 1, set.light);
  }
  for (let dy = 0; dy < h - 1; dy++) {
    put(raster, x, y + dy, set.dark);
    put(raster, x + w - 1, y + dy + 1, set.light);
  }
}

// --- colour space plumbing ----------------------------------------------------------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Moves a hue along the shortest arc toward a target, by at most `amount` degrees. */
export function shiftHueToward(hue: number, target: number, amount: number): number {
  let delta = ((target - hue + 540) % 360) - 180;
  delta = Math.sign(delta) * Math.min(Math.abs(delta), amount);
  return (hue + delta + 360) % 360;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;

  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const grey = Math.round(l * 255);
    return [grey, grey, grey];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let x = ((t % 360) + 360) % 360;
    if (x < 60) return p + ((q - p) * x) / 60;
    if (x < 180) return q;
    if (x < 240) return p + ((q - p) * (240 - x)) / 60;
    return p;
  };

  return [
    Math.round(channel(h + 120) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 120) * 255),
  ];
}
