// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * What the person using Slotify chose, as opposed to what the pack declares.
 *
 * One localStorage key, read once, written on every change, and forgotten in silence
 * where storage is not available — the shape `recentColours.ts` already uses.
 *
 * Deliberately not in the profile: a profile is committed next to the pack and describes
 * the pack. A theme and a language belong to the machine somebody is sitting at, and
 * would arrive as a surprise in everyone else's checkout.
 */

const KEY = "slotify.settings";

export type Theme = "system" | "light" | "dark";
export type Locale = "en" | "it";

export interface Settings {
  theme: Theme;
  locale: Locale;
  /** Which rail panels are open, by panel id. Absent means the panel's own default. */
  panels: Record<string, boolean>;
}

/** Italian if the machine is Italian, English otherwise. Nothing else is guessed. */
export function detectLocale(): Locale {
  const tag = typeof navigator === "undefined" ? "" : (navigator.language ?? "");
  return tag.toLowerCase().startsWith("it") ? "it" : "en";
}

function read(): Settings {
  const fallback: Settings = { theme: "system", locale: detectLocale(), panels: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: stored.theme === "light" || stored.theme === "dark" ? stored.theme : "system",
      locale: stored.locale === "it" || stored.locale === "en" ? stored.locale : fallback.locale,
      panels: typeof stored.panels === "object" && stored.panels !== null ? stored.panels : {},
    };
  } catch {
    return fallback;
  }
}

let current = $state<Settings>(read());

/** Read-only view. Reading a field in a component subscribes that component to it. */
export const settings = {
  get theme(): Theme {
    return current.theme;
  },
  get locale(): Locale {
    return current.locale;
  },
};

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // A session without storage simply forgets the choice when the window closes.
  }
}

export function setTheme(theme: Theme): void {
  current = { ...current, theme };
  applyTheme(theme);
  save();
}

export function setLocale(locale: Locale): void {
  current = { ...current, locale };
  applyLocale(locale);
  save();
}

/** A rail panel, open or shut. The fallback is that panel's own, never a global one. */
export function isPanelOpen(id: string, fallback: boolean): boolean {
  return current.panels[id] ?? fallback;
}

export function setPanelOpen(id: string, open: boolean): void {
  current = { ...current, panels: { ...current.panels, [id]: open } };
  save();
}

/**
 * Stamps the choice onto the document element, which is where the CSS reads it.
 * "system" removes the attribute rather than writing one, so the `prefers-color-scheme`
 * rule is what answers — a stamped value would freeze the theme at whatever the OS said
 * the first time.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

/** `index.html` ships `lang="en"`; the choice has to reach the attribute at runtime. */
export function applyLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

/** Called once at boot, before anything is drawn. */
export function applySettings(): void {
  applyTheme(current.theme);
  applyLocale(current.locale);
}
