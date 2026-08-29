// SPDX-License-Identifier: GPL-3.0-or-later
import type { Raster } from "./raster";

/**
 * Named colours.
 *
 * A colour field holds either a literal `#RRGGBB` or a reference `@id` into a palette.
 * The reference is the point: the pack's red is one row in the profile, every screen
 * that used it says `@red`, and the day the red moves half a point every screen that
 * ever said `@red` moves with it — at the next export, with nobody reopening anything.
 *
 * The project's own palette wins over the profile's, so a screen can carry a colour the
 * pack has not adopted yet without editing the pack's file.
 */

export interface Swatch {
  /** Referenced as `@id`; lower-case, dots and dashes allowed. */
  id: string;
  name: string;
  hex: string;
}

export const NAMED_COLOUR = /^@([A-Za-z0-9._-]+)$/;

export function isNamed(value: string | undefined): boolean {
  return value != null && NAMED_COLOUR.test(value);
}

export function nameOf(value: string | undefined): string | null {
  const match = value == null ? null : NAMED_COLOUR.exec(value);
  return match ? match[1]! : null;
}

export function findSwatch(value: string | undefined, palette: readonly Swatch[]): Swatch | undefined {
  const name = nameOf(value);
  return name == null ? undefined : palette.find((swatch) => swatch.id === name);
}

/**
 * A colour field as the renderer wants it: literal hex. A reference nothing defines
 * resolves to `fallback` rather than throwing — a screen whose palette entry was deleted
 * must still draw, so the mistake shows up on the canvas instead of as a blank editor.
 */
export function resolveColour(
  value: string | undefined,
  palette: readonly Swatch[],
  fallback?: string,
): string | undefined {
  if (value == null) return fallback;
  if (!isNamed(value)) return value;
  return findSwatch(value, palette)?.hex ?? fallback;
}

/** Turns a name into an id that can live after an `@`. */
export function swatchId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "colour"
  );
}

/** An id nothing in the palette uses yet, suffixing -2, -3 … as needed. */
export function freeSwatchId(name: string, palette: readonly Swatch[]): string {
  const base = swatchId(name);
  if (!palette.some((swatch) => swatch.id === base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!palette.some((swatch) => swatch.id === candidate)) return candidate;
  }
}

export function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast, 1 to 21. Text on a plate below about 3 is the pixel-font equivalent of
 * mumbling, and the editor says so rather than letting it reach the server.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = parseHex(foreground);
  const b = parseHex(background);
  if (!a || !b) return 21;
  const bright = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (bright + 0.05) / (dark + 0.05);
}

/**
 * The palette entry closest to a colour, by plain RGB distance. Used by the paint
 * tool's "stay on palette" toggle: a colour mixed by hand snaps to the pack's nearest
 * real one, so a screen cannot quietly acquire a twelfth grey.
 */
export function nearestSwatch(hex: string, palette: readonly Swatch[]): Swatch | undefined {
  const target = parseHex(hex);
  if (!target || palette.length === 0) return undefined;

  let best: Swatch | undefined;
  let bestDistance = Infinity;
  for (const swatch of palette) {
    const rgb = parseHex(swatch.hex);
    if (!rgb) continue;
    const distance =
      (rgb[0] - target[0]) ** 2 + (rgb[1] - target[1]) ** 2 + (rgb[2] - target[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = swatch;
    }
  }
  return best;
}

/**
 * The colours a picture is actually made of, commonest first — for lifting a palette off
 * the pack's own art instead of guessing hexes. Fully transparent pixels do not count,
 * and near-identical colours collapse into the one that appears more often.
 */
export function extractPalette(raster: Raster, limit = 12, tolerance = 12): Swatch[] {
  const counts = new Map<string, number>();
  for (let index = 0; index < raster.data.length; index += 4) {
    if (raster.data[index + 3]! < 8) continue;
    const hex = toHex(raster.data[index]!, raster.data[index + 1]!, raster.data[index + 2]!);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  const kept: string[] = [];
  for (const [hex] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const rgb = parseHex(hex)!;
    const tooClose = kept.some((other) => {
      const existing = parseHex(other)!;
      return (
        Math.abs(existing[0] - rgb[0]) +
          Math.abs(existing[1] - rgb[1]) +
          Math.abs(existing[2] - rgb[2]) <
        tolerance
      );
    });
    if (tooClose) continue;
    kept.push(hex);
    if (kept.length >= limit) break;
  }

  return kept.map((hex, index) => ({ id: `sampled-${index + 1}`, name: hex, hex }));
}
