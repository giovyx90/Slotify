// SPDX-License-Identifier: GPL-3.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderWindow } from "./chestRenderer";
import { chestProfile, type ContainerKind } from "./containers";
import { detectContainer, detectWells, largestOpaqueRegion, profileFromDetection, splitViewerInventory } from "./detect";
import { COLS } from "./geometry";
import { drawSlotWell, put } from "./paint";
import { decodePng } from "./png";
import { makeRaster } from "./raster";

/** A kind that claims what a chest of `rows` rows has, so indices come back verified. */
const chestKind = (rows: number): ContainerKind => ({
  id: `chest${rows}`,
  name: `Chest (${rows} rows)`,
  texture: [],
  slotCount: rows * COLS,
  drawsTitle: true,
  indexOrder: [...Array(rows * COLS).keys()],
});

describe("detection round-trips the one geometry we already trust", () => {
  // The chest is the only container whose numbers are checked against production (the
  // golden locker tests). If detection can read a rendered chest back into the profile
  // that drew it, it can be believed about a container nobody here has measured.
  for (const rows of [1, 3, 6]) {
    it(`reads a ${rows}-row chest back into its own profile`, () => {
      const raster = renderWindow({ rows });
      const detection = detectContainer(raster, chestKind(rows));
      const measured = profileFromDetection(`chest${rows}`, "", detection, chestKind(rows));
      const expected = chestProfile(rows);

      expect(measured.windowW).toBe(expected.windowW);
      expect(measured.windowH).toBe(expected.windowH);
      expect(measured.slots).toEqual(expected.slots);
      expect(measured.inventory).toEqual(expected.inventory);
      expect(measured.indicesVerified).toBe(true);
    });
  }

  it("leaves the title origin unmeasured, because no texture carries it", () => {
    const measured = profileFromDetection("chest6", "", detectContainer(renderWindow({ rows: 6 })));
    expect(measured.titleOrigin).toBeNull();
    expect(measured.source).toBe("detected");
  });

  it("proposes reading order, and says so, when the raw numbering is unknown", () => {
    const measured = profileFromDetection("chest3", "", detectContainer(renderWindow({ rows: 3 })));
    expect(measured.indicesVerified).toBe(false);
    expect(measured.slots.map((slot) => slot.index)).toEqual([...Array(27).keys()]);
  });

  it("does not invent slots a texture has had erased", () => {
    const raster = renderWindow({ rows: 6, hiddenContainerSlots: new Set([0, 1, 2]) });
    const detection = detectContainer(raster, chestKind(6));
    expect(detection.container).toHaveLength(51);
    expect(detection.notes.join(" ")).toContain("51 of 54 container slots found");
  });
});

describe("splitViewerInventory", () => {
  it("finds the four-row block by its shape, not by being last", () => {
    const raster = renderWindow({ rows: 6 });
    const { wells } = detectWells(raster);
    const split = splitViewerInventory(wells);
    expect(split.container).toHaveLength(54);
    expect(split.inventory).toHaveLength(27);
    expect(split.hotbar).toHaveLength(9);
    // 18px pitch through the inventory, then the 4px break before the hotbar.
    expect(split.hotbar[0]!.y - split.inventory[18]!.y).toBe(22);
  });

  it("reports no inventory rather than guessing when the screen hides it", () => {
    const raster = renderWindow({ rows: 6, hideViewerInventory: true });
    const detection = detectContainer(raster);
    expect(detection.inventory).toEqual([]);
    expect(detection.notes.join(" ")).toContain("no viewer inventory found");
  });
});

describe("largestOpaqueRegion", () => {
  it("ignores a sprite parked elsewhere in the same file", () => {
    const raster = makeRaster(64, 64);
    for (let y = 2; y < 30; y++) for (let x = 2; x < 40; x++) put(raster, x, y, [1, 2, 3, 255]);
    // A detached 4×4 blob, the way a furnace stores its flame next to its background.
    for (let y = 50; y < 54; y++) for (let x = 50; x < 54; x++) put(raster, x, y, [9, 9, 9, 255]);

    expect(largestOpaqueRegion(raster)).toEqual({ x: 2, y: 2, w: 38, h: 28 });
  });

  it("returns null for an empty texture", () => {
    expect(largestOpaqueRegion(makeRaster(8, 8))).toBeNull();
  });
});

describe("detectWells", () => {
  it("does not report a smear of matches inside one large grey field", () => {
    const raster = makeRaster(64, 64);
    // A 40×40 block of the well grey: one candidate, at its top-left, not 625 of them.
    for (let y = 4; y < 44; y++) for (let x = 4; x < 44; x++) put(raster, x, y, [139, 139, 139, 255]);
    const found = detectWells(raster);
    expect(found.wells).toEqual([]);
    expect(found.unbevelled).toEqual([{ x: 4, y: 4 }]);
  });

  it("wants the dark bevel, so a restyled slot is reported and not silently counted", () => {
    const raster = makeRaster(32, 32);
    drawSlotWell(raster, 8, 8);
    expect(detectWells(raster).wells).toEqual([{ x: 8, y: 8 }]);

    const restyled = makeRaster(32, 32);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) put(restyled, x, y, [139, 139, 139, 255]);
    expect(detectWells(restyled).wells).toEqual([]);
    expect(detectWells(restyled).unbevelled).toEqual([{ x: 8, y: 8 }]);
  });
});

/**
 * Against a real container texture in the NEXT pack. Gated on SLOTIFY_NEXT_REPO like the
 * other golden tests, so the public suite stays green without a checkout.
 *
 * This anvil is NEXT's own, restyled for the access screens: its three container slots
 * have been erased, and the numbers below are what that actually measures to. A tool that
 * reported three anvil slots here would be inventing them.
 */
describe.runIf(process.env.SLOTIFY_NEXT_REPO)("the NEXT pack's anvil", () => {
  const repo = process.env.SLOTIFY_NEXT_REPO!;
  const texture = join(repo, "pack-source/access/assets/minecraft/textures/gui/container/anvil.png");

  it.runIf(existsSync(texture))("measures 176×166 with the viewer's inventory at y=84", () => {
    const detection = detectContainer(decodePng(readFileSync(texture)));

    expect(detection.window).toEqual({ x: 0, y: 0, w: 176, h: 166 });
    expect(detection.inventory).toHaveLength(27);
    expect(detection.hotbar).toHaveLength(9);
    expect(detection.inventory[0]).toEqual({ x: 8, y: 84 });
    expect(detection.hotbar[0]).toEqual({ x: 8, y: 142 });
    // Two pixels shorter than a chest of the same shape, and its inventory two pixels
    // higher: the reason a container profile cannot be derived from the chest formula.
    expect(detection.container).toEqual([]);
  });
});
