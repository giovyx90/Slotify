<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { regionKeyAt, regionRect } from "../engine/carve";
  import { renderScreen } from "../engine/chestRenderer";
  import {
    componentFromElements,
    instantiate,
    slugify,
    type LibraryComponent,
  } from "../engine/components";
  import { buildDeployPlan } from "../engine/deploy";
  import { CELL, COLS, GRID_X, GRID_Y, hotbarY, playerInvY, slotIndex, slotWindowRect, windowHeight } from "../engine/geometry";
  import { scaffoldFiles, advanceTable, type ScaffoldInput } from "../engine/javaScaffold";
  import { encodePng } from "../engine/png";
  import { serializeProject, type Element, type Project } from "../engine/project";
  import type { Raster } from "../engine/raster";
  import { bakeSheet, type RenderContext } from "../engine/renderProject";
  import { snapToEdges } from "../engine/snap";
  import { spliceProviders } from "../engine/spliceGuiJson";
  import { measureText, type BitmapFont, type ShadowDir } from "../engine/textFont";
  import { cellAt, type TileCell } from "../engine/tiles";
  import { parseCodepoint } from "../engine/unicode";
  import { visualsYmlBlock, configYmlBlock } from "../engine/visualsYml";
  import { joinPath, type FsBackend } from "../platform/fs";
  import { rconExec } from "../platform/rcon";
  import { decodeTexture, listComponents, loadSpriteRaster, saveComponent } from "./model";

  const PAD = 32;
  const ROLE_COLOURS: Record<string, string> = {
    header: "#E8B23A", stat: "#568FD6", list: "#6AB060", action: "#D6783C",
    chart: "#966EBE", info: "#5FB4B4", empty: "#C85A5A", nav: "#78788C",
  };
  const SHADOW_DIRS: ShadowDir[] = [
    "none", "below-right", "below", "right", "below-left", "left", "above", "above-right", "above-left",
  ];

  let {
    project = $bindable(),
    background,
    backend,
    packRoot,
    fontPath,
    fonts,
    infoboxSkin,
    panelSkin,
    onExit,
  }: {
    project: Project;
    background?: Raster;
    backend: FsBackend;
    packRoot: string;
    fontPath: string;
    fonts: { minecraft?: BitmapFont; mono5?: BitmapFont };
    infoboxSkin?: { raster: Raster; border: number };
    panelSkin?: { raster: Raster; border: number };
    onExit: () => void;
  } = $props();

  type Tool = "select" | "button" | "infobox" | "slot" | "erase" | "text" | "panel" | "well" | "hotspot";
  let tool: Tool = $state("select");
  let selectedId: string | null = $state(null);
  let checked = $state(new Set<string>());
  let activeHotspot: string | null = $state(project.hotspots[0]?.id ?? null);
  let zoom = $state(2);
  let guides = $state(true);
  let statusLine = $state("");

  let canvas: HTMLCanvasElement | undefined = $state();
  let nextIdCounter = $state(1);
  let drag: { id: string; startX: number; startY: number; elX: number; elY: number } | null = null;

  let library: LibraryComponent[] = $state([]);
  let pendingComponent: LibraryComponent | null = $state(null);
  let spriteRasters = $state(new Map<string, Raster>());
  let componentName = $state("");
  let fileInput: HTMLInputElement | undefined = $state();

  let deployPath = $state("");
  let rconHost = $state("");
  let rconPort = $state(25575);
  let rconPassword = $state("");

  const context = $derived<RenderContext>({ fonts, sprites: spriteRasters, infoboxSkin, panelSkin });
  const baked = $derived(bakeSheet(project, background, context));
  const selected = $derived(project.elements.find((element) => element.id === selectedId) ?? null);
  const hasText = $derived(
    selected != null && ["button", "text", "infobox", "tiles", "panel"].includes(selected.kind),
  );

  function nextId(): string {
    return `e${nextIdCounter++}`;
  }

  function touch(): void {
    project = { ...project };
  }

  async function refreshLibrary(): Promise<void> {
    library = await listComponents(backend, packRoot);
  }

  async function ensureSprites(elements: readonly Element[]): Promise<void> {
    const wanted = elements
      .filter((element) => element.kind === "sprite" && element.sprite && !spriteRasters.has(element.sprite))
      .map((element) => element.sprite!);
    if (wanted.length === 0) return;
    const next = new Map(spriteRasters);
    for (const id of new Set(wanted)) {
      const raster = await loadSpriteRaster(backend, packRoot, id);
      if (raster) next.set(id, raster);
    }
    spriteRasters = next;
  }

  $effect(() => {
    void refreshLibrary();
    void ensureSprites(project.elements);
    const used = project.elements
      .map((element) => Number(/^e(\d+)$/.exec(element.id)?.[1] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    if (used >= nextIdCounter) nextIdCounter = used + 1;
  });

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
      // When the window is baked into the sheet, drawing it again underneath would
      // fill the carved holes back in — the checkerboard behind IS the transparency.
      bare: project.bakeWindow ?? false,
      hiddenContainerSlots: new Set(project.hiddenSlots ?? []),
      hiddenInvSlots: new Set(project.hiddenInvSlots ?? []),
      holes: new Set(project.holes ?? []),
    });

    const offscreen = document.createElement("canvas");
    offscreen.width = raster.width;
    offscreen.height = raster.height;
    offscreen.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0,
    );

    canvas.width = raster.width * zoom;
    canvas.height = raster.height * zoom;
    const target = canvas.getContext("2d")!;
    target.imageSmoothingEnabled = false;
    target.clearRect(0, 0, canvas.width, canvas.height);
    target.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    drawOverlays(target);
  });

  function drawOverlays(target: CanvasRenderingContext2D): void {
    const stroke = (x: number, y: number, w: number, h: number, colour: string, width = 1) => {
      target.strokeStyle = colour;
      target.lineWidth = width;
      target.strokeRect((PAD + x) * zoom + 0.5, (PAD + y) * zoom + 0.5, w * zoom - 1, h * zoom - 1);
    };
    const fill = (x: number, y: number, w: number, h: number, colour: string) => {
      target.fillStyle = colour;
      target.fillRect((PAD + x) * zoom, (PAD + y) * zoom, w * zoom, h * zoom);
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

    for (const hotspot of project.hotspots) {
      const colour = ROLE_COLOURS[hotspot.role] ?? "#AAAAAA";
      for (const slot of hotspot.slots) {
        const rect = slotWindowRect(Math.floor(slot / COLS), slot % COLS);
        fill(rect.x, rect.y, rect.w, rect.h, colour + (hotspot.id === activeHotspot ? "66" : "38"));
        stroke(rect.x, rect.y, rect.w, rect.h, colour);
      }
    }

    if (tool === "erase") {
      for (const hole of project.holes ?? []) {
        const region = regionRect(hole, project.rows);
        fill(region.x, region.y, region.w, region.h, "rgba(200,90,90,0.3)");
        stroke(region.x, region.y, region.w, region.h, "rgba(200,90,90,0.8)");
      }
    }

    for (const id of checked) {
      const element = project.elements.find((candidate) => candidate.id === id);
      if (element) stroke(element.x - 1, element.y - 1, element.w + 2, element.h + 2, "#5FB4B4");
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

  function snapSlot(x: number, y: number): { x: number; y: number } {
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

  function refreshTileBox(element: Element): void {
    const cells = (element.cells ?? []) as TileCell[];
    if (cells.length === 0) return;
    const rows = cells.map(([row]) => row);
    const cols = cells.map(([, col]) => col);
    element.x = 7 + 18 * Math.min(...cols);
    element.y = 17 + 18 * Math.min(...rows);
    element.w = 18 * (Math.max(...cols) - Math.min(...cols) + 1);
    element.h = 18 * (Math.max(...rows) - Math.min(...rows) + 1);
  }

  /**
   * The NXMenu gesture: tap a cell — a 1×1 piece appears; tap the cell next to it and
   * the piece grows; tap a claimed cell and it shrinks back. A tap away from the
   * current piece starts a new one.
   */
  function tapTile(point: { x: number; y: number }, tileKind: "button" | "infobox"): void {
    const cell = cellAt(point.x, point.y);
    if (!cell) return;
    const [row, col] = cell;

    const current =
      selected && selected.kind === "tiles" && selected.tileKind === tileKind ? selected : null;
    const cells = (current?.cells ?? []) as TileCell[];
    const inRegion = cells.some(([r, c]) => r === row && c === col);
    const adjacent = cells.some(([r, c]) => Math.abs(r - row) + Math.abs(c - col) === 1);

    if (current && inRegion) {
      current.cells = cells.filter(([r, c]) => !(r === row && c === col));
      if (current.cells.length === 0) {
        project = { ...project, elements: project.elements.filter((element) => element.id !== current.id) };
        selectedId = null;
        return;
      }
      refreshTileBox(current);
      touch();
      return;
    }

    if (current && adjacent) {
      // An infobox breaks after 12 tiles of width: growing past that starts a new box.
      if (tileKind === "infobox") {
        const cols = [...cells.map(([, c]) => c), col];
        if (Math.max(...cols) - Math.min(...cols) + 1 > 12) {
          statusLine = "infobox capped at 12 tiles wide — started a new one";
        } else {
          current.cells = [...cells, cell];
          refreshTileBox(current);
          touch();
          return;
        }
      } else {
        current.cells = [...cells, cell];
        refreshTileBox(current);
        touch();
        return;
      }
    }

    const element: Element = {
      id: nextId(),
      kind: "tiles",
      tileKind,
      cells: [cell],
      x: 7 + 18 * col,
      y: 17 + 18 * row,
      w: 18,
      h: 18,
      ...(tileKind === "infobox" ? { lines: ["Info line"], font: "minecraft" as const } : { label: "" }),
    };
    project = { ...project, elements: [...project.elements, element] };
    selectedId = element.id;
  }

  /**
   * Tap any region — a slot, the top band, a margin — and it is punched clean out of
   * the window: a transparent hole the contour redraws around. Tap again to restore.
   */
  function tapErase(point: { x: number; y: number }): void {
    const key = regionKeyAt(point.x, point.y, project.rows);
    if (!key) return;
    const holes = new Set(project.holes ?? []);
    if (holes.has(key)) holes.delete(key);
    else holes.add(key);
    project = { ...project, holes: [...holes].sort() };
  }

  function onPointerDown(event: PointerEvent): void {
    const point = windowPoint(event);

    if (pendingComponent) {
      const placed = instantiate(
        pendingComponent,
        point.x - (pendingComponent.w >> 1),
        point.y - (pendingComponent.h >> 1),
        nextId,
      );
      project = { ...project, elements: [...project.elements, ...placed] };
      void ensureSprites(placed);
      selectedId = placed[0]?.id ?? null;
      statusLine = `placed ${pendingComponent.name}`;
      pendingComponent = null;
      return;
    }

    if (tool === "button" || tool === "infobox") {
      tapTile(point, tool);
      return;
    }

    if (tool === "erase") {
      tapErase(point);
      return;
    }

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
      touch();
      return;
    }

    if (tool !== "select") {
      const defaults: Record<string, Partial<Element> & { w: number; h: number }> = {
        slot: { w: 16, h: 16 },
        panel: { w: 80, h: 40 },
        well: { w: 18, h: 18 },
        text: { w: 40, h: 8, label: "Text", textColor: "#FFFFFF", shadow: "below-right" },
      };
      const base = defaults[tool]!;
      const at = tool === "slot" ? snapSlot(point.x, point.y) : { x: point.x - (base.w >> 1), y: point.y - (base.h >> 1) };
      const element: Element = { id: nextId(), kind: tool as Element["kind"], x: at.x, y: at.y, ...base } as Element;
      if (element.kind === "text") retextSize(element);
      project = { ...project, elements: [...project.elements, element] };
      selectedId = element.id;
      tool = "select";
      return;
    }

    const hit = hitElement(point.x, point.y);
    selectedId = hit?.id ?? null;
    if (hit && hit.kind !== "tiles") {
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

    if (element.kind === "slot") {
      ({ x, y } = snapSlot(x + 8, y + 8));
    } else {
      const others = project.elements
        .filter((candidate) => candidate.id !== element.id)
        .map((candidate) => ({ x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h }));
      ({ x, y } = snapToEdges({ x, y, w: element.w, h: element.h }, others));
    }

    element.x = x;
    element.y = y;
    touch();
  }

  function onPointerUp(): void {
    drag = null;
  }

  function nudge(dx: number, dy: number): void {
    if (!selected || selected.kind === "tiles") return;
    selected.x += dx;
    selected.y += dy;
    touch();
  }

  function removeSelected(): void {
    if (!selectedId) return;
    project = { ...project, elements: project.elements.filter((element) => element.id !== selectedId) };
    selectedId = null;
  }

  function retextSize(element: Element): void {
    const font = element.font === "mono5" ? fonts.mono5 : fonts.minecraft ?? fonts.mono5;
    if (element.kind === "text" && font && element.label) {
      const size = measureText(font, element.label);
      element.w = Math.max(1, size.w);
      element.h = size.h;
    }
  }

  function toggleChecked(id: string): void {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    checked = next;
  }

  function setLine(index: number, text: string): void {
    if (!selected) return;
    const lines = [...(selected.lines ?? [])];
    lines[index] = text;
    selected.lines = lines;
    touch();
  }

  function setLineColor(index: number, colour: string): void {
    if (!selected) return;
    const colours = [...(selected.lineColors ?? [])];
    while (colours.length < (selected.lines ?? []).length) colours.push(null);
    colours[index] = colour;
    selected.lineColors = colours;
    touch();
  }

  function addLine(): void {
    if (!selected) return;
    selected.lines = [...(selected.lines ?? []), ""];
    touch();
  }

  function removeLine(index: number): void {
    if (!selected) return;
    selected.lines = (selected.lines ?? []).filter((_, i) => i !== index);
    selected.lineColors = (selected.lineColors ?? []).filter((_, i) => i !== index);
    touch();
  }

  async function saveSelectionAsComponent(): Promise<void> {
    const ids = checked.size > 0 ? checked : selectedId ? new Set([selectedId]) : new Set<string>();
    const elements = project.elements.filter((element) => ids.has(element.id));
    if (elements.length === 0 || !componentName.trim()) {
      statusLine = "check some layers and give the component a name first";
      return;
    }
    const component = componentFromElements(slugify(componentName), componentName.trim(), elements);
    await saveComponent(backend, packRoot, component);
    componentName = "";
    checked = new Set();
    await refreshLibrary();
    statusLine = `component "${component.name}" saved to the library`;
  }

  async function importSpritePng(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const raster = decodeTexture(bytes);
    const name = file.name.replace(/\.png$/i, "");
    const component: LibraryComponent = {
      version: 1,
      id: slugify(name),
      name,
      kind: "sprite",
      w: raster.width,
      h: raster.height,
    };
    await saveComponent(backend, packRoot, component, bytes);
    spriteRasters = new Map(spriteRasters).set(component.id, raster);
    await refreshLibrary();
    statusLine = `sprite "${name}" imported — tap the canvas to place it`;
    pendingComponent = component;
    (event.target as HTMLInputElement).value = "";
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

    <h3>Tools <span class="hint">button/infobox grow tile by tile</span></h3>
    <div class="palette">
      {#each ["select", "button", "infobox", "slot", "erase", "text", "panel", "well", "hotspot"] as candidate}
        <button class:active={tool === candidate && !pendingComponent} onclick={() => { tool = candidate as Tool; pendingComponent = null; }}>{candidate}</button>
      {/each}
    </div>

    <h3>Library</h3>
    <ul class="layers">
      {#each library as component}
        <li>
          <button class:active={pendingComponent?.id === component.id} onclick={() => { pendingComponent = component; statusLine = `tap the canvas to place ${component.name}`; }}>
            {component.kind === "sprite" ? "🖼" : "🧩"} {component.name} <span class="hint">{component.w}×{component.h}</span>
          </button>
        </li>
      {/each}
      {#if library.length === 0}
        <li class="hint">No components yet — check layers below and save, or import a PNG.</li>
      {/if}
    </ul>
    <div class="row2">
      <input placeholder="component name" bind:value={componentName} />
      <button onclick={saveSelectionAsComponent}>save ✓</button>
    </div>
    <button onclick={() => fileInput?.click()}>Import PNG…</button>
    <input class="hidden" type="file" accept="image/png" bind:this={fileInput} onchange={importSpritePng} />

    <h3>Layers <span class="hint">✓ = in the next component</span></h3>
    <ul class="layers">
      {#each project.elements as element}
        <li class="layer-row">
          <input type="checkbox" checked={checked.has(element.id)} onchange={() => toggleChecked(element.id)} />
          <button class:active={selectedId === element.id} onclick={() => (selectedId = element.id)}>
            {element.kind === "tiles" ? `${element.tileKind} ×${element.cells?.length ?? 0}` : element.kind}{element.label ? ` “${element.label}”` : ""} @ {element.x},{element.y}
          </button>
        </li>
      {/each}
      {#if project.elements.length === 0}
        <li class="hint">Pick button or infobox, then tap the grid — each tap grows the piece.</li>
      {/if}
    </ul>

    <h3>Hotspots</h3>
    <ul class="layers">
      {#each project.hotspots as hotspot}
        <li class="hotspot-row">
          <button class:active={activeHotspot === hotspot.id} onclick={() => { activeHotspot = hotspot.id; tool = "hotspot"; }}>
            <span class="swatch" style:background={ROLE_COLOURS[hotspot.role] ?? "#aaa"}></span>
            {hotspot.id} · {hotspot.slots.length}
          </button>
          <select bind:value={hotspot.role} onchange={touch}>
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
    {#if selected}
      <h3>Selected: {selected.kind === "tiles" ? `${selected.tileKind} tiles` : selected.kind}</h3>
      {#if selected.kind !== "tiles"}
        <div class="grid2">
          <label>x <input type="number" bind:value={selected.x} onchange={touch} /></label>
          <label>y <input type="number" bind:value={selected.y} onchange={touch} /></label>
          <label>w <input type="number" min="2" bind:value={selected.w} onchange={touch} /></label>
          <label>h <input type="number" min="2" bind:value={selected.h} onchange={touch} /></label>
        </div>
      {:else}
        <p class="hint">Tap cells with the {selected.tileKind} tool to grow or shrink this piece.</p>
      {/if}

      {#if selected.kind === "button" || selected.kind === "text" || selected.kind === "panel" || (selected.kind === "tiles" && selected.tileKind === "button")}
        <label class="row">label <input value={selected.label ?? ""} oninput={(event) => { selected!.label = (event.target as HTMLInputElement).value; retextSize(selected!); touch(); }} /></label>
      {/if}

      {#if selected.kind === "infobox" || (selected.kind === "tiles" && selected.tileKind === "infobox")}
        <h3>Lines <span class="hint">each with its own colour</span></h3>
        {#each selected.lines ?? [] as line, index}
          <div class="line-row">
            <input value={line} oninput={(event) => setLine(index, (event.target as HTMLInputElement).value)} />
            <input
              type="color"
              value={selected.lineColors?.[index] ?? selected.textColor ?? "#E6E2DA"}
              oninput={(event) => setLineColor(index, (event.target as HTMLInputElement).value.toUpperCase())}
            />
            <button class="mini danger" onclick={() => removeLine(index)}>×</button>
          </div>
        {/each}
        <div class="row2">
          <button onclick={addLine}>+ line</button>
          <label>gap
            <select value={selected.lineGap ?? 2} onchange={(event) => { selected!.lineGap = Number((event.target as HTMLSelectElement).value) as 2 | 3 | 4; touch(); }}>
              <option value={2}>2px</option>
              <option value={3}>3px</option>
              <option value={4}>4px</option>
            </select>
          </label>
        </div>
      {/if}

      {#if hasText}
        <div class="grid2" style="margin-top:0.4rem">
          <label>font
            <select value={selected.font ?? "minecraft"} onchange={(event) => { selected!.font = (event.target as HTMLSelectElement).value as "minecraft" | "mono5"; retextSize(selected!); touch(); }}>
              <option value="minecraft">minecraft</option>
              <option value="mono5">mono 5×5</option>
            </select>
          </label>
          <label>shadow
            <select value={selected.shadow ?? "none"} onchange={(event) => { selected!.shadow = (event.target as HTMLSelectElement).value as ShadowDir; touch(); }}>
              {#each SHADOW_DIRS as dir}<option value={dir}>{dir}</option>{/each}
            </select>
          </label>
        </div>
      {/if}

      <div class="grid2 colors">
        {#if !["text", "sprite", "slot"].includes(selected.kind) && !(selected.kind === "tiles" && selected.tileKind === "infobox") && selected.kind !== "infobox"}
          <label>fill <input type="color" value={selected.color ?? "#C6C6C6"} oninput={(event) => { selected!.color = (event.target as HTMLInputElement).value.toUpperCase(); touch(); }} /></label>
        {/if}
        {#if hasText}
          <label>text <input type="color" value={selected.textColor ?? "#FFFFFF"} oninput={(event) => { selected!.textColor = (event.target as HTMLInputElement).value.toUpperCase(); touch(); }} /></label>
        {/if}
      </div>

      {#if selected.kind === "button" || (selected.kind === "tiles" && selected.tileKind === "button")}
        <label class="row"><input type="checkbox" bind:checked={selected.pressed} onchange={touch} /> pressed</label>
      {/if}

      <div class="nudge">
        {#if selected.kind !== "tiles"}
          <button onclick={() => nudge(0, -1)} aria-label="up">▲</button>
          <div>
            <button onclick={() => nudge(-1, 0)} aria-label="left">◀</button>
            <button onclick={() => nudge(1, 0)} aria-label="right">▶</button>
          </div>
          <button onclick={() => nudge(0, 1)} aria-label="down">▼</button>
        {/if}
        <button class="danger" onclick={removeSelected}>delete</button>
      </div>
    {/if}

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
    <label class="row"><input type="checkbox" bind:checked={project.bakeWindow} /> bake window into the sheet</label>
    <p class="hint">
      erase tool: tap any part of the window — a slot, the top band, a margin — and it
      becomes a transparent hole; the contour redraws around it. Tap again to restore.
      Holes: {project.holes?.length ?? 0}.
    </p>

    <h3>Measured</h3>
    <p class="measure">
      advance <b>{baked.advance}</b> · strays stripped <b class={baked.straysRemoved ? "warn" : ""}>{baked.straysRemoved}</b>
      {#if !fonts.minecraft}<br /><span class="warn">pack font not loaded — minecraft face falls back to mono</span>{/if}
      {#if !infoboxSkin}<br /><span class="warn">no infobox skin in profile — using the procedural stand-in</span>{/if}
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
    grid-template-columns: 260px 1fr 300px;
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
  h3 .hint { text-transform: none; letter-spacing: 0; }

  .palette { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  button {
    background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 6px;
    padding: 0.45rem 0.6rem; font: inherit; cursor: pointer; min-height: 34px;
  }
  .palette button.active, .layers button.active { background: #3b2a1a; color: #ffc65c; border-color: #7a5220; }
  .danger { border-color: #7a2a20; color: #ff9c8b; }
  .mini { min-height: 30px; padding: 0.2rem 0.5rem; }

  .layers { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
  .layers button { width: 100%; text-align: left; }
  .layer-row { display: flex; align-items: center; gap: 0.3rem; }
  .layer-row input[type="checkbox"] { width: auto; }
  .layer-row button { flex: 1; }
  .hotspot-row { display: flex; gap: 0.3rem; }
  .hotspot-row button { flex: 1; display: flex; align-items: center; gap: 0.4rem; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .hint { color: #77726a; font-size: 0.78rem; }
  .hidden { display: none; }
  .row2 { display: flex; gap: 0.3rem; margin: 0.3rem 0; }
  .row2 input { flex: 1; }

  .line-row { display: flex; gap: 0.25rem; margin-bottom: 0.25rem; align-items: center; }
  .line-row input[type="color"] { width: 38px; flex: none; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; }
  .colors { margin-top: 0.4rem; }
  label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; }
  label.row { margin: 0.3rem 0; }
  input, textarea {
    background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 4px;
    padding: 0.3rem 0.4rem; width: 100%; min-width: 0; font: inherit;
  }
  input[type="checkbox"] { width: auto; }
  input[type="color"] { padding: 0.1rem; height: 30px; }
  select { background: #26262d; color: inherit; border: 1px solid #33333b; border-radius: 4px; min-width: 0; }

  .nudge { display: grid; justify-items: center; gap: 0.25rem; margin-top: 0.4rem; }
  .nudge div { display: flex; gap: 1.6rem; }
  .nudge button { width: 44px; height: 38px; }

  .actions { display: grid; gap: 0.3rem; }
  .measure { font-size: 0.85rem; }
  .warn { color: #ff9c5b; }
  .status { font-size: 0.78rem; color: #9ad17e; word-break: break-all; }
</style>
