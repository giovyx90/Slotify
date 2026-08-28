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
        stroke(rect.x, rect.y, rect.w, rect.h, "rgba(255,59,71,0.6)");
      }
    }

    // The decoration band above row 0: drawn, never clickable.
    stroke(0, 0, 176, GRID_Y, "rgba(37,112,212,0.55)");

    if (!hideViewerInventory) {
      const invY = playerInvY(rows);
      stroke(TITLE_X - 1, invY - 1, COLS * CELL + 1, 3 * CELL + 1, "rgba(23,163,74,0.5)");
      stroke(TITLE_X - 1, hotbarY(rows) - 1, COLS * CELL + 1, CELL + 1, "rgba(23,163,74,0.5)");
    }

    // The window outline itself.
    stroke(0, 0, 176, windowHeight(rows), "rgba(11,13,16,0.35)");
  }
</script>

<!--
  `.stage`, its checkerboard and the pixelated canvas are global (see theme.css): the
  editor and the tag generator paint on the same surface, and it should be the one
  surface.
-->
<div class="stage">
  {#if base}
    <canvas bind:this={canvas}></canvas>
  {:else}
    <div class="empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
      </svg>
      <p>
        Pick a screen on the left. It lands in a real chest window here, at the ascent and
        advance the pack actually declares — not the ones it meant to.
      </p>
    </div>
  {/if}
</div>
