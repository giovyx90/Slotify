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
export function decodePng(bytes: Uint8Array): Raster {
  const image = decode(bytes);
  const pixels = image.width * image.height;
  const out = new Uint8Array(pixels * 4);

  const source =
    image.depth === 16
      ? (() => {
          const wide = image.data as Uint16Array;
          const narrow = new Uint8Array(wide.length);
          for (let i = 0; i < wide.length; i++) narrow[i] = wide[i]! >> 8;
          return narrow;
        })()
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
        out.set([source[base]!, source[base]!, source[base]!, 255], i * 4);
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
