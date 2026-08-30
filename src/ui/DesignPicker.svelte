<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { allDesigns, cornerRadius, type Design } from "../engine/designs";
  import { drawNinepatch } from "../engine/ninepatch";
  import { drawPlate, hueShiftedBevels, PANEL, VANILLA_BEVELS, type RGBA } from "../engine/paint";
  import { makeRaster, type Raster } from "../engine/raster";
  import { t } from "../i18n/i18n.svelte";
  import Modal from "./kit/Modal.svelte";

  /**
   * Pick a look for a button.
   *
   * Every thumbnail is drawn by the same code that will draw the real button, at the real
   * button's width, on a transparent field. A preview painted any other way is a preview
   * that can lie, and the one thing this tool exists to stop is art that measures
   * differently from what you were shown.
   */
  let {
    open = $bindable(false),
    current,
    fill,
    pressed = false,
    packDesigns = [],
    designSkins,
    onpick,
  }: {
    open?: boolean;
    current?: string;
    /** The button's own fill, so a red button previews its designs in red. */
    fill?: RGBA;
    pressed?: boolean;
    packDesigns?: readonly Design[];
    designSkins?: Map<string, { raster: Raster; border: number }>;
    onpick: (id: string | undefined) => void;
  } = $props();

  const HEIGHT = 18;
  const designs = $derived(allDesigns(packDesigns));
  /**
   * A fixed preview width, not the button's own.
   *
   * The differences between these designs are one and two pixels at the corners and in
   * the rim. Stretched across a 120px button they are invisible, and a gallery of eight
   * identical grey bars is worse than no gallery. Shown small and magnified they are the
   * whole point; the real button is redrawn live behind the dialog anyway.
   */
  const PREVIEW_W = 44;
  const SCALE = 3;

  function preview(design: Design | null): Raster {
    const raster = makeRaster(PREVIEW_W, HEIGHT);
    const paint = fill ?? PANEL;
    const bevels = fill ? hueShiftedBevels(paint) : VANILLA_BEVELS;
    const skin = design?.kind === "ninepatch" ? designSkins?.get(design.id) : undefined;

    if (skin) {
      drawNinepatch(raster, skin.raster, skin.border, 0, 0, PREVIEW_W, HEIGHT);
    } else {
      const style = design?.kind === "recipe" ? design.bevel : "single";
      const radius = design?.kind === "recipe" ? cornerRadius(design.corners) : 0;
      drawPlate(raster, 0, 0, PREVIEW_W, HEIGHT, paint, bevels, pressed, style, radius);
    }
    return raster;
  }

  /** Straight RGBA into a canvas, magnified so a one-pixel rim is visible in a card. */
  function paintCanvas(canvas: HTMLCanvasElement, design: Design | null): void {
    const raster = preview(design);
    const scale = SCALE;
    canvas.width = raster.width * scale;
    canvas.height = raster.height * scale;

    const offscreen = document.createElement("canvas");
    offscreen.width = raster.width;
    offscreen.height = raster.height;
    offscreen
      .getContext("2d")!
      .putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);

    const target = canvas.getContext("2d")!;
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, canvas.width, canvas.height);
    target.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  }

  function card(node: HTMLCanvasElement, design: Design | null) {
    paintCanvas(node, design);
    return {
      update: (next: Design | null) => paintCanvas(node, next),
    };
  }

  function choose(id: string | undefined): void {
    onpick(id);
    open = false;
  }
</script>

<Modal bind:open title={t("dialog.pickDesign")}>
  <div class="grid">
    <button class="card" class:on={!current} onclick={() => choose(undefined)}>
      <canvas use:card={null}></canvas>
      <span class="name">{t("design.none")}</span>
    </button>
    {#each designs as design (design.id)}
      <button class="card" class:on={current === design.id} onclick={() => choose(design.id)}>
        <canvas use:card={design}></canvas>
        <span class="name">{design.name}</span>
      </button>
    {/each}
  </div>
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--s3);
  }
  .card {
    display: grid;
    justify-items: center;
    gap: var(--s2);
    padding: var(--s4) var(--s3);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--canvas);
    color: var(--ink-soft);
    font: inherit;
    cursor: pointer;
  }
  .card:hover {
    border-color: var(--line-strong);
    color: var(--ink);
  }
  .card.on {
    border-color: var(--primary);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--primary);
  }
  .card canvas {
    display: block;
    image-rendering: pixelated;
    max-width: 100%;
  }
  .name {
    font-size: 0.75rem;
    font-weight: 600;
  }
</style>
