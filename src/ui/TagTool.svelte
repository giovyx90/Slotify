<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { encodePng } from "../engine/png";
  import { renderTag, type TagStyle } from "../engine/tagGenerator";
  import { slugify } from "../engine/components";
  import type { BitmapFont } from "../engine/textFont";
  import type { FsBackend } from "../platform/fs";
  import { saveComponent } from "./model";

  let {
    font,
    backend,
    packRoot,
    onExit,
  }: {
    font: BitmapFont;
    backend: FsBackend;
    packRoot: string;
    onExit: () => void;
  } = $props();

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
    shadow: useShadow ? shadow : undefined,
    shadowOffset: [1, 1],
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

<div class="tagtool">
  <aside class="controls">
    <button onclick={onExit}>← viewer</button>
    <h2>Tag generator</h2>

    <label class="row">text <input bind:value={text} /></label>
    <div class="grid2">
      <label>scale <input type="number" min="1" max="8" bind:value={scale} /></label>
      <label>spacing <input type="number" min="-1" max="4" bind:value={letterSpacing} /></label>
    </div>

    <h3>Fill</h3>
    <div class="grid2">
      <label>top <input type="color" bind:value={fill} /></label>
      <label class="gap"><input type="checkbox" bind:checked={useGradient} /> gradient</label>
      {#if useGradient}
        <label>bottom <input type="color" bind:value={fillTo} /></label>
      {/if}
    </div>

    <h3>Effects</h3>
    <div class="grid2">
      <label class="gap"><input type="checkbox" bind:checked={useOutline} /> outline</label>
      {#if useOutline}<label><input type="color" bind:value={outline} /></label>{/if}
      <label class="gap"><input type="checkbox" bind:checked={useShadow} /> shadow</label>
      {#if useShadow}<label><input type="color" bind:value={shadow} /></label>{/if}
    </div>

    <h3>Background</h3>
    <label class="gap"><input type="checkbox" bind:checked={useBackground} /> plate</label>
    {#if useBackground}
      <div class="grid2">
        <label>fill <input type="color" bind:value={bgFill} /></label>
        <label>border <input type="color" bind:value={bgBorder} /></label>
        <label>padding <input type="number" min="0" max="8" bind:value={padding} /></label>
      </div>
    {/if}

    <h3>Output {#if tag}<span class="hint">{tag.width}×{tag.height}px</span>{/if}</h3>
    <div class="actions">
      <button onclick={download}>Download PNG</button>
      <button onclick={saveToLibrary}>Save to library (sprite)</button>
    </div>

    {#if statusLine}<p class="status">{statusLine}</p>{/if}
  </aside>

  <section class="stage">
    {#if tag}
      <canvas bind:this={canvas}></canvas>
    {:else}
      <p class="hint">Type something.</p>
    {/if}
  </section>
</div>

<style>
  .tagtool {
    display: grid;
    grid-template-columns: 300px 1fr;
    height: 100vh;
  }

  @media (max-width: 700px) {
    .tagtool { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  }

  .controls {
    overflow-y: auto;
    padding: 0.75rem;
    background: #1c1c21;
    border-right: 1px solid #2c2c33;
  }

  .stage {
    display: grid;
    place-items: center;
    overflow: auto;
    background: repeating-conic-gradient(#1b1b1f 0% 25%, #202026 0% 50%) 0 0 / 24px 24px;
  }
  canvas { image-rendering: pixelated; }

  h2 { font-size: 1rem; margin: 0.5rem 0; }
  h3 { font-size: 0.8rem; margin: 0.9rem 0 0.3rem; color: #b8b2a7; text-transform: uppercase; letter-spacing: 0.04em; }
  h3 .hint { text-transform: none; letter-spacing: 0; }
  .hint { color: #77726a; font-size: 0.8rem; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; align-items: center; }
  label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; }
  label.row { margin: 0.3rem 0; }
  label.gap { min-height: 30px; }
  input {
    background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 4px;
    padding: 0.3rem 0.4rem; width: 100%; min-width: 0; font: inherit;
  }
  input[type="checkbox"] { width: auto; }
  input[type="color"] { padding: 0.1rem; height: 30px; }

  button {
    background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 6px;
    padding: 0.45rem 0.6rem; font: inherit; cursor: pointer; min-height: 34px;
  }
  .actions { display: grid; gap: 0.3rem; }
  .status { font-size: 0.78rem; color: #9ad17e; }
</style>
