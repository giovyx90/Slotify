// SPDX-License-Identifier: GPL-3.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectContainer } from "./detect";
import { decodePng } from "./png";
import { CONTAINER_TEXTURE_PREFIX, isContainerTexture, readZipEntries } from "./zip";

/** A zip built here, so the reader is tested against bytes and not against a mock. */
async function buildZip(files: { name: string; body: Uint8Array; deflate: boolean }[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const stored = file.deflate
      ? new Uint8Array(
          await new Response(
            new Blob([file.body as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw")),
          ).arrayBuffer(),
        )
      : file.body;

    const local = new Uint8Array(30 + name.length + stored.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, file.deflate ? 8 : 0, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, file.body.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(stored, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, file.deflate ? 8 : 0, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, file.body.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = [...locals, ...centrals, end];
  const out = new Uint8Array(total.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of total) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("readZipEntries", () => {
  it("reads both stored and deflated entries", async () => {
    const zip = await buildZip([
      { name: "a/plain.txt", body: text("stored, uncompressed"), deflate: false },
      { name: "a/squeezed.txt", body: text("deflated ".repeat(80)), deflate: true },
    ]);

    const entries = await readZipEntries(zip, () => true);
    expect(entries.map((entry) => entry.name)).toEqual(["a/plain.txt", "a/squeezed.txt"]);
    expect(new TextDecoder().decode(entries[0]!.bytes)).toBe("stored, uncompressed");
    expect(new TextDecoder().decode(entries[1]!.bytes)).toBe("deflated ".repeat(80));
  });

  it("reads only what was asked for, so a 30MB jar costs one inflate per texture", async () => {
    const zip = await buildZip([
      { name: "wanted.png", body: text("yes"), deflate: true },
      { name: "com/mojang/Huge.class", body: text("no".repeat(5000)), deflate: true },
    ]);

    const entries = await readZipEntries(zip, (name) => name.endsWith(".png"));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("wanted.png");
  });

  it("refuses something that is not a zip, by name", async () => {
    await expect(readZipEntries(text("PNG, actually, at some length"), () => true)).rejects.toThrow("not a zip");
  });
});

describe("isContainerTexture", () => {
  it("takes the container backgrounds and nothing else", () => {
    expect(isContainerTexture(`${CONTAINER_TEXTURE_PREFIX}anvil.png`)).toBe(true);
    expect(isContainerTexture("assets/minecraft/textures/gui/sprites/widget/button.png")).toBe(false);
    expect(isContainerTexture(`${CONTAINER_TEXTURE_PREFIX}anvil.png.mcmeta`)).toBe(false);
  });
});

/**
 * Against a real client jar, when one is on this machine. Gated like the other goldens:
 * the public suite must stay green on a checkout with no Minecraft installed, and no
 * Mojang bytes ever enter this repository.
 */
describe.runIf(process.env.SLOTIFY_CLIENT_JAR && existsSync(process.env.SLOTIFY_CLIENT_JAR))(
  "a real Minecraft client jar",
  () => {
    it("gives up every container background, and the anvil measures", async () => {
      const jar = readFileSync(process.env.SLOTIFY_CLIENT_JAR!);
      const entries = await readZipEntries(new Uint8Array(jar), isContainerTexture);
      expect(entries.length).toBeGreaterThan(15);

      const anvil = entries.find((entry) => entry.name.endsWith("/anvil.png"));
      expect(anvil).toBeDefined();

      const detection = detectContainer(decodePng(anvil!.bytes));
      expect(detection.window.w).toBe(176);
      expect(detection.window.h).toBe(166);
      // The vanilla anvil keeps its three slots; NEXT's copy has them erased.
      expect(detection.container).toHaveLength(3);
      expect(detection.inventory).toHaveLength(27);
      expect(detection.hotbar).toHaveLength(9);
    });
  },
);
