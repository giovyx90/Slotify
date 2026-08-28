// SPDX-License-Identifier: GPL-3.0-or-later

/** `0xE8A9` -> `"U+E8A9"` — the notation codepoints travel in outside source code. */
export function formatCodepoint(codepoint: number): string {
  return "U+" + codepoint.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Accepts `"U+E8A9"`, `"0xE8A9"`, a bare hex/decimal string, or a number.
 * Throws on anything that is not a valid Unicode scalar value.
 */
export function parseCodepoint(value: string | number): number {
  let codepoint: number;

  if (typeof value === "number") {
    codepoint = value;
  } else {
    const text = value.trim();
    if (/^U\+[0-9a-fA-F]+$/.test(text)) codepoint = parseInt(text.slice(2), 16);
    else if (/^0x[0-9a-fA-F]+$/.test(text)) codepoint = parseInt(text, 16);
    else if (/^[0-9]+$/.test(text)) codepoint = parseInt(text, 10);
    else throw new Error(`Not a codepoint: ${JSON.stringify(value)}`);
  }

  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0x10ffff) {
    throw new Error(`Codepoint out of range: ${codepoint}`);
  }

  return codepoint;
}

/**
 * The code points of a string, in order.
 *
 * Everything in this engine iterates strings this way — never by UTF-16 index. The GUI
 * font uses astral-plane codepoints (broadcast, robbery) that occupy two UTF-16 units.
 */
export function codepointsOf(text: string): number[] {
  return Array.from(text, (char) => char.codePointAt(0)!);
}

export function stringOf(codepoint: number): string {
  return String.fromCodePoint(codepoint);
}
