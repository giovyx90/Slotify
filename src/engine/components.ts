// SPDX-License-Identifier: GPL-3.0-or-later
import { z } from "zod";
import { ElementSchema, type Element } from "./project";

/**
 * The shared component library — the NXMenu-style piece of the editor. A component is
 * either **composite** (a group of Slotify elements saved with coordinates relative to
 * its own top-left, re-instantiated as ordinary editable elements) or a **sprite** (an
 * imported PNG placed 1:1 as a locked image).
 *
 * Components live per profile, next to the pack they were designed for
 * (`tools/slotify/components/<id>.json`, sprites with a PNG of the same id beside
 * them), so they version with it and every future screen starts from the same parts.
 */

export const ComponentSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  kind: z.enum(["composite", "sprite"]),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** Composite only: elements relative to (0,0). */
  elements: z.array(ElementSchema).optional(),
});

export type LibraryComponent = z.infer<typeof ComponentSchema>;

export function parseComponent(text: string): LibraryComponent {
  return ComponentSchema.parse(JSON.parse(text));
}

export function serializeComponent(component: LibraryComponent): string {
  return JSON.stringify(ComponentSchema.parse(component), null, 2) + "\n";
}

/** Builds a composite from live elements: coordinates are re-anchored to the group box. */
export function componentFromElements(
  id: string,
  name: string,
  elements: readonly Element[],
): LibraryComponent {
  if (elements.length === 0) throw new Error("a component needs at least one element");

  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.w));
  const maxY = Math.max(...elements.map((element) => element.y + element.h));

  return {
    version: 1,
    id,
    name,
    kind: "composite",
    w: maxX - minX,
    h: maxY - minY,
    elements: elements.map((element) => ({ ...element, x: element.x - minX, y: element.y - minY })),
  };
}

/**
 * Places a component at (x, y): a composite becomes ordinary elements (fresh ids, fully
 * editable — the library is a starting point, not a link); a sprite becomes one locked
 * sprite element referencing the component's PNG.
 */
export function instantiate(
  component: LibraryComponent,
  x: number,
  y: number,
  nextId: () => string,
): Element[] {
  if (component.kind === "sprite") {
    return [
      { id: nextId(), kind: "sprite", x, y, w: component.w, h: component.h, sprite: component.id },
    ];
  }

  return (component.elements ?? []).map((element) => ({
    ...element,
    id: nextId(),
    x: x + element.x,
    y: y + element.y,
  }));
}

/** A safe library id from a human name: `Cube Buzzer` -> `cube-buzzer`. */
export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`cannot make an id out of ${JSON.stringify(name)}`);
  return slug;
}
