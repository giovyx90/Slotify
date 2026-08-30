<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { t } from "../i18n/i18n.svelte";
  import { findSwatch, isNamed, resolveColour, type Swatch } from "../engine/palette";
  import { recentColours, rememberColour } from "./recentColours";

  /**
   * One colour, chosen four ways: a swatch from the palette (which stores the name, not
   * the value), a colour mixed by hand, one used recently, or one lifted off the canvas.
   *
   * A field showing a swatch says so — the little chip carries the swatch's name — because
   * the difference between `@brand.red` and the same red typed in matters later, when the
   * brand red moves and only one of the two follows.
   */

  let {
    label,
    value,
    fallback,
    palette,
    onchange,
    oneyedrop,
  }: {
    label: string;
    value: string | undefined;
    fallback: string;
    palette: Swatch[];
    onchange: (next: string) => void;
    oneyedrop?: () => void;
  } = $props();

  let recents = $state(recentColours());
  const swatch = $derived(findSwatch(value, palette));
  const resolved = $derived(resolveColour(value, palette, fallback) ?? fallback);
  const dangling = $derived(isNamed(value) && swatch == null);

  function pickLiteral(hex: string): void {
    const upper = hex.toUpperCase();
    recents = rememberColour(upper);
    onchange(upper);
  }
</script>

<div class="colour">
  <div class="head">
    <span class="name">{label}</span>
    {#if swatch}
      <button
        class="tag"
        title={t("tip.detach")}
        onclick={() => pickLiteral(swatch.hex)}
      >@{swatch.id}</button>
    {:else if dangling}
      <span class="tag bad" title={t("tip.danglingName")}>{value}</span>
    {/if}
  </div>

  <div class="row">
    <input
      type="color"
      value={resolved}
      oninput={(event) => pickLiteral((event.target as HTMLInputElement).value)}
    />
    <code>{swatch ? swatch.hex : resolved}</code>
    {#if oneyedrop}
      <button class="mini" title={t("tip.eyedropper")} onclick={oneyedrop} aria-label={t("aria.eyedropper")}
        >&#x25C9;</button
      >
    {/if}
  </div>

  {#if palette.length > 0}
    <div class="swatches">
      {#each palette as entry}
        <button
          class="chipswatch"
          class:on={swatch?.id === entry.id}
          style:background={entry.hex}
          title={`${entry.name} (@${entry.id})`}
          aria-label={entry.name}
          onclick={() => onchange(`@${entry.id}`)}
        ></button>
      {/each}
    </div>
  {/if}

  {#if recents.length > 0}
    <div class="swatches recents">
      {#each recents as hex}
        <button
          class="chipswatch small"
          style:background={hex}
          title={hex}
          aria-label={hex}
          onclick={() => pickLiteral(hex)}
        ></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .colour {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .name {
    color: var(--ink-soft);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: lowercase;
  }

  .tag {
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--canvas);
    color: var(--ink-soft);
    padding: 0 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag.bad {
    border-color: color-mix(in srgb, var(--primary) 45%, var(--line));
    color: var(--primary);
    cursor: default;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .row input[type="color"] {
    flex: 0 0 34px;
  }

  .row code {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--ink-soft);
  }

  .mini {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-soft);
    padding: 0.1rem 0.3rem;
    font: inherit;
    font-size: 0.7rem;
    line-height: 1;
    cursor: pointer;
  }

  .mini:hover {
    border-color: var(--line-strong);
    color: var(--ink);
  }

  /* The palette itself: small squares, because a colour is recognised, not read. */
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
  }

  .chipswatch {
    width: 16px;
    height: 16px;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
  }

  .chipswatch.small {
    width: 12px;
    height: 12px;
  }

  .chipswatch.on {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }

  .recents {
    opacity: 0.8;
  }
</style>
