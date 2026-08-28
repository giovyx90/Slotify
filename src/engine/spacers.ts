// SPDX-License-Identifier: GPL-3.0-or-later
import { stringOf } from "./unicode";

/**
 * The cursor arithmetic of a painted title, ported from the one implementation in the
 * NEXT codebase that has tests: `LockerGlyphs.spacerString` and
 * `LockerGlyphsTest.originsOf`.
 *
 * A painted title is a run of invisible space glyphs that walk the cursor, then one or
 * more full-canvas sheet glyphs. Every overlay must backtrack by the advance of the sheet
 * drawn immediately before it — not the base's, not a constant. And the spacer loops
 * until the distance is spent instead of clamping: the widest real backtrack today is
 * 250px, and a copied 127px clamp lays the overlay 123px off, silently.
 */

export interface SpacerSet {
  /** Base codepoint of the −1px spacer; −2 is base+1, −4 base+2, … */
  negativeBase: number;
  /** Base codepoint of the +1px spacer. */
  positiveBase: number;
  /** Highest power of two present; NEXT declares up to 64 (index 6). */
  maxPower: number;
}

/** The `space` provider every drawn screen on NEXT uses (gui.json, provider 810). */
export const NEXT_SPACERS: SpacerSet = { negativeBase: 0xe8d0, positiveBase: 0xe8d8, maxPower: 6 };

/** The advance of one spacer codepoint, or null if it is not a spacer of this set. */
export function spacerAdvance(codepoint: number, set: SpacerSet = NEXT_SPACERS): number | null {
  if (codepoint >= set.negativeBase && codepoint <= set.negativeBase + set.maxPower) {
    return -(1 << (codepoint - set.negativeBase));
  }
  if (codepoint >= set.positiveBase && codepoint <= set.positiveBase + set.maxPower) {
    return 1 << (codepoint - set.positiveBase);
  }
  return null;
}

/**
 * A run of spacer characters moving the cursor by exactly `pixels`.
 * Largest power first, looping — never clamping. Zero emits the empty string.
 */
export function spacerString(pixels: number, set: SpacerSet = NEXT_SPACERS): string {
  let remaining = Math.abs(pixels);
  const base = pixels < 0 ? set.negativeBase : set.positiveBase;
  let out = "";

  for (let index = set.maxPower; index >= 0 && remaining > 0; index--) {
    const step = 1 << index;
    while (remaining >= step) {
      out += stringOf(base + index);
      remaining -= step;
    }
  }

  return out;
}

/** One drawn sheet: what to draw, and how far drawing it moves the cursor. */
export interface Sheet {
  codepoint: number;
  /** Rightmost opaque column + 2, measured from the PNG — never authored by hand. */
  advance: number;
}

/**
 * The flat character run of a layered title: `spacer(shift)` + base + per overlay
 * `spacer(−previous sheet's advance)` + overlay. A null overlay is skipped without
 * moving the cursor, exactly as `LockerGlyphs.title` does.
 */
export function composeTitle(
  shiftPixels: number,
  base: Sheet,
  overlays: readonly (Sheet | null)[] = [],
  set: SpacerSet = NEXT_SPACERS,
): string {
  let out = spacerString(shiftPixels, set) + stringOf(base.codepoint);
  let drawn = base.advance;

  for (const overlay of overlays) {
    if (overlay === null) continue;
    out += spacerString(-drawn, set) + stringOf(overlay.codepoint);
    drawn = overlay.advance;
  }

  return out;
}

/**
 * Replays a flat title the way the client would: spacers move the cursor, a glyph is
 * drawn where the cursor is and then advances it.
 *
 * @returns where each drawn glyph's own pixel 0 landed, in drawing order
 */
export function originsOf(
  flat: string,
  advanceFor: (codepoint: number) => number,
  set: SpacerSet = NEXT_SPACERS,
): { codepoint: number; origin: number }[] {
  let cursor = 0;
  const drawn: { codepoint: number; origin: number }[] = [];

  for (const char of flat) {
    const codepoint = char.codePointAt(0)!;
    const spacer = spacerAdvance(codepoint, set);

    if (spacer !== null) {
      cursor += spacer;
      continue;
    }

    drawn.push({ codepoint, origin: cursor });
    cursor += advanceFor(codepoint);
  }

  return drawn;
}
