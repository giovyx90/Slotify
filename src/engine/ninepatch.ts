// SPDX-License-Identifier: GPL-3.0-or-later
import { makeRaster, alphaAt, type Raster } from "./raster";

/**
 * Ninepatch drawing over a real skin texture: corners copied, edges and centre
 * **tiled** (never stretched — this is pixel art). This is how the NEXT infobox stays
 * exactly the artist's infobox at any size the tiles ask for.
 */

/** Crops a texture to its opaque bounding box — template PNGs carry empty margins. */
export function cropToOpaque(source: Raster): Raster {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (alphaAt(source, x, y) > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return makeRaster(1, 1);

  const out = makeRaster(maxX - minX + 1, maxY - minY + 1);
  for (let y = 0; y < out.height; y++) {
    const from = ((minY + y) * source.width + minX) * 4;
    out.data.set(source.data.subarray(from, from + out.width * 4), y * out.width * 4);
  }
  return out;
}

function copyRegion(
  target: Raster,
  source: Raster,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < sh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < sw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= target.width) continue;
      const si = ((sy + y) * source.width + (sx + x)) * 4;
      if (source.data[si + 3] === 0) continue;
      target.data.set(source.data.subarray(si, si + 4), (ty * target.width + tx) * 4);
    }
  }
}

export function drawNinepatch(
  target: Raster,
  skin: Raster,
  border: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const b = Math.min(border, Math.floor(Math.min(skin.width, skin.height) / 2) - 1);
  const innerW = skin.width - 2 * b;
  const innerH = skin.height - 2 * b;

  // Centre, tiled.
  for (let ty = b; ty < h - b; ty += innerH) {
    for (let tx = b; tx < w - b; tx += innerW) {
      copyRegion(target, skin, b, b, Math.min(innerW, w - b - tx), Math.min(innerH, h - b - ty), x + tx, y + ty);
    }
  }

  // Edges, tiled along their axis.
  for (let tx = b; tx < w - b; tx += innerW) {
    const span = Math.min(innerW, w - b - tx);
    copyRegion(target, skin, b, 0, span, b, x + tx, y); // top
    copyRegion(target, skin, b, skin.height - b, span, b, x + tx, y + h - b); // bottom
  }
  for (let ty = b; ty < h - b; ty += innerH) {
    const span = Math.min(innerH, h - b - ty);
    copyRegion(target, skin, 0, b, b, span, x, y + ty); // left
    copyRegion(target, skin, skin.width - b, b, b, span, x + w - b, y + ty); // right
  }

  // Corners, verbatim.
  copyRegion(target, skin, 0, 0, b, b, x, y);
  copyRegion(target, skin, skin.width - b, 0, b, b, x + w - b, y);
  copyRegion(target, skin, 0, skin.height - b, b, b, x, y + h - b);
  copyRegion(target, skin, skin.width - b, skin.height - b, b, b, x + w - b, y + h - b);
}
