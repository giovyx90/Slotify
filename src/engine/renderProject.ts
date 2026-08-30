// SPDX-License-Identifier: GPL-3.0-or-later
import { renderWindow } from "./chestRenderer";
import { SHEET_CANVAS, SHEET_TO_WINDOW_Y, windowHeight } from "./geometry";
import { cornerRadius, designById, type Design } from "./designs";
import { drawNinepatch } from "./ninepatch";
import {
  carveCorners,
  drawInset,
  drawPlate,
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
import { resolveColour, type Swatch } from "./palette";
import { decodeLayer } from "./paintLayer";
import { advanceOf, blit, makeRaster, scaleRaster, stripIsolated, type Raster } from "./raster";
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
  /** The profile's panel/title-box texture (NEXT: boxtitolo), same treatment. */
  panelSkin?: { raster: Raster; border: number };
  /** Designs the pack declares, on top of the built-in set. */
  designs?: readonly Design[];
  /** Decoded artwork for the ninepatch designs, by design id. */
  designSkins?: Map<string, { raster: Raster; border: number }>;
  /** The pack's named colours. The project's own palette is consulted first. */
  palette?: Swatch[];
  /**
   * Decoded paint layers by element id. The editor keeps these so a stroke does not pay
   * for a PNG decode per frame; without it the renderer decodes from the element itself.
   */
  paints?: Map<string, Raster>;
}

/**
 * An element with every `@name` turned into the hex it stands for, which is all the
 * drawing code below ever sees. A reference nothing defines resolves to nothing, so the
 * element falls back to its default colour instead of failing to draw.
 */
export function resolveElementColours(element: Element, palette: readonly Swatch[]): Element {
  const named = (value: string | null | undefined): boolean =>
    typeof value === "string" && value.startsWith("@");
  const anyNamed =
    named(element.color) ||
    named(element.textColor) ||
    named(element.borderColor) ||
    (element.lineColors ?? []).some(named);
  if (!anyNamed) return element;

  return {
    ...element,
    color: resolveColour(element.color, palette),
    textColor: resolveColour(element.textColor, palette),
    borderColor: resolveColour(element.borderColor, palette),
    lineColors: element.lineColors?.map((colour) => resolveColour(colour ?? undefined, palette) ?? null),
  };
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
  scale = 1,
): void {
  const line = renderTextShadowed(font, text, { color: hexToRgb(colour) }, shadow);
  blit(sheet, scaleRaster(line, scale), x, y);
}

/**
 * Where a run of text sits inside a box. Centred unless told otherwise; the two pixels
 * of padding on left and right keep a label off the bevel it would otherwise touch.
 */
