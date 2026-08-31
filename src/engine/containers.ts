// SPDX-License-Identifier: GPL-3.0-or-later
import { z } from "zod";
import {
  CELL,
  COLS,
  GRID_X,
  SHEET_TO_WINDOW_Y,
  TITLE_X,
  WELL,
  WINDOW_W,
  hotbarY,
  playerInvY,
  slotIndex,
  slotWindowRect,
  windowHeight,
} from "./geometry";

/**
 * A container screen's geometry, as data.
 *
 * Slotify used to be a chest: `geometry.ts` hard-codes 176 wide, nine columns and the
 * canonical (8,18) origin, and every renderer reads those constants directly. An anvil
 * does not fit anywhere in that — not for want of a feature, for want of a type. This is
 * the type. See SLOTIFY-VISION.md §0.
 *
 * The rule that makes it worth having: **a profile is measured, never typed.** Slot
 * positions come out of the container's own texture (`detectContainer` in `detect.ts` —
 * a vanilla well has an exact pixel signature), and the title anchor, which lives in
 * client code and appears in no texture, is calibrated once against a screenshot. What
 * ships here is the part that can be known without either: what the screen is called,
 * how many slots it has, and which file to measure.
 *
 * Nothing here contains Mojang pixels, and nothing here should ever grow a coordinate
 * somebody typed from memory: a wrong constant in this file is a screen that is two
 * pixels off on a server nobody can debug from here.
 */

/** One slot: a raw index, and where the client puts its 16×16 item area. */
export const SlotSpecSchema = z.object({
  /** Exactly what `InventoryClickEvent.getRawSlot()` reports. */
  index: z.number().int().nonnegative(),
  /** Window coordinates of the item area's top-left corner. */
  x: z.number().int(),
  y: z.number().int(),
});

/**
 * A rectangle the client draws into after the background — the anvil's text field and
 * level cost, the furnace's flame and arrow, the brewing stand's bubbles, the merchant's
 * scroll bar. Art placed here loses.
 */
export const HazardRectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  /** What draws there, shown on the canvas next to the hatching. */
  what: z.string().min(1),
});

/**
 * Where the title glyph lands, expressed as the only two numbers the engine ever uses.
 *
 * Not `titleLabelX/Y`: those describe where a *string* starts, and turning them into
 * sheet arithmetic means reasoning about the font's own ascent, which is one more place
 * to be wrong. `k` is measured directly — draw a marker at a known sheet row, look at
 * which window row it landed on, solve. See `calibrate.ts`.
 */
export const TitleOriginSchema = z.object({
  /** Window x of the title's first pixel. 8 on the chest (`TITLE_X`). */
  x: z.number().int(),
  /** `windowY = sheetY − ascent + k`. 13 on the chest (`SHEET_TO_WINDOW_Y`). */
  k: z.number().int(),
});

/** How much of a profile is measurement and how much is still an assumption. */
export const ProfileSourceSchema = z.enum(["derived", "detected", "calibrated"]);

export const ContainerProfileSchema = z.object({
  /** Stable id, referenced by a project. */
  id: z.string().min(1),
  name: z.string(),
  windowW: z.number().int().positive(),
  windowH: z.number().int().positive(),
  /**
   * How this screen turns a sheet into a window. `null` until somebody calibrates it: an
   * origin guessed from another screen is exactly the silent failure Slotify exists to
   * prevent.
   */
  titleOrigin: TitleOriginSchema.nullable(),
  /** The container's own slots, raw indices ascending. */
  slots: z.array(SlotSpecSchema),
  /** The viewer's inventory: 0–26 main, 27–35 hotbar, matching `hiddenInvSlots`. */
  inventory: z.array(SlotSpecSchema),
  clientDraws: z.array(HazardRectSchema),
  source: ProfileSourceSchema,
  /**
   * False when the raw indices were proposed from reading order rather than known. The
   * furnace is the standing counter-example: its result slot is drawn above its fuel
   * slot but numbered after it.
   */
  indicesVerified: z.boolean(),
  /** What was measured, or what still has to be. */
  notes: z.array(z.string()),
});

/**
 * Every profile a pack has measured, saved beside it.
 *
 * The file is the point. Slotify does not know where the anvil's title sits; the first
 * person who calibrates it does, and a file that travels with the pack — or into this
 * repository — means nobody measures the same screen twice.
 */
export const ContainerLibrarySchema = z.object({
  version: z.literal(1),
  profiles: z.array(ContainerProfileSchema),
});

/** Beside `slotify.profile.json`, and discovered the same way. */
export const CONTAINERS_FILE = "slotify.containers.json";

