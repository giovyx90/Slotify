// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Reading a few files out of a zip, so importing a Minecraft jar is one button.
 *
 * Slotify measures container geometry off the game's own textures. Asking an artist to
 * find, unzip and copy those files in is the difference between a tool and a chore, so
 * the app opens the jar itself and reads only the entries it needs.
 *
 * Not a zip library: no zip64, no encryption, no stored-with-data-descriptor edge cases
 * beyond what a jar actually contains. Deflate comes from the platform's own
 * `DecompressionStream`, which Chromium and Node both have, so this adds no dependency.
 *
 * **Nothing extracted here is ever written to disk.** The textures are decoded, measured
 * and dropped; what survives is the numbers. A pack must not grow a copy of Mojang's art
 * because a tool found it convenient.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

class Reader {
  constructor(private readonly view: DataView) {}

  u16(offset: number): number {
    return this.view.getUint16(offset, true);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, true);
  }
}

/**
 * The end-of-central-directory record, found by scanning backwards.
 *
 * It has no fixed position because it ends with a comment of arbitrary length. 64KB back
 * is the whole possible range of that comment, so a scan that far always finds it or the
 * file is not a zip.
 */
function findEndOfCentral(reader: Reader, size: number): number | null {
  const earliest = Math.max(0, size - 0xffff - 22);
  for (let offset = size - 22; offset >= earliest; offset--) {
    if (reader.u32(offset) === END_OF_CENTRAL) return offset;
  }
  return null;
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const reader = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const end = findEndOfCentral(reader, bytes.length);
  if (end === null) throw new Error("not a zip file: no end-of-central-directory record");

  const count = reader.u16(end + 10);
  let offset = reader.u32(end + 16);
  const entries: CentralEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (reader.u32(offset) !== CENTRAL_HEADER) break;
    const nameLength = reader.u16(offset + 28);
    const extraLength = reader.u16(offset + 30);
    const commentLength = reader.u16(offset + 32);
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      method: reader.u16(offset + 10),
      compressedSize: reader.u32(offset + 20),
      uncompressedSize: reader.u32(offset + 24),
      localOffset: reader.u32(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Every entry whose name `wanted` accepts, decompressed.
 *
 * Sizes come from the central directory, never from the local header: an entry written
 * with a data descriptor carries zeroes there, and a jar built by any modern tool has
 * plenty of those.
 */
export async function readZipEntries(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Promise<ZipEntry[]> {
  const reader = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const out: ZipEntry[] = [];

  for (const entry of readCentralDirectory(bytes)) {
    if (!wanted(entry.name)) continue;
    if (reader.u32(entry.localOffset) !== LOCAL_HEADER) continue;

    const nameLength = reader.u16(entry.localOffset + 26);
    const extraLength = reader.u16(entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const raw = bytes.subarray(start, start + entry.compressedSize);

    if (entry.method === 0) {
      out.push({ name: entry.name, bytes: raw.slice() });
    } else if (entry.method === 8) {
      out.push({ name: entry.name, bytes: await inflate(raw) });
    }
    // Anything else (bzip2, lzma, …) is not something a Minecraft jar contains; skipping
    // it loses one texture rather than failing the whole import.
  }

  return out;
}

/** Where the container backgrounds live inside a client jar. */
export const CONTAINER_TEXTURE_PREFIX = "assets/minecraft/textures/gui/container/";

export function isContainerTexture(name: string): boolean {
  return name.startsWith(CONTAINER_TEXTURE_PREFIX) && name.endsWith(".png");
}
