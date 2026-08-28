// SPDX-License-Identifier: GPL-3.0-or-later
import { bitmapCells, type ParsedBitmap, type ParsedFont, type ParsedSpace } from "./fontJson";
import { formatCodepoint } from "./unicode";

/**
 * The codepoint registry the NEXT repository never had (MODULE-TODO §3.3): who owns
 * every glyph, which codepoints are claimed twice, which are referenced by code or
 * config but have no provider, and where the next free one in a module's range is.
 *
 * Two collisions were already paid for in production before this existed — a City Hall
 * glyph assigned to a band the bank owned, found only when the screen opened wrong.
 */

export interface GlyphOwner {
  fontFile: string;
  providerIndex: number;
  textureFile: string;
  ascent: number;
  height: number;
  /** Grid position within the provider, for sheet textures always (0,0). */
  row: number;
  col: number;
}

export interface SpacerOwner {
  fontFile: string;
  providerIndex: number;
  advance: number;
}

export interface Registry {
  /** Every bitmap claim, keyed by codepoint. More than one owner = a collision. */
  glyphs: Map<number, GlyphOwner[]>;
  /** Every space-provider claim, keyed by codepoint. */
  spacers: Map<number, SpacerOwner[]>;
}

export function buildRegistry(fonts: readonly ParsedFont[]): Registry {
  const glyphs = new Map<number, GlyphOwner[]>();
  const spacers = new Map<number, SpacerOwner[]>();

  for (const font of fonts) {
    for (const provider of font.providers) {
      if (provider.kind === "bitmap") {
        addBitmap(glyphs, font.name, provider);
      } else if (provider.kind === "space") {
        addSpace(spacers, font.name, provider);
      }
    }
  }

  return { glyphs, spacers };
}

function addBitmap(map: Map<number, GlyphOwner[]>, fontFile: string, provider: ParsedBitmap): void {
  for (const { codepoint, row, col } of bitmapCells(provider)) {
    const owners = map.get(codepoint) ?? [];
    owners.push({
      fontFile,
      providerIndex: provider.index,
      textureFile: provider.file,
      ascent: provider.ascent,
      height: provider.height,
      row,
      col,
    });
    map.set(codepoint, owners);
  }
}

function addSpace(map: Map<number, SpacerOwner[]>, fontFile: string, provider: ParsedSpace): void {
  for (const [codepoint, advance] of provider.advances) {
    const owners = map.get(codepoint) ?? [];
    owners.push({ fontFile, providerIndex: provider.index, advance });
    map.set(codepoint, owners);
  }
}

export interface Collision {
  codepoint: number;
  /** Bitmap and/or spacer claims — a codepoint that is both is also a collision. */
  owners: (GlyphOwner | SpacerOwner)[];
}

/**
 * Codepoints claimed more than once **within the same font file**. Two different fonts
 * sharing a codepoint is vanilla-legal (a title picks one font); two providers of one
 * font sharing it means the later one silently wins in game.
 */
export function collisions(registry: Registry): Collision[] {
  const out: Collision[] = [];

  const byFont = (owners: (GlyphOwner | SpacerOwner)[]): Map<string, (GlyphOwner | SpacerOwner)[]> => {
    const map = new Map<string, (GlyphOwner | SpacerOwner)[]>();
    for (const owner of owners) {
      const list = map.get(owner.fontFile) ?? [];
      list.push(owner);
      map.set(owner.fontFile, list);
    }
    return map;
  };

  const all = new Map<number, (GlyphOwner | SpacerOwner)[]>();
  for (const [codepoint, owners] of registry.glyphs) {
    all.set(codepoint, [...owners]);
  }
  for (const [codepoint, owners] of registry.spacers) {
    all.set(codepoint, [...(all.get(codepoint) ?? []), ...owners]);
  }

  for (const [codepoint, owners] of all) {
    for (const sameFont of byFont(owners).values()) {
      if (sameFont.length > 1) {
        out.push({ codepoint, owners: sameFont });
        break;
      }
    }
  }

  return out.sort((a, b) => a.codepoint - b.codepoint);
}

export interface Reference {
  codepoint: number;
  /** Where it was seen: a file path, with whatever detail the scanner adds. */
  source: string;
}

/** References with no provider anywhere — the screens that open grey with nothing in any log. */
export function dangling(registry: Registry, references: readonly Reference[]): Reference[] {
  return references.filter(
    (ref) => !registry.glyphs.has(ref.codepoint) && !registry.spacers.has(ref.codepoint),
  );
}

export interface CodepointRange {
  module: string;
  first: number;
  last: number;
}

/** The next unclaimed codepoint inside a module's declared range, or null if it is full. */
export function nextFree(registry: Registry, range: CodepointRange): number | null {
  for (let codepoint = range.first; codepoint <= range.last; codepoint++) {
    if (!registry.glyphs.has(codepoint) && !registry.spacers.has(codepoint)) return codepoint;
  }
  return null;
}

/** Ranges that overlap each other — the E880–E8BF story, caught before art is commissioned. */
export function overlappingRanges(ranges: readonly CodepointRange[]): [CodepointRange, CodepointRange][] {
  const out: [CodepointRange, CodepointRange][] = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      if (a.first <= b.last && b.first <= a.last) out.push([a, b]);
    }
  }
  return out;
}

/** Human-readable one-liner for reports and the UI. */
export function describeOwner(owner: GlyphOwner | SpacerOwner): string {
  if ("advance" in owner) {
    return `${owner.fontFile}#${owner.providerIndex} space advance ${owner.advance}`;
  }
  return `${owner.fontFile}#${owner.providerIndex} ${owner.textureFile} ascent ${owner.ascent}`;
}

export function describeCollision(collision: Collision): string {
  return `${formatCodepoint(collision.codepoint)}: ${collision.owners.map(describeOwner).join(" | ")}`;
}
