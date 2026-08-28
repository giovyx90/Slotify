// SPDX-License-Identifier: GPL-3.0-or-later
import { SHEET_CANVAS, SHEET_TO_WINDOW_Y } from "./geometry";
import { drawNinepatch } from "./ninepatch";
import {
  drawInset,
  drawRaised,
  drawSlotWell,
  hueShiftedBevels,
  outline,
  PANEL,
  PANEL_EDGE,
  rect,
  VANILLA_BEVELS,
  type BevelSet,
  type RGBA,
} from "./paint";
import { advanceOf, blit, makeRaster, stripIsolated, type Raster } from "./raster";
import type { Element, Project } from "./project";
import { drawTileRegion, regionBBox, type TileCell } from "./tiles";
import {
  hexToRgb,
  measureText,
  renderTextShadowed,
  type BitmapFont,
  type ShadowDir,
} from "./textFont";
import { parseCodepoint } from "./unicode";
import type { ProviderEntry } from "./spliceGuiJson";

/**
 * Bakes a project into its 256×256 sheet: elements are authored in window coordinates
 * and land at `sheetY = windowY + ascent − 13`. The background (an imported sheet, if
 * any) is already in sheet coordinates and is blitted untranslated.
 */

export interface RenderContext {
  /** Available text faces: the pack's own (`minecraft`) and the built-in 5×5 mono. */
  fonts?: { minecraft?: BitmapFont; mono5?: BitmapFont };
  /** Sprite component id -> decoded PNG. */
  sprites?: Map<string, Raster>;
  /** The profile's real infobox texture, cropped, with its ninepatch border. */
  infoboxSkin?: { raster: Raster; border: number };
}

// Fallback infobox palette, measured from the NEXT template PNG — used only when the
// profile has no skin to load.
const INFOBOX_FILL = "#212121";
const INFOBOX_INNER = "#555555";
const INFOBOX_OUTER = "#000000";
const TEXT_DEFAULT = "#3F3F3F";
const INFOBOX_TEXT_DEFAULT = "#E6E2DA";

function rgba(hex: string): RGBA {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, 255];
}

function fontFor(element: Element, context: RenderContext): BitmapFont | undefined {
  const fonts = context.fonts ?? {};
  if (element.font === "mono5") return fonts.mono5 ?? fonts.minecraft;
  return fonts.minecraft ?? fonts.mono5;
}

function bevelsFor(element: Element): { fill: RGBA; bevels: BevelSet } {
  const fill: RGBA = element.color ? rgba(element.color) : PANEL;
  return { fill, bevels: element.color ? hueShiftedBevels(fill) : VANILLA_BEVELS };
}

function drawLine(
  sheet: Raster,
  font: BitmapFont,
  text: string,
  colour: string,
  shadow: ShadowDir,
  x: number,
  y: number,
): void {
  blit(sheet, renderTextShadowed(font, text, { color: hexToRgb(colour) }, shadow), x, y);
}

function drawLabelCentred(
  sheet: Raster,
  font: BitmapFont,
  element: Element,
  x: number,
  y: number,
  w: number,
  h: number,
  fallbackColour: string,
): void {
  const size = measureText(font, element.label ?? "");
  drawLine(
    sheet,
    font,
    element.label ?? "",
    element.textColor ?? fallbackColour,
    element.shadow ?? "none",
    x + Math.floor((w - size.w) / 2),
    y + Math.floor((h - size.h) / 2),
  );
}

function drawInfoboxSkin(
  sheet: Raster,
  context: RenderContext,
  element: Element,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (context.infoboxSkin) {
    drawNinepatch(sheet, context.infoboxSkin.raster, context.infoboxSkin.border, x, y, w, h);
  } else {
    // Procedural stand-in in the measured NEXT colours: rounded 1px black outer ring,
    // grey inner ring, near-black fill.
    rect(sheet, x + 1, y + 1, w - 2, h - 2, rgba(element.color ?? INFOBOX_FILL));
    outline(sheet, x + 1, y + 1, w - 2, h - 2, rgba(element.borderColor ?? INFOBOX_INNER));
    const black = rgba(INFOBOX_OUTER);
    for (let dx = 1; dx < w - 1; dx++) {
      sheet.data.set(black, ((y) * sheet.width + (x + dx)) * 4);
      sheet.data.set(black, ((y + h - 1) * sheet.width + (x + dx)) * 4);
    }
    for (let dy = 1; dy < h - 1; dy++) {
      sheet.data.set(black, ((y + dy) * sheet.width + x) * 4);
      sheet.data.set(black, ((y + dy) * sheet.width + (x + w - 1)) * 4);
    }
  }
}

function drawInfoboxLines(
  sheet: Raster,
  context: RenderContext,
  element: Element,
  x: number,
  y: number,
): void {
  const font = fontFor(element, context);
  if (!font) return;
  const lineHeight = font.cellH + 2;
  (element.lines ?? []).forEach((line, index) => {
    const colour = element.lineColors?.[index] ?? element.textColor ?? INFOBOX_TEXT_DEFAULT;
    drawLine(sheet, font, line, colour, element.shadow ?? "none", x + 5, y + 5 + index * lineHeight);
  });
}

function drawElement(sheet: Raster, element: Element, dy: number, context: RenderContext): void {
  const x = element.x;
  const y = element.y + dy;
  const font = fontFor(element, context);

  switch (element.kind) {
    case "slot":
      drawSlotWell(sheet, x, y);
      break;

    case "button": {
      const { fill, bevels } = bevelsFor(element);
      if (element.pressed) drawInset(sheet, x, y, element.w, element.h, fill, bevels);
      else drawRaised(sheet, x, y, element.w, element.h, fill, bevels);
      if (element.label && font) {
        drawLabelCentred(sheet, font, element, x, y, element.w, element.h, TEXT_DEFAULT);
      }
      break;
    }

    case "panel": {
      const { fill, bevels } = bevelsFor(element);
      rect(sheet, x, y, element.w, element.h, fill);
      outline(sheet, x, y, element.w, element.h, element.color ? bevels.edge : PANEL_EDGE);
      break;
    }

    case "well": {
      const { fill, bevels } = bevelsFor(element);
      drawInset(sheet, x, y, element.w, element.h, element.color ? fill : undefined, element.color ? bevels : undefined);
      break;
    }

    case "text":
      if (element.label && font) {
        drawLine(sheet, font, element.label, element.textColor ?? "#FFFFFF", element.shadow ?? "none", x, y);
      }
      break;

    case "infobox":
      drawInfoboxSkin(sheet, context, element, x, y, element.w, element.h);
      drawInfoboxLines(sheet, context, element, x, y);
      break;

    case "sprite": {
      const raster = element.sprite ? context.sprites?.get(element.sprite) : undefined;
      if (raster) blit(sheet, raster, x, y);
      else outline(sheet, x, y, element.w, element.h, [255, 90, 90, 255]);
      break;
    }

    case "tiles": {
      const cells = (element.cells ?? []) as TileCell[];
      if (cells.length === 0) break;
      const box = regionBBox(cells);

      if (element.tileKind === "infobox") {
        drawInfoboxSkin(sheet, context, element, box.x, box.y + dy, box.w, box.h);
        drawInfoboxLines(sheet, context, element, box.x, box.y + dy);
      } else {
        const { fill, bevels } = bevelsFor(element);
        drawTileRegion(sheet, cells, fill, bevels, element.pressed ?? false, dy);
        if (element.label && font) {
          drawLabelCentred(sheet, font, element, box.x, box.y + dy, box.w, box.h, TEXT_DEFAULT);
        }
      }
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
