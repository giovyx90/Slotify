// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { composeTitle, originsOf, spacerAdvance, spacerString, type Sheet } from "./spacers";

/**
 * Mirror of NEXTLocker's LockerGlyphsTest — the layering arithmetic and the two
 * mistakes it exists to catch: a clamped spacer, and a "backtrack by the base every
 * time" bug that happens to be right for the first overlay only.
 */

// The locker sheet table, advances as measured by build_sheets.py and shipped in LockerGlyphs.
const MAIN: Sheet = { codepoint: 0xe8a9, advance: 178 };
const MAIN_MANAGE_LIT: Sheet = { codepoint: 0xe8aa, advance: 76 };
const MANAGE: Sheet = { codepoint: 0xe8b2, advance: 250 };
const MANAGE_YES_DARK: Sheet = { codepoint: 0xe8b3, advance: 114 };
const MANAGE_NO_DARK: Sheet = { codepoint: 0xe8b4, advance: 169 };
const MANAGE_SAVE_LIT: Sheet = { codepoint: 0xe8b5, advance: 169 };

const ALL = [MAIN, MAIN_MANAGE_LIT, MANAGE, MANAGE_YES_DARK, MANAGE_NO_DARK, MANAGE_SAVE_LIT];

function advanceFor(codepoint: number): number {
  const sheet = ALL.find((candidate) => candidate.codepoint === codepoint);
  if (!sheet) throw new Error(`Unknown sheet: U+${codepoint.toString(16)}`);
  return sheet.advance;
}

function measure(spacer: string): number {
  let total = 0;
  for (const char of spacer) {
    const advance = spacerAdvance(char.codePointAt(0)!);
    if (advance === null) throw new Error("not a spacer");
    total += advance;
  }
  return total;
}

function origins(flat: string): number[] {
  return originsOf(flat, advanceFor).map((entry) => entry.origin);
}

describe("spacerString", () => {
  it("is exact for every distance in range", () => {
    for (let pixels = -600; pixels <= 600; pixels++) {
      expect(measure(spacerString(pixels)), `at ${pixels}`).toBe(pixels);
    }
  });

  it("does not clamp the widest backtrack", () => {
    // The manage sheet. A copied 127-pixel clamp would emit -127 here.
    expect(measure(spacerString(-MANAGE.advance))).toBe(-MANAGE.advance);
  });

  it("emits nothing for zero", () => {
    expect(spacerString(0)).toBe("");
  });
});

describe("composeTitle + originsOf", () => {
  it("starts a bare sheet at the shift", () => {
    expect(origins(composeTitle(-8, MAIN))).toEqual([-8]);
  });

  it("lands one overlay on the base origin", () => {
    expect(origins(composeTitle(-8, MAIN, [MAIN_MANAGE_LIT]))).toEqual([-8, -8]);
  });

  it("shares one origin across three stacked sheets with two different advances", () => {
    expect(
      origins(composeTitle(-8, MANAGE, [MANAGE_YES_DARK, MANAGE_NO_DARK, MANAGE_SAVE_LIT])),
    ).toEqual([-8, -8, -8, -8]);
  });

  it("does not shift the rest when an overlay is skipped", () => {
    expect(origins(composeTitle(-8, MANAGE, [null, MANAGE_NO_DARK, MANAGE_SAVE_LIT]))).toEqual([
      -8, -8, -8,
    ]);
  });
});
