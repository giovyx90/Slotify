// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { findProfile, geometryWarnings, inferLayout, loadPack, type Profile } from "./model";
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

describe("inferLayout", () => {
  const FONT = "assets/minecraft/font/default.json";

  it("recognises a plain resource pack, fonts at the root", async () => {
    const layout = await inferLayout(fakeBackend({ [`/repo/${FONT}`]: "{}" }), "/repo");
    expect(layout.fontDir).toBe("assets/minecraft/font");
    expect(layout.textureRoots).toEqual([""]);
  });

  it("recognises one directory per category at the root", async () => {
    const backend = fakeBackend({
      [`/repo/locker/${FONT}`]: "{}",
      [`/repo/bank/${FONT}`]: "{}",
    });
    const layout = await inferLayout(backend, "/repo");
    expect(layout.fontDir).toBe("bank/assets/minecraft/font");
    expect(layout.textureRoots).toEqual([""]);
  });

  it("prefers _shared, which is where a categorised pack keeps the common font", async () => {
    const backend = fakeBackend({
      [`/repo/locker/${FONT}`]: "{}",
      [`/repo/_shared/${FONT}`]: "{}",
    });
    expect((await inferLayout(backend, "/repo")).fontDir).toBe("_shared/assets/minecraft/font");
  });

  it("finds categories one container down, the NEXT monorepo shape", async () => {
    const backend = fakeBackend({
      [`/repo/pack-source/_shared/${FONT}`]: "{}",
      [`/repo/pack-source/locker/${FONT}`]: "{}",
    });
    const layout = await inferLayout(backend, "/repo");
    expect(layout.fontDir).toBe("pack-source/_shared/assets/minecraft/font");
    expect(layout.textureRoots).toEqual(["pack-source"]);
  });

  it("assumes the plain shape for an empty folder, which is a pack about to start", async () => {
    const layout = await inferLayout(fakeBackend({}), "/repo");
    expect(layout.fontDir).toBe("assets/minecraft/font");
    expect(layout.note).toContain("nothing found");
  });
});

describe("loadPack without a profile", () => {
  it("opens a plain pack instead of refusing", async () => {
    const backend = fakeBackend({
      "/repo/assets/minecraft/font/gui.json": JSON.stringify({ providers: [] }),
    });
    const pack = await loadPack(backend, "/repo");
    expect(pack.profilePath).toBeNull();
    expect(pack.inferred).toContain("plain resource pack");
    expect(pack.profile.paths.fontDir).toBe("assets/minecraft/font");
  });

  it("opens an empty folder, so a pack can be started from nothing", async () => {
    const pack = await loadPack(fakeBackend({}), "/repo");
    expect(pack.fonts).toEqual([]);
    expect(pack.screens).toEqual([]);
  });

  it("still prefers a profile that is actually written down", async () => {
    const backend = fakeBackend({
      "/repo/slotify.profile.json": JSON.stringify({
        version: 1,
        name: "Written",
        paths: { fontDir: "custom/font", guiFont: "gui.json", textureRoots: ["x"] },
      }),
      "/repo/assets/minecraft/font/gui.json": "{}",
    });
    const pack = await loadPack(backend, "/repo");
    expect(pack.profilePath).toBe("slotify.profile.json");
    expect(pack.inferred).toBeNull();
    expect(pack.profile.name).toBe("Written");
  });
});
