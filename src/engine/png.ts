// SPDX-License-Identifier: GPL-3.0-or-later
import { decode, encode } from "fast-png";
import type { Raster } from "./raster";

/**
 * PNG decode/encode on raw bytes, normalised to RGBA8.
 *
 * Deliberately not the browser's image pipeline: a canvas premultiplies alpha, and a
 * semi-transparent pixel that comes back off by one changes what `advanceOf` and
 * `stripIsolated` measure. `fast-png` hands us the file's actual bytes.
 */
/**
 * Expand 1, 2 or 4-bit samples to one byte each.
 *
 * PNG packs sub-byte samples most significant first and starts every scanline on a byte
 * boundary. Vanilla Minecraft GUI textures are 4-bit indexed — `anvil.png` is a 16-colour
 * palette, two pixels to the byte — so a decoder that assumes one byte per sample reads
 * the left half of the image as the whole of it, and silently. That is how an import can
 * measure a window at 256 wide and be believed.
 */
export function unpackBits(
  packed: Uint8Array,
  width: number,
  height: number,
  depth: number,
): Uint8Array {
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  const rowBytes = Math.ceil(width / perByte);
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = packed[y * rowBytes + Math.floor(x / perByte)] ?? 0;
      const shift = 8 - depth * ((x % perByte) + 1);
      out[y * width + x] = (byte >> shift) & mask;
    }
  }

  return out;
}

export function decodePng(bytes: Uint8Array): Raster {
  const image = decode(bytes);
  const pixels = image.width * image.height;
  const out = new Uint8Array(pixels * 4);
  const sub = image.depth < 8;

  const source =
    image.depth === 16
      ? (() => {
          const wide = image.data as Uint16Array;
          const narrow = new Uint8Array(wide.length);
          for (let i = 0; i < wide.length; i++) narrow[i] = wide[i]! >> 8;
          return narrow;
        })()
      : sub
        ? unpackBits(image.data as Uint8Array, image.width, image.height, image.depth)
        : (image.data as Uint8Array);

  const palette = image.palette;

  if (palette) {
    // Indexed colour: one channel of palette indices.
    for (let i = 0; i < pixels; i++) {
      const entry = palette[source[i]!] ?? [0, 0, 0];
      out[i * 4] = entry[0]!;
      out[i * 4 + 1] = entry[1]!;
      out[i * 4 + 2] = entry[2]!;
      out[i * 4 + 3] = entry.length > 3 ? entry[3]! : 255;
    }
  } else {
    const channels = image.channels;
    for (let i = 0; i < pixels; i++) {
      const base = i * channels;
      if (channels === 1) {
        // A sub-byte greyscale sample is a fraction of its own range, not a byte: at
        // depth 1 the two values are black and white, not 0 and 1.
        const value = sub ? Math.round((source[base]! * 255) / ((1 << image.depth) - 1)) : source[base]!;
        out.set([value, value, value, 255], i * 4);
      } else if (channels === 2) {
        out.set([source[base]!, source[base]!, source[base]!, source[base + 1]!], i * 4);
      } else if (channels === 3) {
        out.set([source[base]!, source[base + 1]!, source[base + 2]!, 255], i * 4);
      } else {
        out.set(source.subarray(base, base + 4), i * 4);
      }
    }
  }

  return { width: image.width, height: image.height, data: out };
}

export function encodePng(raster: Raster): Uint8Array {
  return encode({
    width: raster.width,
    height: raster.height,
    data: raster.data instanceof Uint8Array ? raster.data : new Uint8Array(raster.data),
    channels: 4,
  });
}
