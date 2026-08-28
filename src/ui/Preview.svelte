<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { renderScreen, type DrawnSheet } from "../engine/chestRenderer";
  import {
    CELL,
    COLS,
    GRID_Y,
    TITLE_X,
    hotbarY,
    playerInvY,
    slotWindowRect,
    windowHeight,
  } from "../engine/geometry";

  const PAD = 32;

  let {
    base,
    overlays = [],
    rows,
    shift,
    zoom,
    guides,
    hideViewerInventory,
  }: {
    base: DrawnSheet | null;
    overlays?: (DrawnSheet | null)[];
    rows: number;
    shift: number;
    zoom: number;
    guides: boolean;
    hideViewerInventory: boolean;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    if (!canvas || !base) return;

    const raster = renderScreen({ rows, shift, base, overlays, pad: PAD, hideViewerInventory });

    // Compose at 1:1 into an offscreen canvas, then blit scaled with nearest-neighbour —
    // zoom is presentation only, all picking math stays in sheet space.
    const offscreen = document.createElement("canvas");
    offscreen.width = raster.width;
    offscreen.height = raster.height;
    const source = offscreen.getContext("2d")!;
    source.putImageData(
      new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height),
      0,
      0,
    );

    canvas.width = raster.width * zoom;
    canvas.height = raster.height * zoom;
    const target = canvas.getContext("2d")!;
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, canvas.width, canvas.height);
    target.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

    if (guides) drawGuides(target);
  });

  function drawGuides(context: CanvasRenderingContext2D): void {
    const stroke = (x: number, y: number, w: number, h: number, colour: string) => {
      context.strokeStyle = colour;
      context.lineWidth = 1;
      context.strokeRect((PAD + x) * zoom + 0.5, (PAD + y) * zoom + 0.5, w * zoom - 1, h * zoom - 1);
    };

    // Container slot hit-rects — the only clickable pixels on a painted screen.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < COLS; col++) {
        const rect = slotWindowRect(row, col);
        stroke(rect.x, rect.y, rect.w, rect.h, "rgba(240,168,49,0.85)");
      }
    }

    // The decoration band above row 0: drawn, never clickable.
    stroke(0, 0, 176, GRID_Y, "rgba(120,120,220,0.6)");

    if (!hideViewerInventory) {
      const invY = playerInvY(rows);
      stroke(TITLE_X - 1, invY - 1, COLS * CELL + 1, 3 * CELL + 1, "rgba(90,200,120,0.5)");
      stroke(TITLE_X - 1, hotbarY(rows) - 1, COLS * CELL + 1, CELL + 1, "rgba(90,200,120,0.5)");
    }

    // The window outline itself.
    stroke(0, 0, 176, windowHeight(rows), "rgba(255,255,255,0.35)");
  }
</script>

<div class="stage">
  {#if base}
    <canvas bind:this={canvas}></canvas>
  {:else}
    <p class="empty">Select a screen on the left.</p>
  {/if}
</div>

<style>
  .stage {
    overflow: auto;
    display: grid;
    place-items: center;
    min-height: 100%;
    background:
      repeating-conic-gradient(#1b1b1f 0% 25%, #202026 0% 50%) 0 0 / 24px 24px;
  }

  canvas {
    image-rendering: pixelated;
  }

  .empty {
    color: #888;
    font-size: 0.9rem;
  }
</style>
