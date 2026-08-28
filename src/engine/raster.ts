// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pixel measurement on raw RGBA buffers, ported line-for-line from
 * `tools/locker-pack/build_sheets.py` in the NEXT repository — the script whose output
 * the shipped screens were built from.
 *
 * Everything here operates on plain byte arrays, never on canvas pixels: a browser
 * canvas premultiplies alpha and silently corrupts semi-transparent values, which would
 * change what "opaque" means and with it every measured advance.
 */

export interface Raster {
  width: number;
  height: number;
  /** RGBA8, row-major, 4 bytes per pixel. */
  data: Uint8Array | Uint8ClampedArray;
}

export function makeRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function alphaAt(raster: Raster, x: number, y: number): number {
  return raster.data[(y * raster.width + x) * 4 + 3]!;
}

function rgbAt(raster: Raster, x: number, y: number): [number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [raster.data[i]!, raster.data[i + 1]!, raster.data[i + 2]!];
}

/**
 * Clears opaque pixels with fewer than two opaque neighbours (8-neighbourhood).
 * Neighbours are counted against the pre-pass opacity, exactly like the Python original —
 * this is a single pass, not an erosion run to fixpoint.
 *
 * Why it exists: a single stray opaque pixel 60 columns right of the artwork adds 60px
 * to the sheet's advance and drags every overlay across the screen, and it is invisible
 * in an image viewer. Mutates the raster; returns how many pixels were cleared.
 */
export function stripIsolated(raster: Raster): number {
  const { width, height, data } = raster;
  const opaque = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    opaque[i] = data[i * 4 + 3]! > 0 ? 1 : 0;
  }

  let removed = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque[y * width + x]) continue;

      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && opaque[ny * width + nx]) {
            neighbours++;
          }
        }
      }

      if (neighbours < 2) {
        data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
        removed++;
      }
    }
  }

  return removed;
}

/** The rightmost column holding any opaque pixel, or −1 on a fully transparent raster. */
export function rightmostOpaqueColumn(raster: Raster): number {
  for (let x = raster.width - 1; x >= 0; x--) {
    for (let y = 0; y < raster.height; y++) {
      if (alphaAt(raster, x, y) > 0) return x;
    }
  }
  return -1;
}

/**
 * The cursor advance the client gives this glyph: rightmost opaque column **plus two**.
 * The client trims the glyph to its rightmost non-transparent column (width `column+1`)
 * and adds one pixel of spacing after every character. Verified against RobberyGlyphs:
 * declared 237/248/177 for PNGs whose rightmost opaque columns are 235/246/175.
 */
export function advanceOf(raster: Raster): number {
  const column = rightmostOpaqueColumn(raster);
  return column < 0 ? 0 : column + 2;
}

/**
 * The `ascent` this sheet needs for its drawn cells to land on the real slots, or null.
 *
 * A drawn slot cell is a dark bevel row (55,55,55), sixteen rows of interior, then a
 * white highlight — solid across a whole cell's width at a column where a cell can
 * start. Colour-blind about the interior on purpose (gradients are legal fills).
 * For the topmost drawn cell at container row r: `ascent = y − 5 − 18·r`, where y is
 * the first interior row.
 *
 * @param firstCellRow which container row the topmost drawn cell on this sheet is
 */
export function impliedAscent(raster: Raster, firstCellRow: number): number | null {
  const solid = (y: number, x0: number, colour: [number, number, number]): boolean => {
    for (let x = x0; x < x0 + 16; x++) {
      if (alphaAt(raster, x, y) === 0) return false;
      const [r, g, b] = rgbAt(raster, x, y);
      if (r !== colour[0] || g !== colour[1] || b !== colour[2]) return false;
    }
    return true;
  };

  for (let y = 1; y < raster.height - 17; y++) {
    for (let column = 0; column < 9; column++) {
      const x0 = 8 + 18 * column;
      if (x0 + 16 > raster.width) break;

      if (solid(y - 1, x0, [55, 55, 55]) && solid(y + 16, x0, [255, 255, 255])) {
        return y - 5 - 18 * firstCellRow;
      }
    }
  }

  return null;
}

/**
 * Every container cell actually drawn on a sheet with a known ascent, as (row, col)
 * pairs — the bevel/interior/highlight test of `impliedAscent`, aimed at each slot
 * position instead of scanning. Feeds the importer's hotspot suggestions.
 */
export function detectCells(raster: Raster, ascent: number, rows = 6): { row: number; col: number }[] {
  const solid = (y: number, x0: number, colour: [number, number, number]): boolean => {
    if (y < 0 || y >= raster.height || x0 + 16 > raster.width) return false;
    for (let x = x0; x < x0 + 16; x++) {
      if (alphaAt(raster, x, y) === 0) return false;
      const [r, g, b] = rgbAt(raster, x, y);
      if (r !== colour[0] || g !== colour[1] || b !== colour[2]) return false;
    }
    return true;
  };

  const found: { row: number; col: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const y = ascent + 5 + 18 * row;
    for (let col = 0; col < 9; col++) {
      const x0 = 8 + 18 * col;
      if (solid(y - 1, x0, [55, 55, 55]) && solid(y + 16, x0, [255, 255, 255])) {
        found.push({ row, col });
      }
    }
  }
  return found;
}

/** Integer nearest-neighbour upscale — pixel art only ever scales whole. */
export function scaleRaster(source: Raster, factor: number): Raster {
  if (factor <= 1) return source;
  const out = makeRaster(source.width * factor, source.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (Math.floor(y / factor) * source.width + Math.floor(x / factor)) * 4;
      out.data.set(source.data.subarray(si, si + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/** Alpha-over composite of `source` onto `target` at (dx, dy); out-of-bounds is dropped. */
export function blit(target: Raster, source: Raster, dx: number, dy: number): void {
  for (let sy = 0; sy < source.height; sy++) {
    const ty = dy + sy;
    if (ty < 0 || ty >= target.height) continue;

    for (let sx = 0; sx < source.width; sx++) {
      const tx = dx + sx;
      if (tx < 0 || tx >= target.width) continue;

      const si = (sy * source.width + sx) * 4;
      const alpha = source.data[si + 3]! / 255;
      if (alpha === 0) continue;

      const ti = (ty * target.width + tx) * 4;
      const inverse = (1 - alpha) * (target.data[ti + 3]! / 255);
      const outAlpha = alpha + inverse;

      for (let channel = 0; channel < 3; channel++) {
        target.data[ti + channel] = Math.round(
          (source.data[si + channel]! * alpha + target.data[ti + channel]! * inverse) / outAlpha,
        );
      }
      target.data[ti + 3] = Math.round(outAlpha * 255);
    }
  }
}
