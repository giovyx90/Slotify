// SPDX-License-Identifier: GPL-3.0-or-later
import { settings } from "../ui/settings.svelte";
import { en } from "./messages.en";
import { it } from "./messages.it";

/**
 * Two languages, no dependency.
 *
 * `svelte-i18n` and its relatives are a sensible answer for an app with eight locales, a
 * translation service and a build step that extracts keys. This one has two locales, one
 * author, and an engine whose tests run in a bare node environment that must stay clean —
 * so the whole mechanism is a lookup, a `{placeholder}` substitution and a plural suffix.
 *
 * The English table is the source of truth for the key set: `MessageKey` is derived from
 * it, so a key added to Italian and not to English will not compile, and a key missing
 * from Italian is caught by `i18n.test.ts` rather than shipping as a blank label.
 */

export type MessageKey = keyof typeof en;

const TABLES: Record<string, Partial<Record<MessageKey, string>>> = { en, it };

/** Named parameters only. Positional ones read fine in English and badly in Italian. */
export type Params = Record<string, string | number>;

function fill(raw: string, params: Params): string {
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function t(key: MessageKey, params?: Params): string {
  const table = TABLES[settings.locale] ?? en;
  const raw = table[key] ?? en[key] ?? key;
  return params ? fill(raw, params) : raw;
}

/**
 * The count decides the key: `layers.duplicated.one` or `layers.duplicated.other`, with
 * `{n}` already bound. English faked this with "(s)" in eight status lines, which Italian
 * cannot copy — "1 livello(i)" is not a thing anyone writes.
 *
 * One and other is the whole rule, because it is the whole rule in both languages here.
 */
export function tn(stem: string, n: number, params?: Params): string {
  const key = `${stem}.${n === 1 ? "one" : "other"}` as MessageKey;
  return t(key, { n, ...params });
}
