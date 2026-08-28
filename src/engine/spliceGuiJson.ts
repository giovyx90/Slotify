// SPDX-License-Identifier: GPL-3.0-or-later
import { parseFont } from "./fontJson";
import { formatCodepoint, stringOf } from "./unicode";

/**
 * Mutates a `gui.json` the only way it is ever mutated on NEXT: a textual splice,
 * ported from `tools/locker-pack/write_font.py`.
 *
 * Two things about how this writes, both deliberate and both inherited:
 *
 * - **It appends text rather than re-serialising.** The real file is 109 KB of
 *   single-line JSON holding raw astral-plane characters for every drawn screen on the
 *   server. Re-serialising would rewrite the escaping of ~860 providers — a diff nobody
 *   can read, over a file where one wrong codepoint is an invisible box in somebody's
 *   GUI. New entries are spliced in before the closing `]}` and nothing else is touched.
 *
 * - **It is idempotent.** A provider whose codepoint is already claimed is skipped; an
 *   ascent that changed is corrected in place by a surgical substitution on that one
 *   provider's own text.
 */

export interface ProviderEntry {
  codepoint: number;
  /** Path under `textures/`, e.g. `custom_ui/locker/manage.png`. */
  file: string;
  ascent: number;
  height?: number;
}

/**
 * One provider, formatted exactly as Python's `json.dumps(..., ensure_ascii=False)`
 * writes it — byte-identical to every entry already in the file, so a splice reads as
 * one more of the same in the diff.
 */
export function formatProvider(entry: ProviderEntry): string {
  return (
    `{"type": "bitmap", "file": ${JSON.stringify(entry.file)}, ` +
    `"ascent": ${entry.ascent}, "height": ${entry.height ?? 256}, ` +
    `"chars": ["${rawJsonChar(entry.codepoint)}"]}`
  );
}

/**
 * The character as it goes inside a JSON string with non-ASCII kept raw: PUA and astral
 * codepoints as themselves, only JSON's mandatory escapes applied.
 */
function rawJsonChar(codepoint: number): string {
  if (codepoint === 0x22) return '\\"';
  if (codepoint === 0x5c) return "\\\\";
  if (codepoint < 0x20) return "\\u" + codepoint.toString(16).padStart(4, "0");
  return stringOf(codepoint);
}

export interface SpliceResult {
  text: string;
  /** Codepoints actually appended this run. */
  added: number[];
  /** Codepoints whose existing provider had its ascent corrected in place. */
  corrected: number[];
  /** Codepoints skipped because they are already claimed (and already correct). */
  skipped: number[];
}

export function spliceProviders(raw: string, entries: readonly ProviderEntry[]): SpliceResult {
  const taken = new Set<number>();
  for (const provider of parseFont("gui.json", raw).providers) {
    if (provider.kind === "bitmap") {
      for (const row of provider.grid) for (const codepoint of row) if (codepoint) taken.add(codepoint);
    } else if (provider.kind === "space") {
      for (const codepoint of provider.advances.keys()) taken.add(codepoint);
    }
  }

  let text = raw;
  const corrected: number[] = [];

  // An ascent already in the file is corrected in place, on that provider's own text.
  for (const entry of entries) {
    const pattern = new RegExp(`("file": "${escapeRegExp(entry.file)}", "ascent": )(\\d+)`);
    const match = pattern.exec(text);

    if (match && Number(match[2]) !== entry.ascent) {
      text = text.replace(pattern, `$1${entry.ascent}`);
      corrected.push(entry.codepoint);
    }
  }

  const additions: string[] = [];
  const added: number[] = [];
  const skipped: number[] = [];

  for (const entry of entries) {
    if (taken.has(entry.codepoint)) {
      if (!corrected.includes(entry.codepoint)) skipped.push(entry.codepoint);
      continue;
    }
    additions.push(formatProvider(entry));
    added.push(entry.codepoint);
  }

  if (additions.length === 0) {
    return { text, added, corrected, skipped };
  }

  const closing = text.trimEnd();
  if (!closing.endsWith("]}")) {
    throw new Error(
      "gui.json does not end in the expected `]}` — refusing to splice " +
        `(entries: ${entries.map((entry) => formatCodepoint(entry.codepoint)).join(", ")})`,
    );
  }

  return {
    text: closing.slice(0, -2) + ", " + additions.join(", ") + "]}\n",
    added,
    corrected,
    skipped,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
