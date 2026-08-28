// SPDX-License-Identifier: GPL-3.0-or-later
import { SHEET_CANVAS, SHEET_TO_WINDOW_Y } from "./geometry";
import { drawInset, drawRaised, drawSlotWell, outline, PANEL, PANEL_EDGE, rect } from "./paint";
import { advanceOf, blit, makeRaster, stripIsolated, type Raster } from "./raster";
import type { Element, Project } from "./project";
import { parseCodepoint } from "./unicode";
import type { ProviderEntry } from "./spliceGuiJson";

/**
 * Bakes a project into its 256×256 sheet: elements are authored in window coordinates
 * and land at `sheetY = windowY + ascent − 13`. The background (an imported sheet, if
 * any) is already in sheet coordinates and is blitted untranslated.
 */

function drawElement(sheet: Raster, element: Element, dy: number): void {
  const x = element.x;
  const y = element.y + dy;

  switch (element.kind) {
    case "slot":
      drawSlotWell(sheet, x, y);
      break;
    case "button":
      if (element.pressed) drawInset(sheet, x, y, element.w, element.h, PANEL);
      else drawRaised(sheet, x, y, element.w, element.h);
      break;
    case "panel":
      rect(sheet, x, y, element.w, element.h, PANEL);
      outline(sheet, x, y, element.w, element.h, PANEL_EDGE);
      break;
    case "well":
      drawInset(sheet, x, y, element.w, element.h);
      break;
  }
}

export function renderSheet(project: Project, background?: Raster): Raster {
  const sheet = makeRaster(SHEET_CANVAS, SHEET_CANVAS);
  if (background) blit(sheet, background, 0, 0);

  const dy = project.ascent - SHEET_TO_WINDOW_Y;
  for (const element of project.elements) drawElement(sheet, element, dy);

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
export function bakeSheet(project: Project, background?: Raster): BakeResult {
  const sheet = renderSheet(project, background);
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
