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
/**
 * Either a literal or a reference into the palette. `@brand.red` keeps the decision in
 * one place: change the swatch and every screen that named it changes at the next
 * export, without anybody reopening them.
 */
const COLOUR = /^(#[0-9a-fA-F]{6}|@[A-Za-z0-9._-]+)$/;

export const SwatchSchema = z.object({
  /** Referenced as `@id`. */
  id: z.string().regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1),
  hex: z.string().regex(HEX),
});

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

/** How a plate's edge is drawn. `double` is the same bevel two pixels deep. */
export const PlateStyleSchema = z.enum(["single", "double", "flat"]);

export const TextAlignSchema = z.enum(["left", "center", "right"]);

/** A cell of the 18px tile lattice (borders shared with the slot grid, origin (7,17)). */
export const TileCellSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

export const ElementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["slot", "button", "panel", "well", "text", "infobox", "sprite", "tiles", "paint"]),
  /** Window coordinates, pixels. For `slot`, the 16×16 well interior's top-left. */
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Buttons only: drawn pressed-in instead of raised. */
  pressed: z.boolean().optional(),
  /** Fill tint for button/panel/well/tiles, background override for infobox. */
  color: z.string().regex(COLOUR).optional(),
  /** Button/text/tile-button label. One line. */
  label: z.string().optional(),
  textColor: z.string().regex(COLOUR).optional(),
  /** Infobox body, one string per line. */
  lines: z.array(z.string()).optional(),
  /** Per-line colours, aligned with `lines`; null falls back to textColor. */
  lineColors: z.array(z.string().regex(COLOUR).nullable()).optional(),
  /** Infobox border override (procedural fallback only — the skin wins when loaded). */
  borderColor: z.string().regex(COLOUR).optional(),
  /** Sprite elements: id of the library component whose PNG this draws. */
  sprite: z.string().optional(),
  /**
   * Paint elements: the hand-painted pixels, base64 of a PNG the size of the element.
   *
   * Inside the project file on purpose. A sidecar would diff better, but the history is
   * a snapshot of the serialised project, so pixels kept outside it are pixels undo
   * cannot reach, a draft cannot save and copy-paste cannot carry to another screen.
   */
  paint: z.string().optional(),
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
  /** Button/tile-button edge treatment. Default single, the vanilla one-pixel bevel. */
  bevel: PlateStyleSchema.optional(),
  /** Where a label or the infobox lines sit across the box. Default centre. */
  align: TextAlignSchema.optional(),
  /** Nudges the text off that position, in pixels. */
  textDx: z.number().int().optional(),
  textDy: z.number().int().optional(),
  /** Not drawn, and therefore not exported. The layer list keeps it in reach. */
  hidden: z.boolean().optional(),
  /** Ignored by clicks on the canvas: a big panel stops swallowing what sits on it. */
  locked: z.boolean().optional(),
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

/**
 * A state drawn *on top of* the base screen: its own sheet, its own codepoint, its own
 * provider — and nothing of the window in it.
 *
 * This is how a screen gets a second state without being redrawn. The title string is
 * base + overlay (see `composeTitle`), the client draws both glyphs at the same origin,
 * and the overlay's transparent pixels are the base showing through. An overlay that
 * baked the window would paint over the very thing it is meant to sit on, so
 * `overlayProject` forces that off rather than trusting the field.
 */
export const OverlaySchema = z.object({
  /** Stable: it names the Java constant and the exported texture. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  codepoint: z.string().regex(/^U\+[0-9A-Fa-f]{4,6}$/),
  textureFile: z.string().min(1),
  /**
   * Almost always absent: an overlay authored in the base's window coordinates wants the
   * base's ascent, and giving it its own is how a state ends up a few pixels off.
   */
  ascent: z.number().int().optional(),
  elements: z.array(ElementSchema),
  /** Slots this state makes clickable, on top of whatever the base already offers. */
  hotspots: z.array(HotspotSchema).default([]),
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
  /**
   * Colours this screen names for itself. Looked up before the profile's palette, so a
   * screen can carry a colour the pack has not adopted yet without editing the pack.
   */
  palette: z.array(SwatchSchema).optional(),
  elements: z.array(ElementSchema),
  hotspots: z.array(HotspotSchema),
  /** States drawn over this screen, each its own sheet. Order is the title's order. */
  overlays: z.array(OverlaySchema).default([]),
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
   * Remove opaque pixels with fewer than two opaque neighbours before measuring.
   *
   * On by default, and it should stay on for a screen built out of elements: one stray
   * pixel far to the right inflates the advance and drags every overlay across the
   * screen, invisibly. But it is a blunt rule — the tip of a hand-painted line, a single
   * pixel dot, a one-pixel serif all have one neighbour — so a screen that is painted by
   * hand can turn it off and watch the advance itself.
   */
  stripStrays: z.boolean().optional(),
  /**
   * Draw the (possibly carved) window into the exported sheet itself — how real NEXT
   * screens work over the erased generic_54 texture. Default for new screens.
   */
  bakeWindow: z.boolean().optional(),
});

export type Element = z.infer<typeof ElementSchema>;
export type Hotspot = z.infer<typeof HotspotSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Swatch = z.infer<typeof SwatchSchema>;
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
    overlays: [],
    bakeWindow: true,
  };
}

export function parseProject(text: string): Project {
  return ProjectSchema.parse(JSON.parse(text));
}

export function serializeProject(project: Project): string {
  return JSON.stringify(ProjectSchema.parse(project), null, 2) + "\n";
}
