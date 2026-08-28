// SPDX-License-Identifier: GPL-3.0-or-later
import type { ParsedBitmap } from "./fontJson";
import { alphaAt, makeRaster, type Raster } from "./raster";

/**
 * The game's own bitmap text, rendered the way the client renders it: glyphs live in a
 * grid texture (`ascii.png` is 16×16 cells of 8×8), a glyph's width is its rightmost
 * opaque column + 1, and the cursor advances by width + 1 pixel of spacing. An empty
 * cell (the space) advances by 4.
 *
 * Glyph art is white in the texture and tinted by multiplication, exactly like the
 * client tints text — which is also why WHITE is load-bearing on painted titles.
 */

export interface Glyph {
  /** Source rectangle in the font texture. */
  sx: number;
  sy: number;
  cellW: number;
  cellH: number;
  /** Rightmost opaque column + 1; 0 for an empty cell. */
  width: number;
}

export interface BitmapFont {
  texture: Raster;
  glyphs: Map<number, Glyph>;
  cellH: number;
}

const SPACE_ADVANCE = 4;

export function loadBitmapFont(provider: ParsedBitmap, texture: Raster): BitmapFont {
  const rows = provider.grid.length;
  const cols = Math.max(...provider.grid.map((row) => row.length));
  const cellW = Math.floor(texture.width / cols);
  const cellH = Math.floor(texture.height / rows);
  const glyphs = new Map<number, Glyph>();

  for (let row = 0; row < rows; row++) {
    const cells = provider.grid[row]!;
    for (let col = 0; col < cells.length; col++) {
      const codepoint = cells[col]!;
      if (codepoint === 0) continue;

      const sx = col * cellW;
      const sy = row * cellH;
      let width = 0;
      for (let x = cellW - 1; x >= 0 && width === 0; x--) {
        for (let y = 0; y < cellH; y++) {
          if (alphaAt(texture, sx + x, sy + y) > 0) {
            width = x + 1;
            break;
          }
        }
      }

      glyphs.set(codepoint, { sx, sy, cellW, cellH, width });
    }
  }

  return { texture, glyphs, cellH };
}

export function advanceOfGlyph(glyph: Glyph | undefined): number {
  if (!glyph || glyph.width === 0) return SPACE_ADVANCE;
  return glyph.width + 1;
}

export function measureText(font: BitmapFont, text: string, letterSpacing = 0): { w: number; h: number } {
  let w = 0;
  for (const char of text) {
    w += advanceOfGlyph(font.glyphs.get(char.codePointAt(0)!)) + letterSpacing;
  }
  return { w: Math.max(0, w - 1 - letterSpacing), h: font.cellH };
}

export interface TextStyle {
  /** Solid fill, or a vertical gradient from the first to the second colour. */
  color: [number, number, number];
  gradientTo?: [number, number, number];
  letterSpacing?: number;
}

/**
 * Renders one line into a tight raster. The glyph art is used as a mask and coloured
 * per destination row, so a gradient runs through the whole line, not per glyph.
 */
export function renderText(font: BitmapFont, text: string, style: TextStyle): Raster {
  const size = measureText(font, text, style.letterSpacing ?? 0);
  const out = makeRaster(Math.max(1, size.w), size.h);
  let cursor = 0;

  for (const char of text) {
    const glyph = font.glyphs.get(char.codePointAt(0)!);
    if (glyph && glyph.width > 0) {
      for (let y = 0; y < glyph.cellH; y++) {
        const colour = rowColour(style, y, size.h);
        for (let x = 0; x < glyph.width; x++) {
          const alpha = alphaAt(font.texture, glyph.sx + x, glyph.sy + y);
          if (alpha === 0) continue;
          const index = (y * out.width + (cursor + x)) * 4;
          out.data[index] = colour[0];
          out.data[index + 1] = colour[1];
          out.data[index + 2] = colour[2];
          out.data[index + 3] = alpha;
        }
      }
    }
    cursor += advanceOfGlyph(glyph) + (style.letterSpacing ?? 0);
  }

  return out;
}

function rowColour(style: TextStyle, y: number, height: number): [number, number, number] {
  if (!style.gradientTo || height <= 1) return style.color;
  const t = y / (height - 1);
  return [0, 1, 2].map((channel) =>
    Math.round(style.color[channel]! + (style.gradientTo![channel]! - style.color[channel]!) * t),
  ) as [number, number, number];
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = parseInt(clean.length === 3 ? clean.replace(/./g, "$&$&") : clean, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
