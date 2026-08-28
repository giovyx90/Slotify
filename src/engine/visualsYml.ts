// SPDX-License-Identifier: GPL-3.0-or-later
import { formatCodepoint } from "./unicode";

/**
 * The two shapes a screen's runtime configuration takes on NEXT, emitted as paste-ready
 * snippets. Codepoints travel as `"U+E8C4"` strings — never as raw characters — exactly
 * like `hospital-visuals.yml` and friends.
 */

export interface ScreenConfig {
  key: string;
  codepoint: number;
  titleShift: number;
  fallbackTitle: string;
}

/** The `hospital-visuals.yml` shape: `gui.<key>.{glyph, title-shift, fallback-title}`. */
export function visualsYmlBlock(screens: readonly ScreenConfig[]): string {
  const lines = ["gui:"];
  for (const screen of screens) {
    lines.push(`  ${screen.key}:`);
    lines.push(`    glyph: "${formatCodepoint(screen.codepoint)}"`);
    lines.push(`    title-shift: ${screen.titleShift}`);
    lines.push(`    fallback-title: "${screen.fallbackTitle.replace(/"/g, '\\"')}"`);
  }
  return lines.join("\n") + "\n";
}

/** The NextCore `config.yml` shape: `<prefix>.<screen>-title-shift`, no glyph. */
export function configYmlBlock(prefix: string, screens: readonly ScreenConfig[]): string {
  const lines: string[] = [];
  for (const screen of screens) {
    lines.push(`${prefix}.${screen.key}-title-shift: ${screen.titleShift}`);
  }
  return lines.join("\n") + "\n";
}
