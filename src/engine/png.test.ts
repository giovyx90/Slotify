// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { unpackBits } from "./png";

/**
 * Sub-byte bit depths, which every vanilla Minecraft GUI texture uses.
 *
 * `anvil.png` in the client jar is a 16-colour palette at depth 4 — two pixels to the
 * byte. A decoder that assumes one byte per sample reads the left half of the image as
 * the whole of it and reports a 176-wide window as 256 wide, without an error anywhere.
 * That is exactly how a measurement can be wrong and believed.
 */
describe("unpackBits", () => {
  it("splits a 4-bit row into two samples per byte, high nibble first", () => {
    expect([...unpackBits(new Uint8Array([0x1f, 0xa0]), 4, 1, 4)]).toEqual([1, 15, 10, 0]);
  });

  it("splits 2-bit and 1-bit samples the same way", () => {
    expect([...unpackBits(new Uint8Array([0b11_01_00_10]), 4, 1, 2)]).toEqual([3, 1, 0, 2]);
    expect([...unpackBits(new Uint8Array([0b1011_0001]), 8, 1, 1)]).toEqual([1, 0, 1, 1, 0, 0, 0, 1]);
  });

  it("starts every row on a byte boundary, padding bits and all", () => {
    // Three 4-bit pixels a row: two bytes each, the last nibble of each row unused.
    const packed = new Uint8Array([0x12, 0x30, 0x45, 0x60]);
    expect([...unpackBits(packed, 3, 2, 4)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
