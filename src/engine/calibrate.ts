// SPDX-License-Identifier: GPL-3.0-or-later
import type { TitleOrigin } from "./containers";
import { put, type RGBA } from "./paint";
import { makeRaster, type Raster } from "./raster";

/**
 * Measuring where a screen puts its title, by looking at one.
 *
 * `titleLabelX/Y` lives in client code. It is in no texture, no font file and no pack, so
 * Slotify cannot read it and must not guess it — a title origin borrowed from the chest
 * is how an anvil screen ends up a few pixels off with nothing in any log. It gets
 * measured instead, once per container, and then it is a fact forever:
 *
 *   1. `calibrationSheet()` draws a marker at a known sheet position.
 *   2. Register it at a known ascent, open that screen in game, take a screenshot.
 *   3. Point at the window's rectangle and at the marker in the screenshot.
 *   4. `solveTitleOrigin` does the arithmetic.
 *
 * The two relations being solved are the same two the exporter already uses in reverse:
 * `windowX = origin.x + shift + sheetX` and `windowY = sheetY − ascent + origin.k`. The
 * calibration title carries no negative-space run, so `shift` is zero and each has one
 * unknown left.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The marker's arms, in pixels, either side of its centre. */
export const MARKER_ARM = 4;

const MARKER_COLOUR: RGBA = [255, 0, 255, 255];

/**
 * A sheet carrying nothing but a cross at `(x, y)`.
 *
 * Magenta and cross-shaped on purpose: it has to be findable by eye at GUI scale 1 in a
 * screenshot of a screen nobody has drawn yet, and its centre has to be unambiguous —
 * a square's centre is a judgement call, a cross's is where the arms meet.
 */
export function calibrationSheet(x: number, y: number, size = 256): Raster {
  if (x - MARKER_ARM < 0 || y - MARKER_ARM < 0 || x + MARKER_ARM >= size || y + MARKER_ARM >= size) {
    throw new Error(`marker at (${x},${y}) does not fit a ${size}×${size} sheet with ${MARKER_ARM}px arms`);
  }
  const raster = makeRaster(size, size);
  for (let i = -MARKER_ARM; i <= MARKER_ARM; i++) {
    put(raster, x + i, y, MARKER_COLOUR);
    put(raster, x, y + i, MARKER_COLOUR);
  }
  return raster;
}

/**
 * The integer GUI scale a screenshot was taken at, from the window's size in it.
 *
 * Both dimensions have to agree, and the scale has to be a whole number — Minecraft only
 * ever draws the window at 1×, 2×, 3× or 4×. A rectangle that divides badly means the
 * window was pointed at loosely, and a scale rounded off there becomes a title origin
 * wrong by a pixel, which is the exact failure this is meant to prevent.
 */
export function guiScale(windowRect: Rect, windowW: number, windowH: number): number | null {
  if (windowW <= 0 || windowH <= 0) return null;
  const byWidth = windowRect.w / windowW;
  const byHeight = windowRect.h / windowH;
  if (!Number.isInteger(byWidth) || byWidth !== byHeight) return null;
  if (byWidth < 1 || byWidth > 8) return null;
  return byWidth;
}

export interface CalibrationInput {
  /** Where the marker's centre was drawn on the calibration sheet. */
  marker: { x: number; y: number };
  /** The ascent the calibration sheet's provider declared. */
  ascent: number;
  /** The container's window size, from its profile. */
  window: { w: number; h: number };
  /** The window's rectangle within the screenshot, in screenshot pixels. */
  windowRect: Rect;
  /** Where the marker's centre appears in the screenshot, in screenshot pixels. */
  markerAt: { x: number; y: number };
}

export type Calibration =
  | { ok: true; origin: TitleOrigin; scale: number }
  | { ok: false; problem: string };

/**
 * Solve for the container's title origin.
 *
 * Fails loudly rather than rounding: a marker that does not land on a whole window pixel
 * means the screenshot was pointed at wrongly, and half a pixel of error here is a screen
 * that is off by one on every future design.
 */
export function solveTitleOrigin(input: CalibrationInput): Calibration {
  const scale = guiScale(input.windowRect, input.window.w, input.window.h);
  if (scale === null) {
    return {
      ok: false,
      problem: `the window rectangle is ${input.windowRect.w}×${input.windowRect.h}, which is not a whole multiple of ${input.window.w}×${input.window.h}`,
    };
  }

  const dx = (input.markerAt.x - input.windowRect.x) / scale;
  const dy = (input.markerAt.y - input.windowRect.y) / scale;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    return {
      ok: false,
      problem: `the marker sits ${dx.toFixed(2)}, ${dy.toFixed(2)} window pixels in — point at its centre pixel, not between pixels`,
    };
  }

  return {
    ok: true,
    scale,
    origin: {
      x: dx - input.marker.x,
      k: dy - input.marker.y + input.ascent,
    },
  };
}

/** Where a sheet pixel lands in the window, once the origin is known. */
export function sheetToWindow(
  origin: TitleOrigin,
  ascent: number,
  shift: number,
  sheetX: number,
  sheetY: number,
): { x: number; y: number } {
  return { x: origin.x + shift + sheetX, y: sheetY - ascent + origin.k };
}