export type SlotSpec = z.infer<typeof SlotSpecSchema>;
export type HazardRect = z.infer<typeof HazardRectSchema>;
export type TitleOrigin = z.infer<typeof TitleOriginSchema>;
export type ProfileSource = z.infer<typeof ProfileSourceSchema>;
export type ContainerProfile = z.infer<typeof ContainerProfileSchema>;
export type ContainerLibrary = z.infer<typeof ContainerLibrarySchema>;

export function parseContainerLibrary(text: string): ContainerLibrary {
  return ContainerLibrarySchema.parse(JSON.parse(text));
}

export function serializeContainerLibrary(library: ContainerLibrary): string {
  return JSON.stringify(ContainerLibrarySchema.parse(library), null, 2) + "\n";
}

/**
 * A container Slotify knows the name of. Everything geometric is deliberately absent:
 * `texture` says which file to measure and `slotCount` says when the measurement is
 * complete, and that is the whole contract.
 */
export interface ContainerKind {
  id: string;
  name: string;
  /** Candidate paths under `assets/minecraft/textures/`, first match wins. */
  texture: string[];
  /** How many slots the container itself has. Detection that finds fewer is incomplete. */
  slotCount: number;
  /** Does the client draw the title at all? */
  drawsTitle: boolean;
  /**
   * Detection order → raw index, when the two are known to differ. Absent means reading
   * order is proposed and `indicesVerified` stays false.
   */
  indexOrder?: number[];
}

/**
 * The screens a plugin can open with a title of its own.
 *
 * `slotCount` is a gameplay fact and is safe to state. Coordinates are not stated, here
 * or anywhere else in this file.
 */
export const CONTAINER_KINDS: readonly ContainerKind[] = [
  {
    id: "anvil",
    name: "Anvil",
    texture: ["gui/container/anvil.png"],
    slotCount: 3,
    drawsTitle: true,
    // Left input, right input, result — drawn in that order across one row, so reading
    // order and raw order agree.
    indexOrder: [0, 1, 2],
  },
  {
    id: "furnace",
    name: "Furnace",
    texture: ["gui/container/furnace.png"],
    slotCount: 3,
    drawsTitle: true,
    // The trap: 0 input, 1 fuel, 2 result, but the result is drawn above the fuel, so
    // reading order hands them over as input, result, fuel.
    indexOrder: [0, 2, 1],
  },
  {
    id: "blast_furnace",
    name: "Blast furnace",
    texture: ["gui/container/blast_furnace.png"],
    slotCount: 3,
    drawsTitle: true,
    indexOrder: [0, 2, 1],
  },
  {
    id: "smoker",
    name: "Smoker",
    texture: ["gui/container/smoker.png"],
    slotCount: 3,
    drawsTitle: true,
    indexOrder: [0, 2, 1],
  },
  {
    id: "brewing_stand",
    name: "Brewing stand",
    texture: ["gui/container/brewing_stand.png"],
    slotCount: 5,
    drawsTitle: true,
  },
  {
    id: "hopper",
    name: "Hopper",
    texture: ["gui/container/hopper.png"],
    slotCount: 5,
    drawsTitle: true,
    indexOrder: [0, 1, 2, 3, 4],
  },
  {
    id: "dispenser",
    name: "Dispenser / dropper",
    texture: ["gui/container/dispenser.png"],
    slotCount: 9,
    drawsTitle: true,
    indexOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  },
  {
    id: "crafting_table",
    name: "Crafting table",
    texture: ["gui/container/crafting_table.png"],
    slotCount: 10,
    drawsTitle: true,
  },
  {
    id: "enchanting_table",
    name: "Enchanting table",
    texture: ["gui/container/enchanting_table.png"],
    slotCount: 2,
    drawsTitle: true,
  },
  {
    id: "grindstone",
    name: "Grindstone",
    texture: ["gui/container/grindstone.png"],
    slotCount: 3,
    drawsTitle: true,
  },
  {
    id: "stonecutter",
    name: "Stonecutter",
    texture: ["gui/container/stonecutter.png"],
    slotCount: 2,
    drawsTitle: true,
  },
  {
    id: "cartography_table",
    name: "Cartography table",
    texture: ["gui/container/cartography_table.png"],
    slotCount: 3,
    drawsTitle: true,
  },
  {
    id: "loom",
    name: "Loom",
    texture: ["gui/container/loom.png"],
    slotCount: 4,
    drawsTitle: true,
  },
  {
    id: "smithing",
    name: "Smithing table",
    texture: ["gui/container/smithing.png"],
    slotCount: 4,
    drawsTitle: true,
  },
  {
    id: "beacon",
    name: "Beacon",
    texture: ["gui/container/beacon.png"],
    slotCount: 1,
    drawsTitle: true,
  },
  {
    id: "merchant",
    name: "Villager trades",
    texture: ["gui/container/villager2.png", "gui/container/villager.png"],
    slotCount: 3,
    drawsTitle: true,
  },
];