function alignedX(align: Element["align"], boxX: number, boxW: number, textW: number): number {
  if (align === "left") return boxX + 2;
  if (align === "right") return boxX + boxW - textW - 2;
  return boxX + Math.floor((boxW - textW) / 2);
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
  const scale = element.textScale ?? 1;
  const size = measureText(font, element.label ?? "");
  drawLine(
    sheet,
    font,
    element.label ?? "",
    element.textColor ?? fallbackColour,
    element.shadow ?? "none",
    alignedX(element.align, x, w, size.w * scale) + (element.textDx ?? 0),
    y + Math.floor((h - size.h * scale) / 2) + (element.textDy ?? 0),
    scale,
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
  // The NEXT infobox standard is 2× text; lines centre horizontally like the template.
  const scale = element.textScale ?? 2;
  const lineHeight = font.cellH * scale + (element.lineGap ?? 2);
  (element.lines ?? []).forEach((line, index) => {
    const colour = element.lineColors?.[index] ?? element.textColor ?? INFOBOX_TEXT_DEFAULT;
    const size = measureText(font, line);
    const textX =
      element.align == null || element.align === "center"
        ? x + Math.max(5, Math.floor((element.w - size.w * scale) / 2))
        : alignedX(element.align, x + 5, element.w - 10, size.w * scale);
    drawLine(
      sheet,
      font,
      line,
      colour,
      element.shadow ?? "none",
      textX + (element.textDx ?? 0),
      y + 6 + index * lineHeight + (element.textDy ?? 0),
      scale,
    );
  });
}

function drawElement(sheet: Raster, element: Element, dy: number, context: RenderContext): void {
  // Hiding a layer hides it everywhere, the export included. The alternative — a layer
  // invisible in the editor and present in the shipped sheet — is how you send art with
  // a piece in it nobody has looked at for a week.
  if (element.hidden) return;
  const x = element.x;
  const y = element.y + dy;
  const font = fontFor(element, context);

  switch (element.kind) {
    case "slot":
      drawSlotWell(sheet, x, y);
      break;

    case "button": {
      const { fill, bevels } = bevelsFor(element);
      const design = designById(element.design, context.designs);
      const skin = design?.kind === "ninepatch" ? context.designSkins?.get(design.id) : undefined;
      if (skin) {
        drawNinepatch(sheet, skin.raster, skin.border, x, y, element.w, element.h);
      } else if (design?.kind === "recipe") {
        drawPlate(
          sheet, x, y, element.w, element.h, fill, bevels,
          element.pressed ?? false, design.bevel, cornerRadius(design.corners),
        );
      } else if (element.bevel && element.bevel !== "single") {
        drawPlate(sheet, x, y, element.w, element.h, fill, bevels, element.pressed ?? false, element.bevel);
      } else if (element.pressed) {
        drawInset(sheet, x, y, element.w, element.h, fill, bevels);
      } else {
        drawRaised(sheet, x, y, element.w, element.h, fill, bevels);
      }
      if (element.label && font) {
        drawLabelCentred(sheet, font, element, x, y, element.w, element.h, TEXT_DEFAULT);
      }
      break;
    }

    case "panel": {
      // The profile's own title-box art wins; a custom colour falls back to procedural.
      if (context.panelSkin && !element.color) {
        drawNinepatch(sheet, context.panelSkin.raster, context.panelSkin.border, x, y, element.w, element.h);
      } else {
        const { fill, bevels } = bevelsFor(element);
        rect(sheet, x, y, element.w, element.h, fill);
        outline(sheet, x, y, element.w, element.h, element.color ? bevels.edge : PANEL_EDGE);
      }
      if (element.label && font) {
        drawLabelCentred(sheet, font, element, x, y, element.w, element.h, TEXT_DEFAULT);
      }
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

    case "paint": {
      const raster = context.paints?.get(element.id) ?? (element.paint ? decodeLayer(element.paint) : null);
      if (raster) blit(sheet, raster, x, y);
      break;
    }

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
        const design = designById(element.design, context.designs);
        const skin = design?.kind === "ninepatch" ? context.designSkins?.get(design.id) : undefined;
        if (skin) {
          drawNinepatch(sheet, skin.raster, skin.border, box.x, box.y + dy, box.w, box.h);
        } else {
          const style = design?.kind === "recipe" ? design.bevel : (element.bevel ?? "single");
          drawTileRegion(sheet, cells, fill, bevels, element.pressed ?? false, dy, style);
          // A corner treatment needs a rectangle to have corners. A merged region
          // that is not one keeps its square ends rather than losing pixels it never
          // agreed to lose.
          const radius = design?.kind === "recipe" ? cornerRadius(design.corners) : 0;
          if (radius > 0 && cells.length === (box.w / 18) * (box.h / 18)) {
            const pressed = element.pressed ?? false;
            const top = pressed ? bevels.dark : bevels.light;
            const bottom = pressed ? bevels.light : bevels.dark;
            carveCorners(sheet, box.x, box.y + dy, box.w, box.h, radius, top, bottom);
          }
        }
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
  const dy = project.ascent - SHEET_TO_WINDOW_Y;

  if (project.bakeWindow) {
    // The window itself — carved holes included — becomes sheet pixels, exactly what a
    // real NEXT screen paints over the erased generic_54 texture. A window pushed past
    // the canvas (ascent below 13, or a tall window shifted far down) is rebuilt
    // shorter with its contour re-closed, never sliced raw at the sheet edge.
    const window = renderWindow({
      rows: project.rows,
      hiddenContainerSlots: new Set(project.hiddenSlots ?? []),
      hiddenInvSlots: new Set(project.hiddenInvSlots ?? []),
      holes: new Set(project.holes ?? []),
      cropTop: Math.max(0, -dy),
      cropBottom: Math.max(0, windowHeight(project.rows) + dy - SHEET_CANVAS),
    });
    blit(sheet, window, 0, dy);
  }

  if (background) blit(sheet, background, 0, 0);
  // The project's palette shadows the pack's: same id, the screen's own value wins.
  const palette = [...(project.palette ?? []), ...(context.palette ?? [])];
  for (const element of project.elements) {
    drawElement(sheet, resolveElementColours(element, palette), dy, context);
  }

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
  const straysRemoved = project.stripStrays === false ? 0 : stripIsolated(sheet);

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
