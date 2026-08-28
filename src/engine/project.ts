// SPDX-License-Identifier: GPL-3.0-or-later
import { z } from "zod";

/**
 * A Slotify project: one painted screen, authored in **window coordinates**.
 *
 * That coordinate choice is the design decision that kills the ascent confusion: the
 * editor always edits the window the player will see, and only the exporter bakes the
 * sheet, placing window row y at sheet row `y + ascent − 13`. Move the ascent and the
 * PNG changes; the design doesn't.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

export const ShadowDirSchema = z.enum([
  "none",
  "below-right",
  "below",
  "right",
  "below-left",
  "left",
  "above",
  "above-right",
  "above-left",
]);

export const FontChoiceSchema = z.enum(["minecraft", "mono5"]);

/** A cell of the 18px tile lattice (borders shared with the slot grid, origin (7,17)). */
export const TileCellSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

export const ElementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["slot", "button", "panel", "well", "text", "infobox", "sprite", "tiles"]),
  /** Window coordinates, pixels. For `slot`, the 16×16 well interior's top-left. */
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Buttons only: drawn pressed-in instead of raised. */
  pressed: z.boolean().optional(),
  /** Fill tint for button/panel/well/tiles, background override for infobox. */
  color: z.string().regex(HEX).optional(),
  /** Button/text/tile-button label. One line. */
  label: z.string().optional(),
  textColor: z.string().regex(HEX).optional(),
  /** Infobox body, one string per line. */
  lines: z.array(z.string()).optional(),
  /** Per-line colours, aligned with `lines`; null falls back to textColor. */
  lineColors: z.array(z.string().regex(HEX).nullable()).optional(),
  /** Infobox border override (procedural fallback only — the skin wins when loaded). */
  borderColor: z.string().regex(HEX).optional(),
  /** Sprite elements: id of the library component whose PNG this draws. */
  sprite: z.string().optional(),
  /** Text shadow for label/text/infobox lines. Default none. */
  shadow: ShadowDirSchema.optional(),
  /** Which face renders the text. Default minecraft (the pack font). */
  font: FontChoiceSchema.optional(),
  /** `tiles` only: what the connected region reads as. */
  tileKind: z.enum(["button", "infobox"]).optional(),
  /** `tiles` only: the lattice cells this region occupies. Adjacent cells merge. */
  cells: z.array(TileCellSchema).optional(),
  /** Vertical gap between infobox/text lines, pixels. */
  lineGap: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  /** Integer pixel scale for label/text/lines. The NEXT infobox standard is 2×. */
  textScale: z.union([z.literal(1), z.literal(2)]).optional(),
});

export const HotspotSchema = z.object({
  id: z.string().min(1),
  /** Free-form role word, coloured stably in the editor (header, action, nav, …). */
  role: z.string().min(1),
  /** Raw container slot indices, exactly what `event.getRawSlot()` reports. */
  slots: z.array(z.number().int().nonnegative()),
});

export const ProjectSchema = z.object({
  version: z.literal(1),
  module: z.string().min(1),
  screenKey: z.string().min(1),
  rows: z.number().int().min(1).max(6),
  /** "U+E8XX" — never a raw character. */
  codepoint: z.string().regex(/^U\+[0-9A-Fa-f]{4,6}$/),
  ascent: z.number().int(),
  shift: z.number().int(),
  fallbackTitle: z.string(),
  /** Texture path the export will claim, e.g. `custom_ui/<module>/<screenKey>.png`. */
  textureFile: z.string().min(1),
  /** An imported sheet drawn under the elements, locked; resolved via the pack. */
  background: z.object({ textureFile: z.string().min(1) }).optional(),
  elements: z.array(ElementSchema),
  hotspots: z.array(HotspotSchema),
  /** Container slots (raw index) removed from the drawn grid. */
  hiddenSlots: z.array(z.number().int().nonnegative()).optional(),
  /** Viewer-inventory slots removed: 0–26 main inventory, 27–35 hotbar. */
  hiddenInvSlots: z.array(z.number().int().nonnegative()).optional(),
  /**
   * Region keys (carve.ts) punched clean out of the window — fully transparent holes
   * the window contour redraws around.
   */
  holes: z.array(z.string()).optional(),
  /**
   * Draw the (possibly carved) window into the exported sheet itself — how real NEXT
   * screens work over the erased generic_54 texture. Default for new screens.
   */
  bakeWindow: z.boolean().optional(),
});

export type Element = z.infer<typeof ElementSchema>;
export type Hotspot = z.infer<typeof HotspotSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export function newProject(module: string, screenKey: string, codepoint: string): Project {
  return {
    version: 1,
    module,
    screenKey,
    rows: 6,
    codepoint,
    // 13 makes sheet coordinates equal window coordinates; the NEXT convention of
    // higher ascents only matters for artwork drawn lower on the canvas.
    ascent: 13,
    shift: -8,
    fallbackTitle: screenKey,
    textureFile: `custom_ui/${module}/${screenKey}.png`,
    elements: [],
    hotspots: [],
    bakeWindow: true,
  };
}

export function parseProject(text: string): Project {
  return ProjectSchema.parse(JSON.parse(text));
}

export function serializeProject(project: Project): string {
  return JSON.stringify(ProjectSchema.parse(project), null, 2) + "\n";
}
