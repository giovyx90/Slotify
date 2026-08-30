// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it as test } from "vitest";
import { en } from "./messages.en";
import { it } from "./messages.it";

/**
 * The guard on the two tables.
 *
 * TypeScript already forces Italian to carry every English key; what it cannot see is a
 * translation that quietly drops a `{placeholder}`, which ships as a status line missing
 * the number it was written to report. That, and plural stems arriving with only half
 * their pair, are what this file is for.
 */

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();

describe("message tables", () => {
  test("carry the same keys in both directions", () => {
    expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
  });

  test("carry the same placeholders per key", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(it[key]), key).toEqual(placeholders(en[key]));
    }
  });

  test("give every plural stem both halves", () => {
    const stems = new Set(
      Object.keys(en)
        .filter((key) => key.endsWith(".one") || key.endsWith(".other"))
        .map((key) => key.replace(/\.(one|other)$/, "")),
    );
    expect(stems.size).toBeGreaterThan(0);
    for (const stem of stems) {
      expect(en, stem).toHaveProperty(`${stem}.one`);
      expect(en, stem).toHaveProperty(`${stem}.other`);
    }
  });

  /*
   * Only the plural half has to name the count. "Aligned in the window" is the better
   * singular of "3 layers aligned" precisely because it drops the 1, and a rule that
   * forced the number back in would be a rule against writing well.
   */
  test("keep the count in every plural form", () => {
    for (const [key, text] of Object.entries(en)) {
      if (!key.endsWith(".other")) continue;
      expect(placeholders(text), key).toContain("n");
      expect(placeholders(it[key as keyof typeof en]), key).toContain("n");
    }
  });

  test("leave no message empty", () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim().length, key).toBeGreaterThan(0);
      expect(it[key as keyof typeof en].trim().length, key).toBeGreaterThan(0);
    }
  });
});
