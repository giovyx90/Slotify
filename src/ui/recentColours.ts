// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The last colours mixed by hand, shared by every colour field and remembered between
 * sessions. Per-viewer convenience only: losing it costs nothing, so every access is
 * wrapped rather than guarded.
 */

const KEY = "slotify.recentColours";
const LIMIT = 8;

let recents: string[] = load();

function load(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function recentColours(): string[] {
  return recents;
}

export function rememberColour(hex: string): string[] {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return recents;
  const upper = hex.toUpperCase();
  recents = [upper, ...recents.filter((entry) => entry !== upper)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(recents));
  } catch {
    // a session without storage simply forgets
  }
  return recents;
}
