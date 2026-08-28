// SPDX-License-Identifier: GPL-3.0-or-later
import { blit, makeRaster, type Raster } from "./raster";
import { hexToRgb, measureText, renderText, type BitmapFont } from "./textFont";

/**
 * Pixel text tags in the nogard.dev spirit: game-font text with a vertical gradient,
 * optional outline, drop shadow and background plate, exported as a tight PNG suitable
 * for a resource pack or a sprite component.
 */

export interface TagStyle {
  scale: number;
  fill: string;
  /** Second gradient stop; omit for a solid fill. */
  fillTo?: string;
  outline?: string;
  shadow?: string;
  shadowOffset?: [number, number];
  letterSpacing?: number;
  background?: {
    fill: string;
    border?: string;
    paddingX: number;
    paddingY: number;
  };
}

export function renderTag(font: BitmapFont, text: string, style: TagStyle): Raster {
  const textRaster = renderText(font, text, {
    color: hexToRgb(style.fill),
    gradientTo: style.fillTo ? hexToRgb(style.fillTo) : undefined,
    letterSpacing: style.letterSpacing ?? 0,
  });

  const outlinePad = style.outline ? 1 : 0;
  const [shadowDx, shadowDy] = style.shadow ? (style.shadowOffset ?? [1, 1]) : [0, 0];
  const padX = (style.background?.paddingX ?? 0) + outlinePad;
  const padY = (style.background?.paddingY ?? 0) + outlinePad;

  const width = textRaster.width + padX * 2 + Math.abs(shadowDx);
  const height = textRaster.height + padY * 2 + Math.abs(shadowDy);
  const out = makeRaster(width, height);

  if (style.background) {
    fillRect(out, 0, 0, width, height, hexToRgb(style.background.fill), 255);
    if (style.background.border) {
      const border = hexToRgb(style.background.border);
      for (let x = 0; x < width; x++) {
        setPixel(out, x, 0, border);
        setPixel(out, x, height - 1, border);
      }
      for (let y = 0; y < height; y++) {
        setPixel(out, 0, y, border);
        setPixel(out, width - 1, y, border);
      }
    }
  }

  const textX = padX + Math.max(0, -shadowDx);
  const textY = padY + Math.max(0, -shadowDy);

  if (style.shadow) {
    blit(out, tinted(textRaster, hexToRgb(style.shadow)), textX + shadowDx, textY + shadowDy);
  }

  if (style.outline) {
    const ring = tinted(textRaster, hexToRgb(style.outline));
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      blit(out, ring, textX + dx, textY + dy);
    }
  }

  blit(out, textRaster, textX, textY);

  return style.scale > 1 ? scaled(out, style.scale) : out;
}

/** The mask of a rendered text, recoloured flat — shadows and outlines are one colour. */
function tinted(source: Raster, colour: [number, number, number]): Raster {
  const out = makeRaster(source.width, source.height);
  for (let i = 0; i < source.width * source.height; i++) {
    const alpha = source.data[i * 4 + 3]!;
    if (alpha === 0) continue;
    out.data[i * 4] = colour[0];
    out.data[i * 4 + 1] = colour[1];
    out.data[i * 4 + 2] = colour[2];
    out.data[i * 4 + 3] = alpha;
  }
  return out;
}

function scaled(source: Raster, factor: number): Raster {
  const out = makeRaster(source.width * factor, source.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = ((Math.floor(y / factor) * source.width) + Math.floor(x / factor)) * 4;
      out.data.set(source.data.subarray(si, si + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

function setPixel(raster: Raster, x: number, y: number, colour: [number, number, number]): void {
  const index = (y * raster.width + x) * 4;
  raster.data[index] = colour[0];
  raster.data[index + 1] = colour[1];
  raster.data[index + 2] = colour[2];
  raster.data[index + 3] = 255;
}

function fillRect(
  raster: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: [number, number, number],
  alpha: number,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const index = ((y + dy) * raster.width + (x + dx)) * 4;
      raster.data[index] = colour[0];
      raster.data[index + 1] = colour[1];
      raster.data[index + 2] = colour[2];
      raster.data[index + 3] = alpha;
    }
  }
}
