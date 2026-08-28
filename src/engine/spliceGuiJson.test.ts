// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codepointsOf } from "./unicode";
import { formatProvider, spliceProviders } from "./spliceGuiJson";

const cp = (codepoint: number): string => String.fromCodePoint(codepoint);

/** A minimal but structurally faithful gui.json: single line, ends in `]}`. */
const SMALL = `{"providers": [${[
  `{"type": "bitmap", "file": "custom_ui/access/lock.png", "ascent": 30, "height": 256, "chars": ["${cp(0xe8a0)}"]}`,
  `{"type": "bitmap", "file": "custom_ui/broadcast/desk.png", "ascent": 14, "height": 256, "chars": ["${cp(0x28a64)}"]}`,
  `{"type": "space", "advances": {"${cp(0xe8d0)}": -1}}`,
].join(", ")}]}`;

describe("formatProvider", () => {
  it("writes the exact json.dumps(ensure_ascii=False) shape", () => {
    expect(formatProvider({ codepoint: 0xe8b2, file: "custom_ui/locker/manage.png", ascent: 26 })).toBe(
      `{"type": "bitmap", "file": "custom_ui/locker/manage.png", "ascent": 26, "height": 256, "chars": ["${cp(0xe8b2)}"]}`,
    );
  });
});

describe("spliceProviders", () => {
  const NEW = { codepoint: 0xe8b0, file: "custom_ui/locker/expired_boxes.png", ascent: 26 };

  it("splices before the closing bracket and touches nothing else", () => {
    const result = spliceProviders(SMALL, [NEW]);
    expect(result.added).toEqual([0xe8b0]);
    expect(result.text.startsWith(SMALL.slice(0, -2))).toBe(true);
    expect(result.text.trimEnd().endsWith(`${formatProvider(NEW)}]}`)).toBe(true);
  });

  it("is idempotent — the second run adds nothing", () => {
    const once = spliceProviders(SMALL, [NEW]);
    const twice = spliceProviders(once.text, [NEW]);
    expect(twice.added).toEqual([]);
    expect(twice.skipped).toEqual([0xe8b0]);
    expect(twice.text).toBe(once.text);
  });

  it("corrects a wrong ascent in place without touching any other byte", () => {
    const wrong = spliceProviders(SMALL, [{ ...NEW, ascent: 30 }]).text;
    const fixed = spliceProviders(wrong, [NEW]);
    expect(fixed.corrected).toEqual([0xe8b0]);
    expect(fixed.added).toEqual([]);
    expect(fixed.text).toBe(wrong.replace('"ascent": 30, "height": 256, "chars": ["' + cp(0xe8b0), '"ascent": 26, "height": 256, "chars": ["' + cp(0xe8b0)));
  });

  it("skips codepoints claimed by the space provider too", () => {
    const result = spliceProviders(SMALL, [{ codepoint: 0xe8d0, file: "custom_ui/x/y.png", ascent: 1 }]);
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([0xe8d0]);
  });

  it("keeps astral characters intact as code points", () => {
    const result = spliceProviders(SMALL, [NEW]);
    const astral = codepointsOf(result.text).filter((codepoint) => codepoint > 0xffff);
    expect(astral).toContain(0x28a64);
  });

  it("refuses a file that does not end in ]} — e.g. one that was pretty-printed", () => {
    const pretty = JSON.stringify(JSON.parse(SMALL), null, 2);
    expect(() => spliceProviders(pretty, [NEW])).toThrow(/refusing to splice/);
  });
});

const repo = process.env.SLOTIFY_NEXT_REPO;

describe.skipIf(!repo)("golden: byte-identity against the real gui.json", () => {
  // Read lazily: the describe body runs even when the suite is skipped.
  const loadRaw = (): string =>
    readFileSync(join(repo!, "pack-source/_shared/assets/minecraft/font/gui.json"), "utf-8");

  /** (codepoint, name, ascent) exactly as tools/locker-pack/write_font.py declares them. */
  const LOCKER: [number, string, number][] = [
    [0xe8a9, "locker_main", 27],
    [0xe8aa, "locker_main_manage", 27],
    [0xe8ab, "locker_user", 28],
    [0xe8ac, "locker_user_collect", 28],
    [0xe8ad, "box_creator", 26],
    [0xe8ae, "box_creator_create", 26],
    [0xe8af, "box_creator_assign", 26],
    [0xe8b0, "expired_boxes", 26],
    [0xe8b1, "expired_boxes_collect", 26],
    [0xe8b2, "manage", 26],
    [0xe8b3, "manage_yes_dark", 26],
    [0xe8b4, "manage_no_dark", 26],
    [0xe8b5, "manage_save", 26],
    [0xe8b6, "insert_name", 16],
    [0xe8b7, "box_preview", 29],
  ];

  it("re-formats every locker provider to the exact bytes the file holds", () => {
    const raw = loadRaw();
    for (const [codepoint, name, ascent] of LOCKER) {
      const formatted = formatProvider({
        codepoint,
        file: `custom_ui/locker/${name}.png`,
        ascent,
      });
      expect(raw.includes(formatted), formatted).toBe(true);
    }
  });

  it("round-trips: splicing the locker providers into the real file is a no-op", () => {
    const raw = loadRaw();
    const result = spliceProviders(
      raw,
      LOCKER.map(([codepoint, name, ascent]) => ({
        codepoint,
        file: `custom_ui/locker/${name}.png`,
        ascent,
      })),
    );
    expect(result.added).toEqual([]);
    expect(result.corrected).toEqual([]);
    expect(result.text).toBe(raw);
  });
});
