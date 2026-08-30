<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { t } from "../i18n/i18n.svelte";
  import Prefs from "./kit/Prefs.svelte";
  import { encodePng } from "../engine/png";
  import { renderTag, type TagStyle } from "../engine/tagGenerator";
  import { slugify } from "../engine/components";
  import { SHADOW_OFFSETS, type BitmapFont, type ShadowDir } from "../engine/textFont";
  import type { FsBackend } from "../platform/fs";
  import { saveComponent } from "./model";

  let {
    fonts,
    backend,
    packRoot,
    onExit,
  }: {
    fonts: { minecraft?: BitmapFont; mono5?: BitmapFont };
    backend: FsBackend;
    packRoot: string;
    onExit: () => void;
  } = $props();

  // The 5×5 mono is the tag face by default; the pack's Minecraft font is the option.
  let fontChoice: "mono5" | "minecraft" = $state("mono5");
  const font = $derived(
    (fontChoice === "minecraft" ? fonts.minecraft : fonts.mono5) ?? fonts.mono5 ?? fonts.minecraft!,
  );
  let shadowDir: ShadowDir = $state("below-right");

  let text = $state("NEXT");
  let scale = $state(1);
  let fill = $state("#FFC65C");
  let useGradient = $state(true);
  let fillTo = $state("#F0A831");
  let useOutline = $state(true);
  let outline = $state("#1F160C");
  let useShadow = $state(false);
  let shadow = $state("#101010");
  let useBackground = $state(false);
  let bgFill = $state("#3B2A1A");
  let bgBorder = $state("#1F160C");
  let padding = $state(2);
  let letterSpacing = $state(0);
  let statusLine = $state("");

  let canvas: HTMLCanvasElement | undefined = $state();
  const PREVIEW_ZOOM = 6;

  const style = $derived<TagStyle>({
    scale,
    fill,
    fillTo: useGradient ? fillTo : undefined,
    outline: useOutline ? outline : undefined,
    shadow: useShadow && shadowDir !== "none" ? shadow : undefined,
    shadowOffset: shadowDir !== "none" ? SHADOW_OFFSETS[shadowDir] : [1, 1],
    letterSpacing,
    background: useBackground ? { fill: bgFill, border: bgBorder, paddingX: padding, paddingY: padding } : undefined,
  });

  const tag = $derived(text ? renderTag(font, text, style) : null);

  $effect(() => {
    if (!canvas || !tag) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = tag.width;
    offscreen.height = tag.height;
    offscreen.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(tag.data), tag.width, tag.height), 0, 0,
    );
    canvas.width = tag.width * PREVIEW_ZOOM;
    canvas.height = tag.height * PREVIEW_ZOOM;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  });

  function download(): void {
    if (!tag) return;
    const blob = new Blob([encodePng(tag) as BlobPart], { type: "image/png" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${slugify(text)}.png`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    statusLine = "PNG downloaded";
  }

  async function saveToLibrary(): Promise<void> {
    if (!tag) return;
    const id = `tag-${slugify(text)}`;
    await saveComponent(
      backend,
      packRoot,
      { version: 1, id, name: `tag: ${text}`, kind: "sprite", w: tag.width, h: tag.height },
      encodePng(tag),
    );
    statusLine = `saved to the library as "${id}" — place it from the editor`;
  }
</script>

<div class="app">
  <header class="topbar">
    <button class="btn ghost" onclick={onExit}>← {t("chrome.viewer")}</button>

    <div class="ident">
      <span class="label-mono">{t("tag.title")}</span>
      <h2>{text || "untitled"}</h2>
    </div>

    <div class="spacer"></div>

    <Prefs />

    {#if tag}
      <span class="chip">{tag.width}×{tag.height} px</span>
    {/if}
    <button class="btn" onclick={saveToLibrary}>{t("btn.saveToLibrary")}</button>
    <button class="btn primary" onclick={download}>{t("btn.downloadPng")}</button>
  </header>

  <div class="workspace two">
    <aside class="pane left">
      <section class="card">
        <div class="card-head"><span class="label-mono">{t("panel.text")}</span></div>
        <label class="field"><span>{t("field.words")}</span><input bind:value={text} /></label>
        <div class="grid2 top">
          <label class="field"><span>{t("kv.font")}</span>
            <select bind:value={fontChoice}>
              <option value="mono5">{t("option.mono5")}</option>
              {#if fonts.minecraft}<option value="minecraft">{t("option.minecraft")}</option>{/if}
            </select>
          </label>
          <label class="field"><span>{t("field.scale")}</span><input type="number" min="1" max="8" bind:value={scale} /></label>
          <label class="field"><span>{t("field.spacing")}</span><input type="number" min="-1" max="4" bind:value={letterSpacing} /></label>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><span class="label-mono">{t("panel.fill")}</span></div>
        <div class="grid2">
          <label class="field"><span>{t("field.top")}</span><input type="color" bind:value={fill} /></label>
          {#if useGradient}
            <label class="field"><span>{t("field.bottom")}</span><input type="color" bind:value={fillTo} /></label>
          {/if}
        </div>
        <label class="check"><input type="checkbox" bind:checked={useGradient} /> {t("check.verticalGradient")}</label>
      </section>

      <section class="card">
        <div class="card-head"><span class="label-mono">{t("panel.effects")}</span></div>
        <label class="check"><input type="checkbox" bind:checked={useOutline} /> {t("check.outline")}</label>
        {#if useOutline}
          <label class="field"><span>{t("field.outlineColour")}</span><input type="color" bind:value={outline} /></label>
        {/if}
        <label class="check"><input type="checkbox" bind:checked={useShadow} /> {t("check.shadow")}</label>
        {#if useShadow}
          <div class="grid2">
            <label class="field"><span>{t("field.colour")}</span><input type="color" bind:value={shadow} /></label>
            <label class="field"><span>{t("field.direction")}</span>
              <select bind:value={shadowDir}>
                {#each Object.keys(SHADOW_OFFSETS) as dir}<option value={dir}>{dir}</option>{/each}
              </select>
            </label>
          </div>
        {/if}
      </section>

      <section class="card">
        <div class="card-head"><span class="label-mono">{t("panel.plate")}</span></div>
        <label class="check"><input type="checkbox" bind:checked={useBackground} /> {t("check.backgroundPlate")}</label>
        {#if useBackground}
          <div class="grid2 top">
            <label class="field"><span>{t("field.fill")}</span><input type="color" bind:value={bgFill} /></label>
            <label class="field"><span>{t("field.border")}</span><input type="color" bind:value={bgBorder} /></label>
            <label class="field"><span>{t("field.padding")}</span><input type="number" min="0" max="8" bind:value={padding} /></label>
          </div>
        {/if}
      </section>

      {#if statusLine}
        <p class="status">{statusLine}</p>
      {/if}
    </aside>

    <section class="stage">
      {#if tag}
        <canvas bind:this={canvas}></canvas>
      {:else}
        <div class="empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M4 7V5h16v2M9 19h6M12 5v14" />
          </svg>
          <p>{t("hint.tagEmpty")}</p>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .ident {
    display: grid;
    gap: 0.05rem;
    min-width: 0;
  }

  .ident h2 {
    font-size: 0.9rem;
    font-weight: 800;
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One rail of controls, one stage: no inspector to put on the right. */
  .workspace.two {
    grid-template-columns: 320px minmax(0, 1fr);
  }

  .top {
    margin-top: 0.45rem;
  }

  .status {
    margin: 0;
    padding: 0.45rem 0.6rem;
    border: 1px solid color-mix(in srgb, var(--success) 30%, var(--line));
    border-radius: var(--radius);
    background: var(--success-soft);
    color: color-mix(in srgb, var(--success) 80%, var(--ink));
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    overflow-wrap: anywhere;
  }

  @media (max-width: 980px) {
    .workspace.two {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(40vh, 1fr) auto;
    }

    .workspace.two .pane {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>
