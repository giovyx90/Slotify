// SPDX-License-Identifier: GPL-3.0-or-later
import { MARKER_ARM, solveTitleOrigin } from "./calibrate";
import type { ContainerProfile } from "./containers";
import { WELL } from "./geometry";
import { WELL_FILL, WELL_SHADOW } from "./paint";
import type { Raster } from "./raster";

/**
 * Reading a calibration out of a screenshot, with nothing typed.
 *
 * The first version of this asked for six numbers: the window's rectangle and the
 * marker's position, in screenshot pixels, measured by hand. That is a form for whoever
 * wrote it. An artist takes a screenshot and drops it in, and the two things that have to
 * be found in it are both findable:
 *
 * - **The window**, because the client draws the viewer's inventory from the container's
 *   own texture, and Slotify has already measured where those slots are. Find one slot
 *   well in the screenshot, and the window's corner follows by subtraction. Every well
 *   votes; the origin most of them agree on is the answer, so an item in a slot or a
 *   hovered highlight costs one vote instead of the result.
 * - **The marker**, because it is magenta and nothing else in a Minecraft screen is.
 *
 * The GUI scale falls out of the same vote: at the wrong scale the wells disagree with
 * each other, at the right one they all name the same corner.
 */

/** Magenta: `calibrationSheet` draws in it, and no vanilla screen contains it. */
const MARKER_RGB = [255, 0, 255] as const;

export interface Point {
  x: number;
  y: number;
}

export interface WindowLocation extends Point {
  /** The integer GUI scale the screenshot was taken at. */
  scale: number;
  /** How many slot wells agreed on this corner. */
  votes: number;
}

function at(raster: Raster, x: number, y: number): number {
  return (y * raster.width + x) * 4;
}

function isColour(raster: Raster, x: number, y: number, rgb: readonly number[]): boolean {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return false;
  const i = at(raster, x, y);
  return (
    raster.data[i + 3]! === 255 &&
    raster.data[i]! === rgb[0] &&
    raster.data[i + 1]! === rgb[1] &&
    raster.data[i + 2]! === rgb[2]
  );
}

/**
 * Slot wells drawn at an integer GUI scale.
 *
 * The same signature `detect.ts` uses on a texture, multiplied: a 16·s square of the well
 * grey with the dark bevel along the row above and the column left of it. Minecraft
 * scales its interface by whole-pixel repetition and never smooths, so a well at scale 3
 * is exactly the scale-1 well with every pixel tripled.
 */
export function detectScaledWells(raster: Raster, scale: number): Point[] {
  const side = WELL * scale;
  const found: Point[] = [];

  for (let y = scale; y <= raster.height - side; y++) {
    for (let x = scale; x <= raster.width - side; x++) {
      // Cheapest discriminators first: almost every position dies on one of these three.
      if (!isColour(raster, x - 1, y, WELL_SHADOW)) continue;
      if (!isColour(raster, x, y - 1, WELL_SHADOW)) continue;
      if (!isColour(raster, x, y, WELL_FILL)) continue;

      let filled = true;
      for (let dy = 0; dy < side && filled; dy++) {
        for (let dx = 0; dx < side && filled; dx++) {
          if (!isColour(raster, x + dx, y + dy, WELL_FILL)) filled = false;
        }
      }
      if (!filled) continue;

      let bevelled = true;
      for (let i = 0; i < side && bevelled; i++) {
        if (!isColour(raster, x + i, y - 1, WELL_SHADOW)) bevelled = false;
        if (!isColour(raster, x - 1, y + i, WELL_SHADOW)) bevelled = false;
      }
      if (bevelled) found.push({ x, y });
    }
  }

  return found;
}

/**
 * Where the container's window sits in the screenshot, and at what GUI scale.
 *
 * Needs at least three wells agreeing. Two could be a coincidence in a screen full of
 * grey; three at an 18·s pitch is the client's own inventory and nothing else.
 */
