<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { renderScreen } from "../engine/chestRenderer";
  import { buildDeployPlan } from "../engine/deploy";
  import { CELL, COLS, GRID_X, GRID_Y, TITLE_X, slotIndex, slotWindowRect, windowHeight } from "../engine/geometry";
  import { scaffoldFiles, advanceTable, type ScaffoldInput } from "../engine/javaScaffold";
  import { encodePng } from "../engine/png";
  import { serializeProject, type Element, type Project } from "../engine/project";
  import type { Raster } from "../engine/raster";
  import { bakeSheet } from "../engine/renderProject";
  import { spliceProviders } from "../engine/spliceGuiJson";
  import { parseCodepoint } from "../engine/unicode";
  import { visualsYmlBlock, configYmlBlock } from "../engine/visualsYml";
  import { joinPath, type FsBackend } from "../platform/fs";
  import { rconExec } from "../platform/rcon";

  const PAD = 32;
  const ROLE_COLOURS: Record<string, string> = {
    header: "#E8B23A", stat: "#568FD6", list: "#6AB060", action: "#D6783C",
    chart: "#966EBE", info: "#5FB4B4", empty: "#C85A5A", nav: "#78788C",
  };

  let {
    project = $bindable(),
    background,
    backend,
    packRoot,
    fontPath,
    onExit,
  }: {
    project: Project;
    background?: Raster;
    backend: FsBackend;
    packRoot: string;
    fontPath: string;
    onExit: () => void;
  } = $props();

  type Tool = "select" | "slot" | "button" | "panel" | "well" | "hotspot";
  let tool: Tool = $state("select");
  let selectedId: string | null = $state(null);
  let activeHotspot: string | null = $state(project.hotspots[0]?.id ?? null);
  let zoom = $state(2);
  let guides = $state(true);
  let statusLine = $state("");

  let canvas: HTMLCanvasElement | undefined = $state();
  let nextId = $state(1);
  let drag: { id: string; startX: number; startY: number; elX: number; elY: number } | null = null;

  // v2 deploy panel
  let deployPath = $state("");
  let rconHost = $state("");
  let rconPort = $state(25575);
  let rconPassword = $state("");

  const baked = $derived(bakeSheet(project, background));
  const selected = $derived(project.elements.find((element) => element.id === selectedId) ?? null);

  $effect(() => {
    if (!canvas) return;
    const raster = renderScreen({
      rows: project.rows,
      shift: project.shift,
      base: {
        codepoint: parseCodepoint(project.codepoint),
        advance: baked.advance,
        ascent: project.ascent,
        texture: baked.sheet,
      },
      pad: PAD,
    });

    const offscreen = document.createElement("canvas");
    offscreen.width = raster.width;
    offscreen.height = raster.height;
    offscreen.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0,
    );

    canvas.width = raster.width * zoom;
    canvas.height = raster.height * zoom;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    drawOverlays(context);
  });

  function drawOverlays(context: CanvasRenderingContext2D): void {
    const stroke = (x: number, y: number, w: number, h: number, colour: string, width = 1) => {
      context.strokeStyle = colour;
      context.lineWidth = width;
      context.strokeRect((PAD + x) * zoom + 0.5, (PAD + y) * zoom + 0.5, w * zoom - 1, h * zoom - 1);
    };
    const fill = (x: number, y: number, w: number, h: number, colour: string) => {
      context.fillStyle = colour;
      context.fillRect((PAD + x) * zoom, (PAD + y) * zoom, w * zoom, h * zoom);
    };

    if (guides) {
      for (let row = 0; row < project.rows; row++) {
        for (let col = 0; col < COLS; col++) {
          const rect = slotWindowRect(row, col);
          stroke(rect.x, rect.y, rect.w, rect.h, "rgba(255,255,255,0.18)");
        }
      }
      stroke(0, 0, 176, windowHeight(project.rows), "rgba(255,255,255,0.3)");
    }

    // Hotspot tints, role-coloured like the farm legend.
    for (const hotspot of project.hotspots) {
      const colour = ROLE_COLOURS[hotspot.role] ?? "#AAAAAA";
      for (const slot of hotspot.slots) {
        const rect = slotWindowRect(Math.floor(slot / COLS), slot % COLS);
        fill(rect.x, rect.y, rect.w, rect.h, colour + (hotspot.id === activeHotspot ? "66" : "38"));
        stroke(rect.x, rect.y, rect.w, rect.h, colour);
      }
    }

    if (selected) {
      stroke(selected.x - 1, selected.y - 1, selected.w + 2, selected.h + 2, "#FFC65C", 2);
    }
  }

  function windowPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = canvas!.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - bounds.left) / zoom) - PAD,
      y: Math.floor((event.clientY - bounds.top) / zoom) - PAD,
    };
  }

  function snapToSlot(x: number, y: number): { x: number; y: number } {
    const col = Math.min(COLS - 1, Math.max(0, Math.round((x - GRID_X) / CELL)));
    const row = Math.min(project.rows - 1, Math.max(0, Math.round((y - GRID_Y) / CELL)));
    return { x: GRID_X + col * CELL, y: GRID_Y + row * CELL };
  }

  function hitElement(x: number, y: number): Element | null {
    for (let index = project.elements.length - 1; index >= 0; index--) {
      const element = project.elements[index]!;
      if (x >= element.x && x < element.x + element.w && y >= element.y && y < element.y + element.h) {
        return element;
      }
    }
    return null;
  }

  function onPointerDown(event: PointerEvent): void {
    const point = windowPoint(event);

    if (tool === "hotspot") {
      const col = Math.floor((point.x - GRID_X) / CELL);
      const row = Math.floor((point.y - GRID_Y) / CELL);
      if (col < 0 || col >= COLS || row < 0 || row >= project.rows || !activeHotspot) return;
      const index = slotIndex(row, col);
      const hotspot = project.hotspots.find((candidate) => candidate.id === activeHotspot);
      if (!hotspot) return;
      hotspot.slots = hotspot.slots.includes(index)
        ? hotspot.slots.filter((slot) => slot !== index)
        : [...hotspot.slots, index].sort((a, b) => a - b);
      project = { ...project };
      return;
    }

    if (tool !== "select") {
      const sizes: Record<string, [number, number]> = {
        slot: [16, 16], button: [40, 18], panel: [80, 40], well: [18, 18],
      };
      const [w, h] = sizes[tool]!;
      const at = tool === "slot" ? snapToSlot(point.x, point.y) : { x: point.x - (w >> 1), y: point.y - (h >> 1) };
      const element: Element = { id: `e${nextId}`, kind: tool, x: at.x, y: at.y, w, h };
      nextId += 1;
      project = { ...project, elements: [...project.elements, element] };
      selectedId = element.id;
      tool = "select";
      return;
    }

    const hit = hitElement(point.x, point.y);
    selectedId = hit?.id ?? null;
    if (hit) {
      drag = { id: hit.id, startX: point.x, startY: point.y, elX: hit.x, elY: hit.y };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) return;
    const point = windowPoint(event);
    const element = project.elements.find((candidate) => candidate.id === drag!.id);
    if (!element) return;
    let x = drag.elX + point.x - drag.startX;
    let y = drag.elY + point.y - drag.startY;
    if (element.kind === "slot") ({ x, y } = snapToSlot(x + 8, y + 8));
    element.x = x;
    element.y = y;
    project = { ...project };
  }

  function onPointerUp(): void {
    drag = null;
  }

  function nudge(dx: number, dy: number): void {
    if (!selected) return;
    selected.x += dx;
    selected.y += dy;
    project = { ...project };
  }

  function removeSelected(): void {
    if (!selectedId) return;
    project = { ...project, elements: project.elements.filter((element) => element.id !== selectedId) };
    selectedId = null;
  }

  function addHotspot(): void {
    const id = `group${project.hotspots.length + 1}`;
    project = { ...project, hotspots: [...project.hotspots, { id, role: "action", slots: [] }] };
    activeHotspot = id;
    tool = "hotspot";
  }

  async function saveProject(): Promise<void> {
    const path = joinPath(packRoot, "tools/slotify/projects", `${project.module}-${project.screenKey}.guiproj.json`);
    await backend.write(path, new TextEncoder().encode(serializeProject(project)));
    statusLine = `saved ${path}`;
  }

  async function exportToPack(): Promise<void> {
    const texturePath = joinPath(
      packRoot, "pack-source", project.module, "assets/minecraft/textures", project.textureFile,
    );
    await backend.write(texturePath, encodePng(baked.sheet));

    const guiJsonPath = joinPath(packRoot, fontPath);
    const raw = await backend.readText(guiJsonPath);
    const result = spliceProviders(raw, [baked.provider]);
    if (result.added.length > 0 || result.corrected.length > 0) {
      await backend.write(guiJsonPath, new TextEncoder().encode(result.text));
    }
    statusLine =
      `texture written; gui.json: +${result.added.length} added, ` +
      `${result.corrected.length} corrected, ${result.skipped.length} already present. ` +
      `Advance ${baked.advance}, strays stripped ${baked.straysRemoved}.`;
  }

  function scaffoldInput(): ScaffoldInput {
    const className = project.screenKey.replace(/(^|[_-])(\w)/g, (_, __, letter: string) => letter.toUpperCase());
    return {
      packageName: `it.meridian.${project.module}.gui`,
      className,
      base: { constant: "MAIN", codepoint: parseCodepoint(project.codepoint), advance: baked.advance },
      overlays: [],
      hotspots: project.hotspots.map((hotspot) => ({
        constant: `${hotspot.id.replace(/\W/g, "_").toUpperCase()}_SLOTS`,
        slots: hotspot.slots,
      })),
      shiftConfigKey: `${project.module}.gui.${project.screenKey}-title-shift`,
    };
  }

  async function copy(text: string, what: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    statusLine = `${what} copied to clipboard`;
  }

  const screenConfig = $derived([{
    key: project.screenKey,
    codepoint: parseCodepoint(project.codepoint),
    titleShift: project.shift,
    fallbackTitle: project.fallbackTitle,
  }]);

  async function writeDeployFiles(): Promise<void> {
    if (!deployPath) {
      statusLine = "set a deploy target path first";
      return;
    }
    let targetFont = `{"providers": []}`;
    try {
      targetFont = await backend.readText(joinPath(deployPath, "assets/minecraft/font/gui.json"));
    } catch {
      statusLine = "target has no gui.json yet — starting one";
    }
    const plan = buildDeployPlan(project, baked.sheet, baked.provider, targetFont);
    for (const file of plan.files) {
      await backend.write(joinPath(deployPath, file.path), file.bytes);
    }
    statusLine = `wrote ${plan.files.length} file(s) under ${deployPath}`;
  }

  async function runReload(): Promise<void> {
    try {
      statusLine = "rcon: running…";
      const response = await rconExec(
        { host: rconHost, port: rconPort, password: rconPassword },
        "nexo reload pack",
      );
      statusLine = `rcon: ${response || "(empty response)"}`;
    } catch (error) {
      statusLine = `rcon failed: ${error}`;
    }
  }
