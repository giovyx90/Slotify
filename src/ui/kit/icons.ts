// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The icon set, hand-drawn on a 16×16 grid.
 *
 * No icon package: this tool ships two fonts already and a third-party set would arrive
 * with a thousand glyphs to get the thirty used here. Every path is stroked in
 * `currentColor` at 1.5, so an icon inherits whatever colour the button it sits in has,
 * in either theme, with no per-icon fill to keep in sync.
 *
 * Shapes are geometric on purpose. The artwork on the canvas is pixel art at 1:1 and the
 * chrome must not compete with it: an illustrated icon beside a 16px slot reads as more
 * artwork.
 */

export interface IconSpec {
  /** Stroked at 1.5. */
  d: string;
  /** Filled, drawn after the stroke — for arrowheads and solid dots. */
  fill?: string;
}

export const ICONS = {
  // ── Tools ──────────────────────────────────────────────────────────────────────
  select: { d: "", fill: "M3.5 2.2 12.6 7.6l-3.9 1-2 3.9z" },
  button: { d: "M2.5 5.5h11v5h-11z M2.5 5.5h11 M2.5 5.5v5" },
  plate: { d: "M2.5 4.5h11v7h-11z M4.5 6.5h7" },
  infobox: { d: "M2.5 3.5h11v9h-11z M4.5 6.5h7 M4.5 9.5h4" },
  slot: { d: "M3.5 3.5h9v9h-9z M5.5 5.5h5v5h-5z" },
  erase: { d: "M2.5 12.5h5 M9.5 2.5 13.5 6.5 6.5 13.5 2.5 9.5z M6 6l4 4" },
  cover: { d: "M3.5 3.5h9v9h-9z M3.5 3.5 12.5 12.5" },
  text: { d: "M3.5 3.5h9 M8 3.5v9 M6 12.5h4" },
  panel: { d: "M2.5 3.5h11v9h-11z" },
  well: { d: "M2.5 3.5h11v9h-11z M4.5 5.5h7v5h-7z M4.5 10.5h7" },
  paint: { d: "M11.5 2.5 13.5 4.5 6.5 11.5 4.5 9.5z M4.5 9.5 3 13l3.5-1.5" },
  hotspot: { d: "M8 2.5v3 M8 10.5v3 M2.5 8h3 M10.5 8h3 M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" },

  // ── Paint tools ────────────────────────────────────────────────────────────────
  brush: { d: "M11.5 2.5 13.5 4.5 6.5 11.5 4.5 9.5z M4.5 9.5 3 13l3.5-1.5" },
  rubber: { d: "M2.5 12.5h5 M9.5 2.5 13.5 6.5 6.5 13.5 2.5 9.5z" },
  fill: { d: "M7 2.5 12.5 8 7.5 13 2.5 8z M12.5 10.5c1 1.4 1 2.5 0 2.5s-1-1.1 0-2.5z" },
  line: { d: "M3 13 13 3" },
  rect: { d: "M2.5 4.5h11v7h-11z" },
  ellipse: { d: "M8 4c3 0 5.5 1.8 5.5 4S11 12 8 12 2.5 10.2 2.5 8 5 4 8 4z" },

  // ── Layers and rows ────────────────────────────────────────────────────────────
  eye: { d: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z" },
  eyeOff: { d: "M2.5 2.5 13.5 13.5 M6.2 6.3A1.8 1.8 0 0 0 8 9.8c.5 0 .9-.2 1.3-.5 M3.3 5.4C2.2 6.5 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7 M6.4 3.8A6.7 6.7 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5s-.6 1.2-1.7 2.3" },
  lock: { d: "M4.5 7.5h7v6h-7z M6 7.5V5.5a2 2 0 0 1 4 0v2" },
  unlock: { d: "M4.5 7.5h7v6h-7z M6 7.5V5.5a2 2 0 0 1 3.8-.9" },
  up: { d: "M8 12.5v-9 M4.5 7 8 3.5 11.5 7" },
  down: { d: "M8 3.5v9 M4.5 9 8 12.5 11.5 9" },
  front: { d: "M2.5 5.5h8v8h-8z M5.5 5.5v-3h8v8h-3" },
  back: { d: "M5.5 2.5h8v8h-8z M10.5 10.5v3h-8v-8h3" },
  trash: { d: "M2.5 4.5h11 M5.5 4.5V2.8h5v1.7 M4 4.5l.7 9h6.6l.7-9 M6.6 7v4 M9.4 7v4" },
  copy: { d: "M5.5 5.5h8v8h-8z M2.5 10.5v-8h8v3" },

  // ── Chrome ─────────────────────────────────────────────────────────────────────
  undo: { d: "M3 7.5h6.5a3.5 3.5 0 0 1 0 7H6 M3 7.5 6 4.5 M3 7.5 6 10.5" },
  redo: { d: "M13 7.5H6.5a3.5 3.5 0 0 0 0 7H10 M13 7.5 10 4.5 M13 7.5 10 10.5" },
  plus: { d: "M8 3v10 M3 8h10" },
  close: { d: "M4 4l8 8 M12 4l-8 8" },
  search: { d: "M7.2 2.5a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4z M10.7 10.7 13.5 13.5" },
  chevronDown: { d: "M4 6.5 8 10.5 12 6.5" },
  chevronRight: { d: "M6.5 4 10.5 8 6.5 12" },
  pipette: { d: "M13.4 2.6a1.8 1.8 0 0 0-2.6 0L9.3 4.1 8.3 3.1 7 4.4l4.6 4.6 1.3-1.3-1-1 1.5-1.5a1.8 1.8 0 0 0 0-2.6z M7.6 5.8 2.9 10.5v2.6h2.6l4.7-4.7" },
  image: { d: "M2.5 3.5h11v9h-11z M2.5 10 6 6.5 9 9.5l2-2 2.5 2.5" },
  puzzle: { d: "M6.5 2.5h3v2a1.5 1.5 0 1 1 0 3v2h-3v-2a1.5 1.5 0 1 0 0-3z M9.5 4.5h4v9h-9v-4" },
  save: { d: "M2.5 2.5h9l2 2v9h-11z M5 2.5v4h5v-4 M5 13.5v-4h6v4" },
  export: { d: "M8 10.5v-8 M5 5.5 8 2.5l3 3 M2.5 10v3.5h11V10" },
} as const satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;
