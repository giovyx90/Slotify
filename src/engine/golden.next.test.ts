// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFont, type ParsedFont } from "./fontJson";
import { decodePng } from "./png";
import { advanceOf, impliedAscent, stripIsolated } from "./raster";
import { buildRegistry, collisions } from "./registry";
import { formatCodepoint } from "./unicode";

/**
 * Golden tests against the real NEXT Roleplay pack — the numbers the shipped locker
 * screens were built from (LOCKER-ART-BRIEF §0 and LockerGlyphs.java).
 *
 * Gated on SLOTIFY_NEXT_REPO pointing at a checkout of the NextRoleplay monorepo, so
 * the public repo's test suite stays green without it.
 */

const repo = process.env.SLOTIFY_NEXT_REPO;

const FONT_DIR = "pack-source/_shared/assets/minecraft/font";
const LOCKER_TEXTURES = "pack-source/locker/assets/minecraft/textures/custom_ui/locker";
const DELIVERED = "textures-for-claude/GUI REVAMP/locker";

/** Pack sheet -> { codepoint, advance } as shipped in LockerGlyphs.java. */
const LOCKER_TABLE: Record<string, { codepoint: number; advance: number }> = {
  locker_main: { codepoint: 0xe8a9, advance: 178 },
  locker_main_manage: { codepoint: 0xe8aa, advance: 76 },
  locker_user: { codepoint: 0xe8ab, advance: 177 },
  locker_user_collect: { codepoint: 0xe8ac, advance: 157 },
  box_creator: { codepoint: 0xe8ad, advance: 177 },
  box_creator_create: { codepoint: 0xe8ae, advance: 169 },
  box_creator_assign: { codepoint: 0xe8af, advance: 62 },
  expired_boxes: { codepoint: 0xe8b0, advance: 178 },
  expired_boxes_collect: { codepoint: 0xe8b1, advance: 169 },
  manage: { codepoint: 0xe8b2, advance: 250 },
  manage_yes_dark: { codepoint: 0xe8b3, advance: 114 },
  manage_no_dark: { codepoint: 0xe8b4, advance: 169 },
  manage_save: { codepoint: 0xe8b5, advance: 169 },
  box_preview: { codepoint: 0xe8b7, advance: 251 },
};

/** Sheets with a drawn cell, and which container row their topmost one is (build_sheets.py). */
const CELL_ROWS: Record<string, number> = {
  locker_user: 1,
  box_creator: 0,
  expired_boxes: 0,
  manage: 0,
  box_preview: 0,
};

/** Delivered artwork that carried the famous stray pixels, x column of each. */
const KNOWN_STRAYS: Record<string, number> = {
  locker_main_gui: 245,
  activated_create_glyph: 233,
  active_assign_glyph: 232,
};

function loadFonts(root: string): ParsedFont[] {
  const dir = join(root, FONT_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.includes(".bak"))
    .map((name) => parseFont(name, readFileSync(join(dir, name), "utf-8")));
}

describe.skipIf(!repo)("golden: the real NEXT pack", () => {
  const root = repo!;

  it("re-measures every locker sheet to the advance LockerGlyphs ships", () => {
    for (const [name, expected] of Object.entries(LOCKER_TABLE)) {
      const raster = decodePng(readFileSync(join(root, LOCKER_TEXTURES, `${name}.png`)));
      expect(raster.width, name).toBe(256);
      expect(raster.height, name).toBe(256);
      expect(advanceOf(raster), name).toBe(expected.advance);
    }
  });

  it("derives each base sheet's ascent and matches the declared one in gui.json", () => {
    const gui = parseFont("gui.json", readFileSync(join(root, FONT_DIR, "gui.json"), "utf-8"));
    const declared = new Map<number, number>();
    for (const provider of gui.providers) {
      if (provider.kind !== "bitmap") continue;
      for (const row of provider.grid) for (const codepoint of row) {
        if (codepoint !== 0) declared.set(codepoint, provider.ascent);
      }
    }

    for (const [name, cellRow] of Object.entries(CELL_ROWS)) {
      const { codepoint } = LOCKER_TABLE[name]!;
      const raster = decodePng(readFileSync(join(root, LOCKER_TEXTURES, `${name}.png`)));
      const implied = impliedAscent(raster, cellRow);
      expect(implied, `${name} has a detectable cell`).not.toBeNull();
      expect(implied, `${name} (${formatCodepoint(codepoint)})`).toBe(declared.get(codepoint));
    }
  });

  it("finds the three stray pixels in the delivered artwork", () => {
    for (const [delivered, strayColumn] of Object.entries(KNOWN_STRAYS)) {
      const raster = decodePng(readFileSync(join(root, DELIVERED, `${delivered}.png`)));
      // Before stripping, the stray IS the rightmost opaque column.
      expect(advanceOf(raster), delivered).toBe(strayColumn + 2);
      expect(stripIsolated(raster), delivered).toBeGreaterThanOrEqual(1);
      expect(advanceOf(raster), `${delivered} after strip`).toBeLessThan(strayColumn + 2);
    }
  });

  it("parses every font file and reports gui.json's spacer set", () => {
    const fonts = loadFonts(root);
    const registry = buildRegistry(fonts);

    // The space provider: −1,−2,−4 … at 0xE8D0.., +1,+2,+4 … at 0xE8D8...
    for (let power = 0; power <= 6; power++) {
      const negative = registry.spacers.get(0xe8d0 + power);
      const positive = registry.spacers.get(0xe8d8 + power);
      expect(negative?.some((owner) => owner.advance === -(1 << power))).toBe(true);
      expect(positive?.some((owner) => owner.advance === 1 << power)).toBe(true);
    }

    // The registry sees the whole pack, and same-font collisions are report material,
    // not an assertion — print them the way the tool's registry panel will.
    expect(registry.glyphs.size).toBeGreaterThan(1000);
    for (const collision of collisions(registry)) {
      console.warn("collision:", formatCodepoint(collision.codepoint), collision.owners);
    }
  });
});
