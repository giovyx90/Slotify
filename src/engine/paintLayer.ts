// SPDX-License-Identifier: GPL-3.0-or-later
import { decodePng, encodePng } from "./png";
import { makeRaster, type Raster } from "./raster";
import type { RGBA } from "./paint";

/**
 * Hand-painted pixels, as an element like any other.
 *
 * The pixels live inside the project file, base64 of a PNG. A sidecar file would diff
 * better, but the history is a snapshot of the serialised project — so pixels kept
 * outside it would be pixels undo cannot reach, a draft cannot save and copy-paste
 * cannot carry to another screen. For a design file that is the wrong trade.
 *
 * Everything here is pure and works on a `Raster` in the layer's own coordinates: the
 * caller subtracts the element's origin before asking.
 */

const DECODE_MEMO = new Map<string, Raster>();
const MEMO_LIMIT = 32;

export function blankLayer(width: number, height: number): Raster {
  return makeRaster(width, height);
}

function toBase64(bytes: Uint8Array): string {
  // In chunks: String.fromCharCode(...bytes) blows the argument limit on a real sheet.
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeLayer(raster: Raster): string {
  return toBase64(encodePng(raster));
}

/**
 * Decodes a stored layer, memoised on the string itself — the renderer is called on
 * every keystroke and a PNG decode per frame per layer would be felt.
 */
export function decodeLayer(text: string): Raster {
  const hit = DECODE_MEMO.get(text);
  if (hit) return hit;

  const raster = decodePng(fromBase64(text));
  if (DECODE_MEMO.size >= MEMO_LIMIT) DECODE_MEMO.delete(DECODE_MEMO.keys().next().value!);
  DECODE_MEMO.set(text, raster);
  return raster;
}

export function pixelAt(raster: Raster, x: number, y: number): RGBA | null {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null;
  const index = (y * raster.width + x) * 4;
  return [
    raster.data[index]!,
    raster.data[index + 1]!,
    raster.data[index + 2]!,
    raster.data[index + 3]!,
  ];
}

export function setPixel(raster: Raster, x: number, y: number, colour: RGBA): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  raster.data.set(colour, (y * raster.width + x) * 4);
}

/** A square nib, centred as well as an even size allows. */
export function stamp(raster: Raster, x: number, y: number, size: number, colour: RGBA): void {
  const half = Math.floor(size / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) setPixel(raster, x - half + dx, y - half + dy, colour);
  }
}

/** Bresenham, so a fast drag paints a line instead of a dotted trail. */
export function line(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const stepX = x < to.x ? 1 : -1;
  const stepY = y < to.y ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    points.push({ x, y });
    if (x === to.x && y === to.y) return points;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

/**
 * The corner a one-pixel brush should not have drawn.
 *
 * Dragging diagonally leaves L-shaped knees — three pixels where two would read as a
 * clean diagonal. Pixel-perfect mode drops the middle one, which is the difference
 * between a hand-drawn line and one that looks drawn by a mouse.
 */
export function isCorner(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean {
  return Math.abs(c.x - a.x) === 1 && Math.abs(c.y - a.y) === 1 && (b.x === a.x || b.y === a.y);
}

/** The mirrored twins of a point, for the X/Y symmetry toggles. */
export function mirrored(
  point: { x: number; y: number },
  width: number,
  height: number,
  mirrorX: boolean,
  mirrorY: boolean,
): { x: number; y: number }[] {
  const points = [point];
  const flipX = width - 1 - point.x;
  const flipY = height - 1 - point.y;
  if (mirrorX) points.push({ x: flipX, y: point.y });
  if (mirrorY) points.push({ x: point.x, y: flipY });
  if (mirrorX && mirrorY) points.push({ x: flipX, y: flipY });
  return points.filter(
    (candidate, index) =>
      points.findIndex((other) => other.x === candidate.x && other.y === candidate.y) === index,
  );
}

const sameColour = (a: RGBA | null, b: RGBA | null): boolean =>
  a != null && b != null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/**
 * Flood fill, four-neighbour, exact match. Filling with the colour already there is a
 * no-op rather than an infinite walk.
 */
export function floodFill(raster: Raster, x: number, y: number, colour: RGBA): number {
  const target = pixelAt(raster, x, y);
  if (target == null || sameColour(target, colour)) return 0;

  const stack: [number, number][] = [[x, y]];
  let filled = 0;
  while (stack.length > 0) {
    const [px, py] = stack.pop()!;
    if (!sameColour(pixelAt(raster, px, py), target)) continue;
    setPixel(raster, px, py, colour);
    filled++;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return filled;
}

/** Replaces one colour everywhere it appears — recolouring without reselecting. */
export function replaceColour(raster: Raster, from: RGBA, to: RGBA): number {
  let changed = 0;
  for (let index = 0; index < raster.data.length; index += 4) {
    const here: RGBA = [
      raster.data[index]!,
      raster.data[index + 1]!,
      raster.data[index + 2]!,
      raster.data[index + 3]!,
    ];
    if (!sameColour(here, from)) continue;
    raster.data.set(to, index);
    changed++;
  }
  return changed;
}

export function rectanglePoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  filled: boolean,
): { x: number; y: number }[] {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);

  const points: { x: number; y: number }[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const onEdge = x === left || x === right || y === top || y === bottom;
      if (filled || onEdge) points.push({ x, y });
    }
  }
  return points;
}

/** A midpoint ellipse inscribed in the dragged box — outline, or solid. */
export function ellipsePoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  filled: boolean,
): { x: number; y: number }[] {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  const centreX = (left + right) / 2;
  const centreY = (top + bottom) / 2;
  const radiusX = Math.max(0.5, (right - left) / 2);
  const radiusY = Math.max(0.5, (bottom - top) / 2);

  const points: { x: number; y: number }[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const nx = (x - centreX) / radiusX;
      const ny = (y - centreY) / radiusY;
      const inside = nx * nx + ny * ny <= 1;
      if (!inside) continue;
      if (filled) {
        points.push({ x, y });
        continue;
      }
      // On the outline when a four-neighbour is outside the ellipse.
      const edge = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].some(([ox, oy]) => {
        const ex = (ox! - centreX) / radiusX;
        const ey = (oy! - centreY) / radiusY;
        return ex * ex + ey * ey > 1;
      });
      if (edge) points.push({ x, y });
    }
  }
  return points;
}

/** A checkerboard of the chosen colour: the cheap gradient of pixel art. */
export function ditherPoints(
  points: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  return points.filter((point) => (point.x + point.y) % 2 === 0);
}
