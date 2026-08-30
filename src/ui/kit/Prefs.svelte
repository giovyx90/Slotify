<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { t } from "../../i18n/i18n.svelte";
  import { settings, setLocale, setTheme, type Locale, type Theme } from "../settings.svelte";

  /**
   * The two choices that belong to the person and not to the pack.
   *
   * It sits in all three top bars because there is no shared shell yet, and a preference
   * you can only reach from one screen is a preference nobody finds.
   *
   * The language labels are the language's own name in that language — a person looking
   * for Italian is looking for "IT", not for whatever the current language calls Italy.
   */
  const THEMES: { id: Theme; label: string; title: string }[] = $derived([
    { id: "system", label: t("chrome.theme.system"), title: t("chrome.theme.systemTitle") },
    { id: "light", label: t("chrome.theme.light"), title: t("chrome.theme.lightTitle") },
    { id: "dark", label: t("chrome.theme.dark"), title: t("chrome.theme.darkTitle") },
  ]);
  const LOCALES: { id: Locale; label: string }[] = [
    { id: "it", label: "IT" },
    { id: "en", label: "EN" },
  ];
</script>

<div class="seg prefs" role="group" aria-label={t("chrome.language")}>
  {#each LOCALES as choice}
    <button
      class:active={settings.locale === choice.id}
      aria-pressed={settings.locale === choice.id}
      onclick={() => setLocale(choice.id)}
    >{choice.label}</button>
  {/each}
</div>

<div class="seg prefs" role="group" aria-label={t("chrome.theme")}>
  {#each THEMES as choice}
    <button
      class:active={settings.theme === choice.id}
      title={choice.title}
      aria-pressed={settings.theme === choice.id}
      onclick={() => setTheme(choice.id)}
    >{choice.label}</button>
  {/each}
</div>

<style>
  .prefs {
    flex: none;
  }
  .prefs > button {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.25rem 0.5rem;
  }
</style>
