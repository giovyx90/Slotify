// SPDX-License-Identifier: GPL-3.0-or-later
import { codepointsOf } from "./unicode";

/**
 * Parser for vanilla `assets/minecraft/font/*.json` provider files.
 *
 * Only the two provider types painted GUIs rely on are modelled: `bitmap` and `space`.
 * Anything else (`ttf`, `legacy_unicode`, …) is carried through as `other` so a scan can
 * still report the file completely.
 */

export interface ParsedBitmap {
  kind: "bitmap";
  /** As written in the json, e.g. `custom_ui/locker/manage.png` or `minecraft:...`. */
  file: string;
  ascent: number;
  height: number;
  /**
   * The glyph grid: one row per `chars` entry, one codepoint per column.
   * `0` (U+0000) marks an empty cell, as vanilla does.
   */
  grid: number[][];
  /** Index of this provider within its file — collisions cite it. */
  index: number;
}

export interface ParsedSpace {
  kind: "space";
  /** codepoint -> advance in pixels. */
  advances: Map<number, number>;
  index: number;
}

export interface ParsedOther {
  kind: "other";
  type: string;
  index: number;
}

export type ParsedProvider = ParsedBitmap | ParsedSpace | ParsedOther;

export interface ParsedFont {
  /** The file name this came from, e.g. `gui.json`. */
  name: string;
  providers: ParsedProvider[];
}

export function parseFont(name: string, text: string): ParsedFont {
  const root = JSON.parse(text) as { providers?: unknown[] };
  if (!Array.isArray(root.providers)) {
    throw new Error(`${name}: no "providers" array`);
  }

  const providers: ParsedProvider[] = root.providers.map((raw, index) => {
    const provider = raw as Record<string, unknown>;

    if (provider.type === "bitmap") {
      const chars = provider.chars as string[];
      // `height` is optional in vanilla (defaults to 8); every GUI sheet declares it.
      return {
        kind: "bitmap",
        file: String(provider.file),
        ascent: Number(provider.ascent),
        height: provider.height === undefined ? 8 : Number(provider.height),
        grid: chars.map((row) => codepointsOf(row)),
        index,
      } satisfies ParsedBitmap;
    }

    if (provider.type === "space") {
      const advances = new Map<number, number>();
      for (const [key, value] of Object.entries(provider.advances as Record<string, number>)) {
        for (const codepoint of codepointsOf(key)) advances.set(codepoint, value);
      }
      return { kind: "space", advances, index } satisfies ParsedSpace;
    }

    return { kind: "other", type: String(provider.type), index } satisfies ParsedOther;
  });

  return { name, providers };
}

/** Every codepoint a bitmap provider declares, with its grid position. */
export function* bitmapCells(
  provider: ParsedBitmap,
): Generator<{ codepoint: number; row: number; col: number }> {
  for (let row = 0; row < provider.grid.length; row++) {
    const cells = provider.grid[row]!;
    for (let col = 0; col < cells.length; col++) {
      const codepoint = cells[col]!;
      if (codepoint !== 0) yield { codepoint, row, col };
    }
  }
}
