// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  CONTAINER_KINDS,
  chestId,
  chestProfile,
  containerKind,
  parseContainerLibrary,
  profileGaps,
  resolveProfile,
  serializeContainerLibrary,
  viewerInventory,
} from "./containers";
import { COLS, GRID_X, hotbarY, playerInvY, slotWindowRect, windowHeight } from "./geometry";

describe("chest profile", () => {
  it("restates geometry.ts exactly, for every row count", () => {
    for (let rows = 1; rows <= 6; rows++) {
      const profile = chestProfile(rows);
      expect(profile.id).toBe(chestId(rows));
      expect(profile.windowH).toBe(windowHeight(rows));
      expect(profile.slots).toHaveLength(rows * COLS);

      for (let index = 0; index < rows * COLS; index++) {
        const rect = slotWindowRect(Math.floor(index / COLS), index % COLS);
        expect(profile.slots[index]).toEqual({ index, x: rect.x, y: rect.y });
      }
    }
  });

  it("puts the viewer's 36 slots where the client does", () => {
    const profile = chestProfile(6);
    expect(profile.inventory).toHaveLength(36);
    expect(profile.inventory[0]).toEqual({ index: 0, x: GRID_X, y: playerInvY(6) });
    expect(profile.inventory[26]).toEqual({
      index: 26,
      x: GRID_X + 8 * 18,
      y: playerInvY(6) + 2 * 18,
    });
    expect(profile.inventory[27]).toEqual({ index: 27, x: GRID_X, y: hotbarY(6) });
    expect(profile.inventory[35]).toEqual({ index: 35, x: GRID_X + 8 * 18, y: hotbarY(6) });
  });

  it("refuses a row count no chest has", () => {
    expect(() => chestProfile(0)).toThrow();
    expect(() => chestProfile(7)).toThrow();
    expect(() => chestProfile(2.5)).toThrow();
  });

  it("knows its own title origin, because that is the one screen already measured", () => {
    expect(chestProfile(6).titleOrigin).toEqual({ x: 8, k: 13 });
    expect(profileGaps(chestProfile(6))).toEqual([]);
  });
});

describe("viewerInventory", () => {
  it("numbers main inventory 0-26 and the hotbar 27-35, like hiddenInvSlots", () => {
    const slots = viewerInventory(100, 160);
    expect(slots.map((slot) => slot.index)).toEqual([...Array(36).keys()]);
    expect(slots[9]).toEqual({ index: 9, x: GRID_X, y: 118 });
    expect(slots[27]!.y).toBe(160);
  });
});

describe("container kinds", () => {
  it("states no coordinate — a profile is measured, never typed", () => {
    for (const kind of CONTAINER_KINDS) {
      expect(Object.keys(kind).sort()).toEqual(
        expect.arrayContaining(["id", "name", "slotCount", "texture", "drawsTitle"]),
      );
      expect(kind).not.toHaveProperty("windowW");
      expect(kind).not.toHaveProperty("slots");
      expect(kind.texture.length).toBeGreaterThan(0);
      expect(kind.slotCount).toBeGreaterThan(0);
    }
  });

  it("has unique ids and finds them", () => {
    const ids = CONTAINER_KINDS.map((kind) => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(containerKind("anvil")?.slotCount).toBe(3);
    expect(containerKind("nothing")).toBeUndefined();
  });

  it("keeps every index order a permutation of its own slot count", () => {
    for (const kind of CONTAINER_KINDS) {
      if (!kind.indexOrder) continue;
      expect(kind.indexOrder).toHaveLength(kind.slotCount);
      expect([...kind.indexOrder].sort((a, b) => a - b)).toEqual([...Array(kind.slotCount).keys()]);
    }
  });

  it("remembers that the furnace draws its result above its fuel", () => {
    // Reading order hands over input, result, fuel; the raw indices are input, fuel,
    // result. Getting this wrong sends every click to the wrong slot.
    expect(containerKind("furnace")?.indexOrder).toEqual([0, 2, 1]);
  });
});

describe("profileGaps", () => {
  it("keeps an unmeasured profile visibly unmeasured", () => {
    const profile = { ...chestProfile(6), titleOrigin: null, indicesVerified: false };
    const gaps = profileGaps(profile);
    expect(gaps.join(" ")).toContain("title origin not calibrated");
    expect(gaps.join(" ")).toContain("reading order");
  });

  it("counts container slots against what the container should have", () => {
    const anvil = containerKind("anvil")!;
    const profile = { ...chestProfile(6), slots: [] };
    expect(profileGaps(profile, anvil).join(" ")).toContain("found 0 of 3 container slots");
  });
});

describe("resolveProfile", () => {
  const library = {
    version: 1 as const,
    profiles: [
      {
        ...chestProfile(6),
        id: "anvil",
        name: "Anvil",
        source: "calibrated" as const,
        titleOrigin: { x: 8, k: 13 },
      },
    ],
  };

  it("treats a project with no container as the chest it always was", () => {
    const found = resolveProfile(undefined, 3, library);
    expect(found.ok && found.profile.id).toBe("chest3");
  });

  it("reads chest1..chest6 without needing a library", () => {
    expect(resolveProfile("chest1", 6).ok && resolveProfile("chest1", 6)).toMatchObject({
      profile: { slots: expect.objectContaining({ length: 9 }) },
    });
    expect(resolveProfile("chest7", 6, library).ok).toBe(false);
  });

  it("finds a measured profile by name", () => {
    const found = resolveProfile("anvil", 6, library);
    expect(found.ok && found.profile.source).toBe("calibrated");
  });

  it("refuses an unknown container instead of drawing it as a chest", () => {
    const found = resolveProfile("loom", 6, library);
    expect(found.ok).toBe(false);
    expect(found.ok === false && found.problem).toContain("measure that container");
  });
});

describe("the container library round-trips", () => {
  it("survives serialise and parse", () => {
    const library = { version: 1 as const, profiles: [chestProfile(6)] };
    expect(parseContainerLibrary(serializeContainerLibrary(library))).toEqual(library);
  });

  it("refuses a profile with no source rather than assuming one", () => {
    const broken = JSON.stringify({ version: 1, profiles: [{ ...chestProfile(6), source: "guessed" }] });
    expect(() => parseContainerLibrary(broken)).toThrow();
  });
});
