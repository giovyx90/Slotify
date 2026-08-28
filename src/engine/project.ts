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

export const ElementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["slot", "button", "panel", "well", "text", "infobox", "sprite"]),
  /** Window coordinates, pixels. For `slot`, the 16×16 well interior's top-left. */
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Buttons only: drawn pressed-in instead of raised. */
  pressed: z.boolean().optional(),
  /** Fill tint for button/panel/well, background for infobox. */
  color: z.string().regex(HEX).optional(),
  /** Button/text label. One line, game font. */
  label: z.string().optional(),
  textColor: z.string().regex(HEX).optional(),
  /** Infobox body, one string per line. */
  lines: z.array(z.string()).optional(),
  /** Infobox border. */
  borderColor: z.string().regex(HEX).optional(),
  /** Sprite elements: id of the library component whose PNG this draws. */
  sprite: z.string().optional(),
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
  };
}

export function parseProject(text: string): Project {
  return ProjectSchema.parse(JSON.parse(text));
}

export function serializeProject(project: Project): string {
  return JSON.stringify(ProjectSchema.parse(project), null, 2) + "\n";
}
