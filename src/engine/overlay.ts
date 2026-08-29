// SPDX-License-Identifier: GPL-3.0-or-later
import type { DrawnSheet } from "./chestRenderer";
import type { Overlay, Project } from "./project";
import { bakeSheet, type BakeResult, type RenderContext } from "./renderProject";
import type { Raster } from "./raster";

/**
 * Screens with more than one state.
 *
 * A NEXT screen is a title made of several full-canvas glyphs: the base, then each
 * overlay backtracking by the previous sheet's advance so they all land on the same
 * origin (`composeTitle` in spacers.ts, and the Java `title()` the scaffold emits). The
 * engine has always been able to *compose* that. What was missing is the ability to
 * author it: a state used to mean a second screen, drawn again from scratch, with the
 * base duplicated inside it and two copies to keep in step forever.
 *
 * An overlay is instead a layer of the same project. It exports its own sheet — its own
 * codepoint, its own measured advance — and shares everything about the window with the
 * base, which it never draws.
 */

/**
 * The overlay as a project the renderer can bake on its own.
 *
 * Two things are forced rather than trusted. The window is never baked: an overlay that
 * painted the chest would cover the base it is supposed to sit on. And the ascent is the
 * base's unless the overlay insists, because both are authored in the same window
 * coordinates and a divergent ascent is exactly how a state lands three pixels high.
 */
export function overlayProject(project: Project, overlay: Overlay): Project {
  return {
    ...project,
    codepoint: overlay.codepoint,
    textureFile: overlay.textureFile,
    ascent: overlay.ascent ?? project.ascent,
    elements: overlay.elements,
    hotspots: overlay.hotspots,
    overlays: [],
    bakeWindow: false,
    background: undefined,
  };
}

export interface OverlayBake {
  overlay: Overlay;
  bake: BakeResult;
}

export interface ScreenBake {
  base: BakeResult;
  overlays: OverlayBake[];
}

/** Every sheet this project exports: the base, then one per state, in title order. */
export function bakeScreen(
  project: Project,
  background?: Raster,
  context: RenderContext = {},
): ScreenBake {
  return {
    base: bakeSheet(project, background, context),
    overlays: (project.overlays ?? []).map((overlay) => ({
      overlay,
      bake: bakeSheet(overlayProject(project, overlay), undefined, context),
    })),
  };
}

/**
 * A baked sheet as the preview's compositor wants it. The advance is the measured one,
 * not a declared one, so a stray pixel displaces the overlay in the editor exactly as
 * far as it would displace it in game.
 */
export function drawnSheet(bake: BakeResult, ascent: number): DrawnSheet {
  return {
    codepoint: bake.provider.codepoint,
    advance: bake.advance,
    ascent,
    texture: bake.sheet,
  };
}

/**
 * An id nothing in the project uses yet. Overlay ids name Java constants and texture
 * files, so a duplicate would have one state silently overwrite another's PNG.
 */
export function freeOverlayId(name: string, project: Project): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "state";
  const taken = new Set((project.overlays ?? []).map((overlay) => overlay.id));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
}

/** The Java constant an overlay's id becomes: `low-stock` -> `LOW_STOCK`. */
export function overlayConstant(id: string): string {
  return id.replace(/-/g, "_").toUpperCase();
}