export function locateWindow(screenshot: Raster, profile: ContainerProfile): WindowLocation | null {
  const known = [...profile.slots, ...profile.inventory];
  if (known.length === 0) return null;

  let best: WindowLocation | null = null;

  for (const scale of [4, 3, 2, 1]) {
    if (profile.windowW * scale > screenshot.width) continue;
    const wells = detectScaledWells(screenshot, scale);
    if (wells.length === 0) continue;

    const votes = new Map<string, number>();
    for (const well of wells) {
      for (const slot of known) {
        const x = well.x - scale * slot.x;
        const y = well.y - scale * slot.y;
        if (x < 0 || y < 0) continue;
        const key = `${x},${y}`;
        votes.set(key, (votes.get(key) ?? 0) + 1);
      }
    }

    for (const [key, count] of votes) {
      if (count < 3) continue;
      // A tie goes to the larger scale: the small-scale detector can match the top-left
      // corner of a bigger well, but its votes never line up as densely.
      if (best && count <= best.votes) continue;
      const [x, y] = key.split(",").map(Number) as [number, number];
      best = { x, y, scale, votes: count };
    }
  }

  return best;
}

interface Cluster {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: number;
}

/** Connected runs of the marker colour, as bounding boxes. */
export function findMarkerClusters(raster: Raster): Cluster[] {
  const { width, height } = raster;
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  const clusters: Cluster[] = [];

  const magenta = (index: number): boolean =>
    isColour(raster, index % width, (index / width) | 0, MARKER_RGB);

  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !magenta(start)) continue;

    queue.length = 0;
    queue.push(start);
    seen[start] = 1;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let pixels = 0;

    while (queue.length > 0) {
      const index = queue.pop()!;
      const x = index % width;
      const y = (index / width) | 0;
      pixels++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;

      const push = (next: number, nx: number, ny: number): void => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        if (seen[next] || !magenta(next)) return;
        seen[next] = 1;
        queue.push(next);
      };
      push(index - 1, x - 1, y);
      push(index + 1, x + 1, y);
      push(index - width, x, y - 1);
      push(index + width, x, y + 1);
    }

    clusters.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, pixels });
  }

  return clusters;
}

export type ScreenshotCalibration =
  | { ok: true; origin: { x: number; k: number }; scale: number; window: WindowLocation }
  | { ok: false; problem: string };

/**
 * Everything, from one dropped image.
 *
 * Each failure names what to do about it. "Could not read this screenshot" is the message
 * that sends somebody back to typing numbers; "the marker is not in this shot — is the
 * calibration sheet still registered?" is the one that gets them to the answer.
 */
export function calibrateFromScreenshot(
  screenshot: Raster,
  profile: ContainerProfile,
  marker: Point,
  ascent: number,
): ScreenshotCalibration {
  const window = locateWindow(screenshot, profile);
  if (!window) {
    return {
      ok: false,
      problem:
        "no slot grid found — the screenshot must show this screen with the player's inventory visible, at a whole GUI scale",
    };
  }

  const side = (2 * MARKER_ARM + 1) * window.scale;
  const inside = (cluster: Cluster): boolean =>
    cluster.x >= window.x - side &&
    cluster.y >= window.y - side &&
    cluster.x <= window.x + profile.windowW * window.scale + side &&
    cluster.y <= window.y + profile.windowH * window.scale + side;

  const crosses = findMarkerClusters(screenshot)
    .filter(inside)
    .filter((cluster) => cluster.w === side && cluster.h === side);

  if (crosses.length === 0) {
    return { ok: false, problem: "no marker in this screenshot — is the calibration sheet the screen's title?" };
  }
  if (crosses.length > 1) {
    return { ok: false, problem: `${crosses.length} markers in this screenshot; there should be one` };
  }

  const cross = crosses[0]!;
  const solved = solveTitleOrigin({
    marker,
    ascent,
    window: { w: profile.windowW, h: profile.windowH },
    windowRect: {
      x: window.x,
      y: window.y,
      w: profile.windowW * window.scale,
      h: profile.windowH * window.scale,
    },
    // The cluster's corner plus its arm is the centre pixel's own block corner: exact
    // integers, where a centroid would land on a half pixel at even scales.
    markerAt: { x: cross.x + MARKER_ARM * window.scale, y: cross.y + MARKER_ARM * window.scale },
  });

  if (!solved.ok) return { ok: false, problem: solved.problem };
  return { ok: true, origin: solved.origin, scale: solved.scale, window };
}

/** Nearest-neighbour magnification, the way the client scales its own interface. */
export function upscale(raster: Raster, scale: number): Raster {
  const width = raster.width * scale;
  const height = raster.height * scale;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = at(raster, (x / scale) | 0, (y / scale) | 0);
      data.set(raster.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
