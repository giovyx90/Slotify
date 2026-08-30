// SPDX-License-Identifier: GPL-3.0-or-later
import { z } from "zod";
import { PlateStyleSchema } from "./project";

/**
 * Button designs — the named looks a button can wear.
 *
 * Until now a button had three: `single`, `double`, `flat`, chosen from a select called
 * "edge". They are all the same button with a deeper rim, which is why every screen built
 * with this tool looks like every other screen built with this tool. A design is the same
 * idea given a name, a preview and somewhere to live, so a pack can carry its own set.
 *
 * Two kinds, and both already had an engine behind them:
 *
 *   **recipe** draws through `drawPlate`, which has done bevels since v0. What is new is
 *   the corner: square as before, or cut, or rounded. It scales to any size for free,
 *   which is the whole reason a button is not a sprite.
 *
 *   **ninepatch** draws through `drawNinepatch`, which has tiled the NEXT infobox since
 *   v3 — corners verbatim, edges and centre tiled, never stretched. It was wired to
 *   exactly one texture per profile (`panelSkin`); a design set is that generalised.
 *
 * Designs live in the profile, beside the palette, so they version with the pack they
 * were drawn for — the same rule the component library follows.
 */

export const DesignRecipeSchema = z.object({
  kind: z.literal("recipe"),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** Rim depth: one ring, two rings, or an outline with no rim at all. */
  bevel: PlateStyleSchema,
  /** How the four corners are finished. `cut` takes one pixel, `round` takes three. */
  corners: z.enum(["square", "cut", "round"]),
});

export const DesignNinepatchSchema = z.object({
  kind: z.literal("ninepatch"),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** Pack-relative path to the PNG. */
  texture: z.string().min(1),
  /** Pixels of each edge copied verbatim; the rest tiles. */
  border: z.number().int().positive().default(3),
});

export const DesignSchema = z.discriminatedUnion("kind", [DesignRecipeSchema, DesignNinepatchSchema]);

export type DesignRecipe = z.infer<typeof DesignRecipeSchema>;
export type DesignNinepatch = z.infer<typeof DesignNinepatchSchema>;
export type Design = z.infer<typeof DesignSchema>;

/**
 * The set every pack starts with, so the picker is never an empty room. They are the
 * looks the shipped NEXT screens already use, plus the two corner treatments that were
 * impossible before.
 */
export const BUILT_IN_DESIGNS: Design[] = [
  { kind: "recipe", id: "vanilla", name: "Vanilla", bevel: "single", corners: "square" },
  { kind: "recipe", id: "double", name: "Double edge", bevel: "double", corners: "square" },
  { kind: "recipe", id: "flat", name: "Flat", bevel: "flat", corners: "square" },
  { kind: "recipe", id: "cut", name: "Cut corners", bevel: "single", corners: "cut" },
  { kind: "recipe", id: "round", name: "Round corners", bevel: "single", corners: "round" },
  { kind: "recipe", id: "round-deep", name: "Round, deep", bevel: "double", corners: "round" },
  { kind: "recipe", id: "cut-flat", name: "Cut and flat", bevel: "flat", corners: "cut" },
];

/**
 * The design an element asks for, if anything answers to that id.
 *
 * An id nothing defines resolves to `undefined` rather than throwing: a project written
 * against a pack that has since dropped a design must still open, drawn as a plain
 * button, and say so — not refuse to load.
 */
export function designById(id: string | undefined, extra: readonly Design[] = []): Design | undefined {
  if (!id) return undefined;
  return [...extra, ...BUILT_IN_DESIGNS].find((design) => design.id === id);
}

/** Every design on offer: the pack's first, so a pack may shadow a built-in by id. */
export function allDesigns(extra: readonly Design[] = []): Design[] {
  const seen = new Set<string>();
  const out: Design[] = [];
  for (const design of [...extra, ...BUILT_IN_DESIGNS]) {
    if (seen.has(design.id)) continue;
    seen.add(design.id);
    out.push(design);
  }
  return out;
}

/** How many pixels a corner treatment eats. Square eats none. */
export function cornerRadius(corners: DesignRecipe["corners"]): number {
  return corners === "cut" ? 1 : corners === "round" ? 2 : 0;
}
