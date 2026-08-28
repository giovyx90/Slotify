// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseFont } from "./fontJson";
import {
  buildRegistry,
  collisions,
  dangling,
  nextFree,
  overlappingRanges,
} from "./registry";
import { formatCodepoint, parseCodepoint } from "./unicode";

// Codepoints built with fromCodePoint, never as literal characters — a raw private-use
// glyph in a source file is an invisible box that survives until an editor re-encodes it.
const cp = (codepoint: number): string => String.fromCodePoint(codepoint);

const GUI_FIXTURE = JSON.stringify({
  providers: [
    {
      type: "bitmap",
      file: "custom_ui/locker/manage.png",
      ascent: 26,
      height: 256,
      chars: [cp(0xe8b2)],
    },
    {
      type: "bitmap",
      file: "custom_ui/tags/grid.png",
      ascent: 7,
      height: 8,
      chars: [cp(0xe900) + cp(0) + cp(0xe902), cp(0xe903) + cp(0xe904) + cp(0)],
    },
    // The collision: a second provider claiming U+E8B2 in the same font.
    {
      type: "bitmap",
      file: "custom_ui/other/oops.png",
      ascent: 30,
      height: 256,
      chars: [cp(0xe8b2)],
    },
    { type: "space", advances: { [cp(0xe8d0)]: -1, [cp(0xe8d1)]: -2, [cp(0xe8d8)]: 1 } },
  ],
});

describe("parseFont", () => {
  it("expands grids with U+0000 gaps and keeps grid positions", () => {
    const font = parseFont("gui.json", GUI_FIXTURE);
    const grid = font.providers[1];
    expect(grid?.kind).toBe("bitmap");
    if (grid?.kind !== "bitmap") return;
    expect(grid.grid).toEqual([
      [0xe900, 0, 0xe902],
      [0xe903, 0xe904, 0],
    ]);
  });

  it("survives astral codepoints as single cells", () => {
    // Broadcast and robbery use astral-plane codepoints — two UTF-16 units each.
    const font = parseFont(
      "gui.json",
      JSON.stringify({
        providers: [{ type: "bitmap", file: "x.png", ascent: 14, height: 256, chars: [cp(0x28a64)] }],
      }),
    );
    const provider = font.providers[0];
    if (provider?.kind !== "bitmap") throw new Error("expected bitmap");
    expect(provider.grid).toEqual([[0x28a64]]);
  });
});

describe("registry", () => {
  const registry = buildRegistry([parseFont("gui.json", GUI_FIXTURE)]);

  it("reports the same-font collision and nothing else", () => {
    const found = collisions(registry);
    expect(found.map((collision) => collision.codepoint)).toEqual([0xe8b2]);
    expect(found[0]!.owners).toHaveLength(2);
  });

  it("flags references with no provider — the grey-screen class of bug", () => {
    const refs = [
      { codepoint: 0xe8b2, source: "LockerGlyphs.java" },
      { codepoint: 0xe84b, source: "CityHallGuiTitle.java" },
    ];
    expect(dangling(registry, refs).map((ref) => ref.codepoint)).toEqual([0xe84b]);
  });

  it("allocates the next free codepoint inside a module's range", () => {
    expect(nextFree(registry, { module: "locker", first: 0xe8b2, last: 0xe8b4 })).toBe(0xe8b3);
    expect(nextFree(registry, { module: "spacers", first: 0xe8d0, last: 0xe8d1 })).toBeNull();
  });

  it("detects overlapping module ranges — the E880–E8BF story", () => {
    const farm = { module: "farm", first: 0xe880, last: 0xe8bf };
    const bank = { module: "bank-transfer", first: 0xe883, last: 0xe88c };
    const hospital = { module: "hospital", first: 0xe8c0, last: 0xe8ff };
    expect(overlappingRanges([farm, bank, hospital])).toEqual([[farm, bank]]);
  });
});

describe("unicode helpers", () => {
  it("round-trips the notations codepoints travel in", () => {
    expect(formatCodepoint(0xe8a9)).toBe("U+E8A9");
    expect(parseCodepoint("U+E8A9")).toBe(0xe8a9);
    expect(parseCodepoint("0xE8A9")).toBe(0xe8a9);
    expect(parseCodepoint(59561)).toBe(0xe8a9);
    expect(() => parseCodepoint("locker")).toThrow();
  });
});
