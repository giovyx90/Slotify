// SPDX-License-Identifier: GPL-3.0-or-later
import { SHEET_CANVAS, SHEET_TO_WINDOW_Y } from "./geometry";
import {
  drawInset,
  drawRaised,
  drawSlotWell,
  outline,
  PANEL,
  PANEL_EDGE,
  rect,
  type RGBA,
} from "./paint";
import { advanceOf, blit, makeRaster, stripIsolated, type Raster } from "./raster";
import type { Element, Project } from "./project";
import { hexToRgb, measureText, renderText, type BitmapFont } from "./textFont";
import { parseCodepoint } from "./unicode";
import type { ProviderEntry } from "./spliceGuiJson";

/**
 * Bakes a project into its 256×256 sheet: elements are authored in window coordinates
 * and land at `sheetY = windowY + ascent − 13`. The background (an imported sheet, if
 * any) is already in sheet coordinates and is blitted untranslated.
 */

export interface RenderContext {
  /** The pack's own text font — button labels, text and infobox lines need it. */
  font?: BitmapFont;
  /** Sprite component id -> decoded PNG. */
  sprites?: Map<string, Raster>;
}

const INFOBOX_BG = "#2B2126";
const INFOBOX_BORDER = "#F0A831";
const TEXT_DEFAULT = "#3F3F3F";

function rgba(hex: string): RGBA {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, 255];
}

function drawLabelCentred(
  sheet: Raster,
  font: BitmapFont,
  text: string,
  colour: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const size = measureText(font, text);
  const rendered = renderText(font, text, { color: hexToRgb(colour) });
  blit(sheet, rendered, x + Math.floor((w - size.w) / 2), y + Math.floor((h - size.h) / 2));
}

function drawElement(sheet: Raster, element: Element, dy: number, context: RenderContext): void {
  const x = element.x;
  const y = element.y + dy;
  const fill: RGBA = element.color ? rgba(element.color) : PANEL;

  switch (element.kind) {
    case "slot":
      drawSlotWell(sheet, x, y);
      break;

    case "button":
      if (element.pressed) drawInset(sheet, x, y, element.w, element.h, fill);
      else drawRaised(sheet, x, y, element.w, element.h, fill);
      if (element.label && context.font) {
        drawLabelCentred(
          sheet, context.font, element.label, element.textColor ?? TEXT_DEFAULT,
          x, y, element.w, element.h,
        );
      }
      break;

    case "panel":
      rect(sheet, x, y, element.w, element.h, fill);
      outline(sheet, x, y, element.w, element.h, PANEL_EDGE);
      break;

    case "well":
      drawInset(sheet, x, y, element.w, element.h, element.color ? rgba(element.color) : undefined);
      break;

    case "text":
      if (element.label && context.font) {
        const rendered = renderText(context.font, element.label, {
          color: hexToRgb(element.textColor ?? "#FFFFFF"),
        });
        blit(sheet, rendered, x, y);
      }
      break;

    case "infobox": {
      rect(sheet, x, y, element.w, element.h, rgba(element.color ?? INFOBOX_BG));
      outline(sheet, x, y, element.w, element.h, rgba(element.borderColor ?? INFOBOX_BORDER));
      if (context.font) {
        const lineHeight = context.font.cellH + 2;
        (element.lines ?? []).forEach((line, index) => {
          const rendered = renderText(context.font!, line, {
            color: hexToRgb(element.textColor ?? "#E6E2DA"),
          });
          blit(sheet, rendered, x + 4, y + 4 + index * lineHeight);
        });
      }
      break;
    }

    case "sprite": {
      const raster = element.sprite ? context.sprites?.get(element.sprite) : undefined;
      if (raster) blit(sheet, raster, x, y);
      else outline(sheet, x, y, element.w, element.h, [255, 90, 90, 255]);
      break;
    }
  }
}

export function renderSheet(project: Project, background?: Raster, context: RenderContext = {}): Raster {
  const sheet = makeRaster(SHEET_CANVAS, SHEET_CANVAS);
  if (background) blit(sheet, background, 0, 0);

  const dy = project.ascent - SHEET_TO_WINDOW_Y;
  for (const element of project.elements) drawElement(sheet, element, dy, context);

  return sheet;
}

export interface BakeResult {
  sheet: Raster;
  /** Measured after the stray strip — the number the Java constant must carry. */
  advance: number;
  straysRemoved: number;
  provider: ProviderEntry;
}

/** The export path: render, strip strays, measure, and describe the provider. */
export function bakeSheet(project: Project, background?: Raster, context: RenderContext = {}): BakeResult {
  const sheet = renderSheet(project, background, context);
  const straysRemoved = stripIsolated(sheet);

  return {
    sheet,
    straysRemoved,
    advance: advanceOf(sheet),
    provider: {
      codepoint: parseCodepoint(project.codepoint),
      file: project.textureFile,
      ascent: project.ascent,
    },
  };
}