export function containerKind(id: string): ContainerKind | undefined {
  return CONTAINER_KINDS.find((kind) => kind.id === id);
}

/** The chest ids a project can name: `chest1` … `chest6`. */
export function chestId(rows: number): string {
  return `chest${rows}`;
}

/**
 * The chest profile, derived from `geometry.ts` rather than restated.
 *
 * `source: "derived"` and not `"detected"`: these numbers are not a measurement of a
 * texture, they are the constants the whole tool was built on and which the golden tests
 * already check against production. Deriving instead of copying is what keeps a rewired
 * renderer provably identical to the one it replaces.
 */
export function chestProfile(rows: number): ContainerProfile {
  if (!Number.isInteger(rows) || rows < 1 || rows > 6) {
    throw new Error(`chest rows out of range: ${rows}`);
  }

  const slots: SlotSpec[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < COLS; col++) {
      const rect = slotWindowRect(row, col);
      slots.push({ index: slotIndex(row, col), x: rect.x, y: rect.y });
    }
  }

  return {
    id: chestId(rows),
    name: rows === 6 ? "Chest (6 rows)" : `Chest (${rows} rows)`,
    windowW: WINDOW_W,
    windowH: windowHeight(rows),
    titleOrigin: { x: TITLE_X, k: SHEET_TO_WINDOW_Y },
    slots,
    inventory: viewerInventory(playerInvY(rows), hotbarY(rows)),
    clientDraws: [],
    source: "derived",
    indicesVerified: true,
    notes: [],
  };
}

/**
 * The viewer's 36 slots, given where the client puts the two blocks.
 *
 * Indices are the ones `hiddenInvSlots` already uses — 0–26 main, 27–35 hotbar — not the
 * raw indices, which depend on how many slots the container above them has.
 */
export function viewerInventory(invY: number, barY: number): SlotSpec[] {
  const slots: SlotSpec[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < COLS; col++) {
      slots.push({ index: row * COLS + col, x: GRID_X + CELL * col, y: invY + CELL * row });
    }
  }
  for (let col = 0; col < COLS; col++) {
    slots.push({ index: 27 + col, x: GRID_X + CELL * col, y: barY });
  }
  return slots;
}

/** Every slot rectangle a profile draws, container first. */
export function profileWells(profile: ContainerProfile): { x: number; y: number; w: number; h: number }[] {
  return [...profile.slots, ...profile.inventory].map((slot) => ({
    x: slot.x,
    y: slot.y,
    w: WELL,
    h: WELL,
  }));
}

/**
 * What is still missing before a profile can be drawn on without guessing.
 *
 * Used by the UI to keep an unfinished profile visibly unfinished. A screen designed
 * against a profile with no title anchor is a screen whose ascent nobody can compute.
 */
export function profileGaps(profile: ContainerProfile, kind?: ContainerKind): string[] {
  const gaps: string[] = [];
  if (profile.titleOrigin === null) {
    gaps.push("title origin not calibrated — open the screen in game and paste a screenshot");
  }
  if (kind && profile.slots.length !== kind.slotCount) {
    gaps.push(
      `found ${profile.slots.length} of ${kind.slotCount} container slots — the rest are drawn some other way, or this texture has them erased`,
    );
  }
  if (!profile.indicesVerified) {
    gaps.push("raw slot indices proposed from reading order, not verified");
  }
  if (profile.inventory.length !== 0 && profile.inventory.length !== 36) {
    gaps.push(`viewer inventory has ${profile.inventory.length} slots, expected 36 or none`);
  }
  return gaps;
}

export type ProfileLookup =
  | { ok: true; profile: ContainerProfile }
  | { ok: false; problem: string };

/**
 * The profile a project should be drawn against.
 *
 * A project that names no container is a chest of `rows` rows — every project written
 * before profiles existed, and every project that will ever be written for the screens
 * this tool was built for. A project that names one and cannot find it does **not** fall
 * back to a chest: drawing an anvil on chest geometry produces a screen that looks right
 * here and is wrong in game, which is the whole class of bug this exists to close.
 */
export function resolveProfile(
  containerId: string | undefined,
  rows: number,
  library?: ContainerLibrary,
): ProfileLookup {
  if (containerId === undefined) return { ok: true, profile: chestProfile(rows) };

  const chest = /^chest([1-6])$/.exec(containerId);
  if (chest) return { ok: true, profile: chestProfile(Number(chest[1])) };

  const found = library?.profiles.find((profile) => profile.id === containerId);
  if (found) return { ok: true, profile: found };

  return {
    ok: false,
    problem: `no profile called "${containerId}" in ${CONTAINERS_FILE} — measure that container before designing for it`,
  };
}