</script>

<div class="editor">
  <aside class="tools">
    <button class="back" onclick={onExit}>← viewer</button>
    <h2>{project.module}/{project.screenKey}</h2>

    <h3>Place</h3>
    <div class="palette">
      {#each ["select", "slot", "button", "panel", "well", "hotspot"] as candidate}
        <button class:active={tool === candidate} onclick={() => (tool = candidate as Tool)}>{candidate}</button>
      {/each}
    </div>

    <h3>Layers</h3>
    <ul class="layers">
      {#each project.elements as element}
        <li>
          <button class:active={selectedId === element.id} onclick={() => (selectedId = element.id)}>
            {element.kind} @ {element.x},{element.y}
          </button>
        </li>
      {/each}
      {#if project.elements.length === 0}
        <li class="hint">Pick a component above, then tap the canvas.</li>
      {/if}
    </ul>

    {#if selected}
      <h3>Selected</h3>
      <div class="grid2">
        <label>x <input type="number" bind:value={selected.x} onchange={() => (project = { ...project })} /></label>
        <label>y <input type="number" bind:value={selected.y} onchange={() => (project = { ...project })} /></label>
        <label>w <input type="number" min="2" bind:value={selected.w} onchange={() => (project = { ...project })} /></label>
        <label>h <input type="number" min="2" bind:value={selected.h} onchange={() => (project = { ...project })} /></label>
      </div>
      {#if selected.kind === "button"}
        <label class="row"><input type="checkbox" bind:checked={selected.pressed} onchange={() => (project = { ...project })} /> pressed</label>
      {/if}
      <div class="nudge">
        <button onclick={() => nudge(0, -1)} aria-label="up">▲</button>
        <div>
          <button onclick={() => nudge(-1, 0)} aria-label="left">◀</button>
          <button onclick={() => nudge(1, 0)} aria-label="right">▶</button>
        </div>
        <button onclick={() => nudge(0, 1)} aria-label="down">▼</button>
        <button class="danger" onclick={removeSelected}>delete</button>
      </div>
    {/if}

    <h3>Hotspots</h3>
    <ul class="layers">
      {#each project.hotspots as hotspot}
        <li class="hotspot-row">
          <button class:active={activeHotspot === hotspot.id} onclick={() => { activeHotspot = hotspot.id; tool = "hotspot"; }}>
            <span class="swatch" style:background={ROLE_COLOURS[hotspot.role] ?? "#aaa"}></span>
            {hotspot.id} · {hotspot.slots.length}
          </button>
          <select bind:value={hotspot.role} onchange={() => (project = { ...project })}>
            {#each Object.keys(ROLE_COLOURS) as role}<option>{role}</option>{/each}
          </select>
        </li>
      {/each}
    </ul>
    <button onclick={addHotspot}>+ hotspot group</button>
  </aside>

  <section class="stage" >
    <canvas
      bind:this={canvas}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    ></canvas>
  </section>

  <aside class="panel">
    <h3>Screen</h3>
    <div class="grid2">
      <label>rows <input type="number" min="1" max="6" bind:value={project.rows} /></label>
      <label>shift <input type="number" bind:value={project.shift} /></label>
      <label>ascent <input type="number" bind:value={project.ascent} /></label>
      <label>zoom <input type="number" min="1" max="8" bind:value={zoom} /></label>
    </div>
    <label class="row">codepoint <input bind:value={project.codepoint} /></label>
    <label class="row">fallback <input bind:value={project.fallbackTitle} /></label>
    <label class="row"><input type="checkbox" bind:checked={guides} /> guides</label>

    <h3>Measured</h3>
    <p class="measure">
      advance <b>{baked.advance}</b> · strays stripped <b class={baked.straysRemoved ? "warn" : ""}>{baked.straysRemoved}</b>
    </p>

    <h3>Export</h3>
    <div class="actions">
      <button onclick={saveProject}>Save project</button>
      <button onclick={exportToPack}>Export to pack-source</button>
      <button onclick={() => copy(visualsYmlBlock(screenConfig), "visuals yml")}>Copy visuals yml</button>
      <button onclick={() => copy(configYmlBlock(`${project.module}.gui`, screenConfig), "config yml")}>Copy config yml</button>
      <button onclick={() => {
        const files = scaffoldFiles(scaffoldInput());
        const text = Object.entries(files).map(([path, body]) => `// ==== ${path}\n${body}`).join("\n");
        copy(text + "\n" + advanceTable(scaffoldInput()), "Java scaffold");
      }}>Copy Java scaffold</button>
    </div>

    <h3>Push (dev)</h3>
    <label class="row">pack path <input bind:value={deployPath} placeholder="…/.slotify-staging/pack" /></label>
    <div class="grid2">
      <label>host <input bind:value={rconHost} /></label>
      <label>port <input type="number" bind:value={rconPort} /></label>
    </div>
    <label class="row">password <input type="password" bind:value={rconPassword} /></label>
    <div class="actions">
      <button onclick={writeDeployFiles}>Write files</button>
      <button onclick={runReload} disabled={!rconHost || !rconPassword}>nexo reload pack</button>
    </div>

    {#if statusLine}<p class="status">{statusLine}</p>{/if}
  </aside>
</div>

<style>
  .editor {
    display: grid;
    grid-template-columns: 250px 1fr 300px;
    height: 100vh;
  }

  @media (max-width: 980px) {
    .editor {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: minmax(40vh, 1fr) minmax(0, 60vh);
      height: auto;
    }
    .stage { grid-column: 1 / -1; grid-row: 1; }
    .tools, .panel { grid-row: 2; }
  }

  .tools, .panel {
    overflow-y: auto;
    padding: 0.75rem;
    background: #1c1c21;
  }
  .tools { border-right: 1px solid #2c2c33; }
  .panel { border-left: 1px solid #2c2c33; }

  .stage {
    overflow: auto;
    display: grid;
    place-items: center;
    background: repeating-conic-gradient(#1b1b1f 0% 25%, #202026 0% 50%) 0 0 / 24px 24px;
    touch-action: none;
  }
  canvas { image-rendering: pixelated; touch-action: none; }

  h2 { font-size: 0.95rem; margin: 0.5rem 0; word-break: break-all; }
  h3 { font-size: 0.8rem; margin: 0.9rem 0 0.3rem; color: #b8b2a7; text-transform: uppercase; letter-spacing: 0.04em; }

  .palette { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .palette button, .actions button, .back, .nudge button, .layers button, button {
    background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 6px;
    padding: 0.45rem 0.6rem; font: inherit; cursor: pointer; min-height: 34px;
  }
  .palette button.active, .layers button.active { background: #3b2a1a; color: #ffc65c; border-color: #7a5220; }
  .danger { border-color: #7a2a20; color: #ff9c8b; }

  .layers { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
  .layers button { width: 100%; text-align: left; }
  .hotspot-row { display: flex; gap: 0.3rem; }
  .hotspot-row button { flex: 1; display: flex; align-items: center; gap: 0.4rem; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .hint { color: #77726a; font-size: 0.8rem; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; }
  label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; }
  label.row { margin: 0.3rem 0; }
  input { background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 4px; padding: 0.3rem 0.4rem; width: 100%; min-width: 0; }
  input[type="checkbox"] { width: auto; }
  select { background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 4px; }

  .nudge { display: grid; justify-items: center; gap: 0.25rem; margin-top: 0.4rem; }
  .nudge div { display: flex; gap: 1.6rem; }
  .nudge button { width: 44px; height: 38px; }

  .actions { display: grid; gap: 0.3rem; }
  .measure { font-size: 0.85rem; }
  .warn { color: #ff9c5b; }
  .status { font-size: 0.78rem; color: #9ad17e; word-break: break-all; }
</style>
