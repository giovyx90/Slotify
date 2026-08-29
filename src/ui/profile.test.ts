// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { findProfile, geometryWarnings, type Profile } from "./model";
import type { DirEntry, FsBackend } from "../platform/fs";

/** A filesystem that is only the files it is given, so discovery can be pinned down. */
function fakeBackend(files: Record<string, string>): FsBackend {
  return {
    async roots() {
      return {};
    },
    async list(path: string): Promise<DirEntry[]> {
      const prefix = `${path}/`;
      const names = Object.keys(files)
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length).split("/")[0]!);
      if (names.length === 0) throw new Error(`no such directory: ${path}`);
      return [...new Set(names)].map((name) => ({ name, dir: !name.includes(".") }));
    },
    async read() {
      throw new Error("not used here");
    },
    async readText(path: string) {
      const text = files[path];
      if (text == null) throw new Error(`no such file: ${path}`);
      return text;
    },
    async write() {},
    async delete() {},
  };
}

const base: Profile = {
  version: 1,
  name: "test",
  paths: { fontDir: "font", guiFont: "gui.json", textureRoots: ["pack"] },
};

describe("findProfile", () => {
  it("prefers a profile at the root of the repository", async () => {
    const backend = fakeBackend({
      "/repo/slotify.profile.json": "{}",
      "/repo/tools/slotify/next.profile.json": "{}",
    });
    expect(await findProfile(backend, "/repo")).toBe("slotify.profile.json");
  });

  it("finds the NEXT monorepo's profile where it actually lives", async () => {
    const backend = fakeBackend({ "/repo/tools/slotify/next.profile.json": "{}" });
    expect(await findProfile(backend, "/repo")).toBe("tools/slotify/next.profile.json");
  });

  it("falls back to any *.profile.json in the usual directories", async () => {
    const backend = fakeBackend({ "/repo/tools/slotify/acme.profile.json": "{}" });
    expect(await findProfile(backend, "/repo")).toBe("tools/slotify/acme.profile.json");
  });

  it("never picks the gitignored local file, which is where the secrets are", async () => {
    const backend = fakeBackend({ "/repo/tools/slotify/acme.profile.local.json": "{}" });
    expect(await findProfile(backend, "/repo")).toBeNull();
  });

  it("answers null for a repository that is not a pack", async () => {
    expect(await findProfile(fakeBackend({}), "/repo")).toBeNull();
  });
});

describe("geometryWarnings", () => {
  it("says nothing when the profile agrees with the engine", () => {
    expect(
      geometryWarnings({
        ...base,
        geometry: { sheetCanvas: 256, windowWidth: 176, cell: 18, gridOrigin: [8, 18], sheetToWindowY: 13 },
        spacers: { negativeBase: "U+E8D0", positiveBase: "U+E8D8", maxPower: 6 },
      }),
    ).toEqual([]);
  });

  it("reports a cell size the engine does not use", () => {
    const warnings = geometryWarnings({ ...base, geometry: { cell: 16 } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("cell 16");
  });

  it("reports a grid origin off the canonical (8,18)", () => {
    expect(geometryWarnings({ ...base, geometry: { gridOrigin: [7, 17] } })[0]).toContain("(7,17)");
  });

  it("reads spacer bases as codepoints, not as strings", () => {
    expect(geometryWarnings({ ...base, spacers: { negativeBase: "U+E8D0" } })).toEqual([]);
    expect(geometryWarnings({ ...base, spacers: { negativeBase: "U+E900" } })).toHaveLength(1);
  });

  it("says nothing at all when the profile declares no geometry", () => {
    expect(geometryWarnings(base)).toEqual([]);
  });
});
