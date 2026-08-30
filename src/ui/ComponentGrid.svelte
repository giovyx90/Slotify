<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import type { LibraryComponent } from "../engine/components";
  import { newProject } from "../engine/project";
  import { makeRaster, type Raster } from "../engine/raster";
  import { renderSheet, type RenderContext } from "../engine/renderProject";
  import { t } from "../i18n/i18n.svelte";
  import Icon from "./kit/Icon.svelte";

  /**
   * The component library, as a wall of what the pieces look like.
   *
   * It was a list of names, which is the one thing a library of *drawings* must not be:
   * `aboveslots` and `belowslots` are two rows of pixels four high and a name tells you
   * nothing about either. A sprite shows its own PNG; a composite is drawn by the real
   * renderer, so what you pick is what lands.
   */
  const {
    library,
    sprites,
    context,
    pendingId,
    onpick,
    onremove,
  }: {
    library: LibraryComponent[];
    sprites: Map<string, Raster>;
    context: RenderContext;
    pendingId?: string;
    onpick: (component: LibraryComponent) => void;
    onremove: (component: LibraryComponent) => void;
  } = $props();

  let query = $state("");
  const shown = $derived(
    query.trim()
      ? library.filter((component) => component.name.toLowerCase().includes(query.trim().toLowerCase()))
      : library,
  );

  /**
   * A composite goes through the real sheet renderer and is cropped back out of it: its
   * elements are already anchored to its own top-left, and an ascent of 13 puts window
   * coordinates on sheet coordinates, so the crop is just the component's own box.
   */
  function raster(component: LibraryComponent): Raster | null {
    if (component.kind === "sprite") return sprites.get(component.id) ?? null;
    if (!component.elements || component.elements.length === 0) return null;

    const scratch = newProject("preview", component.id, "U+E000");
    scratch.bakeWindow = false;
    scratch.rows = 6;
    scratch.elements = component.elements.map((element) => ({ ...element }));
    const sheet = renderSheet(scratch, undefined, context);

    const out = makeRaster(component.w, component.h);
    for (let y = 0; y < component.h; y++) {
      const from = (y * sheet.width) * 4;
      out.data.set(sheet.data.subarray(from, from + component.w * 4), y * component.w * 4);
    }
    return out;
  }

  /** Fits the drawing in the card without ever blurring it: whole-number scaling only. */
  function paint(canvas: HTMLCanvasElement, component: LibraryComponent): void {
    const art = raster(component);
    const box = 92;
    if (!art || art.width === 0 || art.height === 0) {
      canvas.width = box;
      canvas.height = 40;
      return;
    }
    const scale = Math.max(1, Math.min(4, Math.floor(box / art.width), Math.floor(48 / art.height)));
    canvas.width = art.width * scale;
    canvas.height = art.height * scale;

    const offscreen = document.createElement("canvas");
    offscreen.width = art.width;
    offscreen.height = art.height;
    offscreen
      .getContext("2d")!
      .putImageData(new ImageData(new Uint8ClampedArray(art.data), art.width, art.height), 0, 0);

    const target = canvas.getContext("2d")!;
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, canvas.width, canvas.height);
    target.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  }

  function thumb(node: HTMLCanvasElement, component: LibraryComponent) {
    paint(node, component);
    return { update: (next: LibraryComponent) => paint(node, next) };
  }
</script>

{#if library.length > 6}
  <label class="search">
    <Icon name="search" size={13} />
    <input bind:value={query} placeholder={t("field.search")} />
  </label>
{/if}

<div class="wall">
  {#each shown as component (component.id)}
    <div class="cell" class:on={pendingId === component.id}>
      <button class="art" title={component.name} onclick={() => onpick(component)}>
        <canvas use:thumb={component}></canvas>
      </button>
      <span class="name truncate" title={component.name}>{component.name}</span>
      <span class="size">{component.w}×{component.h}</span>
      <button
        class="kill"
        aria-label={t("aria.delete", { name: component.name })}
        title={t("tip.deleteFromLibrary")}
        onclick={() => onremove(component)}
      ><Icon name="close" size={11} /></button>
    </div>
  {/each}
  {#if shown.length === 0}
    <p class="hint">{library.length === 0 ? t("hint.libraryEmpty") : t("hint.noMatch")}</p>
  {/if}
</div>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--s2);
    margin-bottom: var(--s3);
    padding: 0 var(--s2);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink-faint);
  }
  .search input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0;
  }
  .search input:focus {
    outline: none;
  }

  .wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: var(--s2);
  }
  .cell {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: var(--s2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--canvas);
  }
  .cell.on {
    border-color: var(--primary);
    box-shadow: inset 0 0 0 1px var(--primary);
  }
  .art {
    display: grid;
    place-items: center;
    width: 100%;
    min-height: 52px;
    border: 0;
    padding: 2px;
    border-radius: var(--radius-sm);
    /* Half this library is transparent overlays; on a plain card they are invisible. */
    background-color: var(--surface);
    background-image:
      linear-gradient(45deg, var(--check) 25%, transparent 25% 75%, var(--check) 75%),
      linear-gradient(45deg, var(--check) 25%, transparent 25% 75%, var(--check) 75%);
    background-size: 8px 8px;
    background-position:
      0 0,
      4px 4px;
    cursor: pointer;
  }
  .art canvas {
    display: block;
    max-width: 100%;
    height: auto;
    image-rendering: pixelated;
  }
  .name {
    max-width: 100%;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--ink);
  }
  .size {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--ink-faint);
  }
  .kill {
    position: absolute;
    top: 2px;
    right: 2px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-faint);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
  }
  .cell:hover .kill,
  .kill:focus-visible {
    opacity: 1;
  }
  .kill:hover {
    background: var(--danger-soft);
    color: var(--danger);
  }
</style>
