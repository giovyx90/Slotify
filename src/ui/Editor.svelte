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
  import { decodeTexture, deleteComponent, listComponents, loadSpriteRaster, saveComponent } from "./model";

  const PAD = 32;
  const ROLE_COLOURS: Record<string, string> = {
    header: "#E8B23A", stat: "#568FD6", list: "#6AB060", action: "#D6783C",
    chart: "#966EBE", info: "#5FB4B4", empty: "#C85A5A", nav: "#78788C",
  };
  /**
   * The chrome drawn over the artwork, in the interface's own colours: red is the
   * selection — the thing you are acting on — blue the pieces staged for a component,
   * ink the guides, which a pale checkerboard would otherwise swallow.
   */
  const OVERLAY = {
    grid: "rgba(11,13,16,0.18)",
    window: "rgba(11,13,16,0.30)",
    holeFill: "rgba(217,38,50,0.28)",
    holeLine: "rgba(217,38,50,0.85)",
    staged: "#2570D4",
    selected: "#FF3B47",
  } as const;
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

  /** Deletes a component's files from the library — every project loses it, so ask. */
  async function removeComponent(component: LibraryComponent): Promise<void> {
    if (!window.confirm(`Delete "${component.name}" from the library?`)) return;
    await deleteComponent(backend, packRoot, component);
    if (pendingComponent?.id === component.id) pendingComponent = null;
    await refreshLibrary();
    statusLine = `component "${component.name}" deleted`;
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
          stroke(rect.x, rect.y, rect.w, rect.h, OVERLAY.grid);
        }
      }
      stroke(0, 0, 176, windowHeight(project.rows), OVERLAY.window);
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
        fill(region.x, region.y, region.w, region.h, OVERLAY.holeFill);
        stroke(region.x, region.y, region.w, region.h, OVERLAY.holeLine);
      }
    }

    for (const id of checked) {
      const element = project.elements.find((candidate) => candidate.id === id);
      if (element) stroke(element.x - 1, element.y - 1, element.w + 2, element.h + 2, OVERLAY.staged);
    }

    if (selected) {
      stroke(selected.x - 1, selected.y - 1, selected.w + 2, selected.h + 2, OVERLAY.selected, 2);
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

    if (tool === "button") {
      tapTile(point, "button");
      return;
    }

    if (tool === "infobox") {
      // The project-standard infobox: full window width, the skin's native height,
      // top snapped to the tapped lattice row — exactly the template, not a mini-box.
      const row = Math.max(0, Math.floor((point.y - 17) / 18));
      const element: Element = {
        id: nextId(),
        kind: "infobox",
        x: 0,
        y: Math.min(17 + 18 * row, 256 - (infoboxSkin?.raster.height ?? 91)),
        w: infoboxSkin?.raster.width ?? 176,
        h: infoboxSkin?.raster.height ?? 91,
        lines: ["Info line"],
        font: "minecraft",
        textScale: 2,
      };
      project = { ...project, elements: [...project.elements, element] };
      selectedId = element.id;
      tool = "select";
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

<div class="app">
  <header class="topbar">
    <button class="btn ghost" onclick={onExit}>← Viewer</button>

    <div class="ident">
      <span class="label-mono">{project.module}</span>
      <h2>{project.screenKey}</h2>
    </div>
    <span class="chip">{project.codepoint}</span>

    <div class="spacer"></div>

    <div class="chips">
      <span class="chip">advance <b>{baked.advance}</b></span>
      {#if baked.straysRemoved > 0}
        <span class="badge warn">{baked.straysRemoved} strays stripped</span>
      {/if}
    </div>

    <button class="btn" onclick={saveProject}>Save project</button>
    <button class="btn primary" onclick={exportToPack}>Export to pack</button>
  </header>

  <div class="workspace">
    <aside class="pane left">
      <section class="card">
        <div class="card-head">
          <span class="label-mono">Tools</span>
        </div>
        <div class="palette">
          {#each ["select", "button", "infobox", "slot", "erase", "text", "panel", "well", "hotspot"] as candidate}
            <button
              class="tool"
              class:active={tool === candidate && !pendingComponent}
              onclick={() => { tool = candidate as Tool; pendingComponent = null; }}
            >{candidate}</button>
          {/each}
        </div>
        <p class="hint">Button and infobox grow tile by tile: tap a cell, then the next.</p>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">Library</span>
          <span class="count">{library.length}</span>
        </div>
        <ul class="list">
          {#each library as component}
            <li class="layer-row">
              <button
                class="row-btn"
                class:active={pendingComponent?.id === component.id}
                onclick={() => { pendingComponent = component; statusLine = `tap the canvas to place ${component.name}`; }}
              >
                <span class="truncate">{component.kind === "sprite" ? "🖼" : "🧩"} {component.name}</span>
                <span class="trail">{component.w}×{component.h}</span>
              </button>
              <button
                class="btn sm danger"
                aria-label={`delete ${component.name}`}
                title="Delete from the library"
                onclick={() => removeComponent(component)}
              >×</button>
            </li>
          {/each}
          {#if library.length === 0}
            <li class="hint">Nothing saved yet — tick some layers below, name them, and save.</li>
          {/if}
        </ul>
        <div class="row2">
          <input placeholder="component name" bind:value={componentName} />
          <button class="btn sm" onclick={saveSelectionAsComponent}>Save ✓</button>
        </div>
        <button class="btn block sm" onclick={() => fileInput?.click()}>Import PNG…</button>
        <input class="hidden" type="file" accept="image/png" bind:this={fileInput} onchange={importSpritePng} />
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">Layers</span>
          <span class="count">{project.elements.length}</span>
        </div>
        <ul class="list">
          {#each project.elements as element}
            <li class="layer-row">
              <input type="checkbox" checked={checked.has(element.id)} onchange={() => toggleChecked(element.id)} />
              <button class="row-btn" class:active={selectedId === element.id} onclick={() => (selectedId = element.id)}>
                <span class="truncate">
                  {element.kind === "tiles" ? `${element.tileKind} ×${element.cells?.length ?? 0}` : element.kind}{element.label ? ` “${element.label}”` : ""}
                </span>
                <span class="trail">{element.x},{element.y}</span>
              </button>
            </li>
          {/each}
          {#if project.elements.length === 0}
            <li class="hint">Pick button or infobox, then tap the grid — each tap grows the piece.</li>
          {/if}
        </ul>
        {#if project.elements.length > 0}
          <p class="hint">A ticked layer joins the next saved component.</p>
        {/if}
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">Hotspots</span>
          <span class="count">{project.hotspots.length}</span>
        </div>
        <ul class="list">
          {#each project.hotspots as hotspot}
            <li class="hotspot-row">
              <button
                class="row-btn"
                class:active={activeHotspot === hotspot.id}
                onclick={() => { activeHotspot = hotspot.id; tool = "hotspot"; }}
              >
                <span class="truncate">
                  <span class="swatch" style:background={ROLE_COLOURS[hotspot.role] ?? "#aaa"}></span>
                  {hotspot.id}
                </span>
                <span class="trail">{hotspot.slots.length}</span>
              </button>
              <select bind:value={hotspot.role} onchange={touch}>
                {#each Object.keys(ROLE_COLOURS) as role}<option>{role}</option>{/each}
              </select>
            </li>
          {/each}
        </ul>
        <button class="btn block sm" onclick={addHotspot}>+ Hotspot group</button>
      </section>
    </aside>

    <section class="stage">
      <canvas
        bind:this={canvas}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
      ></canvas>
    </section>

    <aside class="pane right">
      {#if selected}
        <section class="card">
          <div class="card-head">
            <span class="label-mono">Selected</span>
            <span class="chip">{selected.kind === "tiles" ? selected.tileKind + " tiles" : selected.kind}</span>
          </div>

          {#if selected.kind !== "tiles"}
            <div class="grid2">
              <label class="field"><span>x</span><input type="number" bind:value={selected.x} onchange={touch} /></label>
              <label class="field"><span>y</span><input type="number" bind:value={selected.y} onchange={touch} /></label>
              <label class="field"><span>w</span><input type="number" min="2" bind:value={selected.w} onchange={touch} /></label>
              <label class="field"><span>h</span><input type="number" min="2" bind:value={selected.h} onchange={touch} /></label>
            </div>
          {:else}
            <p class="hint">Tap cells with the {selected.tileKind} tool to grow or shrink this piece.</p>
          {/if}

          {#if selected.kind === "button" || selected.kind === "text" || selected.kind === "panel" || (selected.kind === "tiles" && selected.tileKind === "button")}
            <label class="field top">
              <span>label</span>
              <input value={selected.label ?? ""} oninput={(event) => { selected!.label = (event.target as HTMLInputElement).value; retextSize(selected!); touch(); }} />
            </label>
          {/if}

          {#if selected.kind === "infobox" || (selected.kind === "tiles" && selected.tileKind === "infobox")}
            <div class="card-head top">
              <span class="label-mono">Lines</span>
              <span class="hint">one colour each</span>
            </div>
            {#each selected.lines ?? [] as line, index}
              <div class="line-row">
                <input value={line} oninput={(event) => setLine(index, (event.target as HTMLInputElement).value)} />
                <input
                  type="color"
                  value={selected.lineColors?.[index] ?? selected.textColor ?? "#E6E2DA"}
                  oninput={(event) => setLineColor(index, (event.target as HTMLInputElement).value.toUpperCase())}
                />
                <button class="btn sm danger" onclick={() => removeLine(index)} aria-label="remove line">×</button>
              </div>
            {/each}
            <div class="row2">
              <button class="btn sm" onclick={addLine}>+ line</button>
              <label class="field"><span>gap</span>
                <select value={selected.lineGap ?? 2} onchange={(event) => { selected!.lineGap = Number((event.target as HTMLSelectElement).value) as 2 | 3 | 4; touch(); }}>
                  <option value={2}>2px</option>
                  <option value={3}>3px</option>
                  <option value={4}>4px</option>
                </select>
              </label>
              <label class="field"><span>size</span>
                <select value={selected.textScale ?? 2} onchange={(event) => { selected!.textScale = Number((event.target as HTMLSelectElement).value) as 1 | 2; touch(); }}>
                  <option value={1}>1×</option>
                  <option value={2}>2× (standard)</option>
                </select>
              </label>
            </div>
          {/if}

          {#if hasText}
            <div class="grid2 top">
              <label class="field"><span>font</span>
                <select value={selected.font ?? "minecraft"} onchange={(event) => { selected!.font = (event.target as HTMLSelectElement).value as "minecraft" | "mono5"; retextSize(selected!); touch(); }}>
                  <option value="minecraft">minecraft</option>
                  <option value="mono5">mono 5×5</option>
                </select>
              </label>
              <label class="field"><span>shadow</span>
                <select value={selected.shadow ?? "none"} onchange={(event) => { selected!.shadow = (event.target as HTMLSelectElement).value as ShadowDir; touch(); }}>
                  {#each SHADOW_DIRS as dir}<option value={dir}>{dir}</option>{/each}
                </select>
              </label>
            </div>
          {/if}

          <div class="grid2 top">
            {#if !["text", "sprite", "slot"].includes(selected.kind) && !(selected.kind === "tiles" && selected.tileKind === "infobox") && selected.kind !== "infobox"}
              <label class="field"><span>fill</span><input type="color" value={selected.color ?? "#C6C6C6"} oninput={(event) => { selected!.color = (event.target as HTMLInputElement).value.toUpperCase(); touch(); }} /></label>
            {/if}
            {#if hasText}
              <label class="field"><span>text</span><input type="color" value={selected.textColor ?? "#FFFFFF"} oninput={(event) => { selected!.textColor = (event.target as HTMLInputElement).value.toUpperCase(); touch(); }} /></label>
            {/if}
          </div>

          {#if selected.kind === "button" || (selected.kind === "tiles" && selected.tileKind === "button")}
            <label class="check"><input type="checkbox" bind:checked={selected.pressed} onchange={touch} /> pressed</label>
          {/if}

          <div class="nudge">
            {#if selected.kind !== "tiles"}
              <div class="pad">
                <button class="btn sm" onclick={() => nudge(0, -1)} aria-label="up">▲</button>
                <div class="pad-row">
                  <button class="btn sm" onclick={() => nudge(-1, 0)} aria-label="left">◀</button>
                  <button class="btn sm" onclick={() => nudge(1, 0)} aria-label="right">▶</button>
                </div>
                <button class="btn sm" onclick={() => nudge(0, 1)} aria-label="down">▼</button>
              </div>
            {/if}
            <button class="btn sm danger" onclick={removeSelected}>Delete</button>
          </div>
        </section>
      {:else}
        <div class="empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M4 4h7v7H4zM13 13h7v7h-7z" />
            <path d="M13 4h7v7h-7z" opacity="0.4" />
          </svg>
          <p>Nothing selected. Pick a tool and tap the grid, or tap a layer.</p>
        </div>
      {/if}

      <section class="card">
        <div class="card-head"><span class="label-mono">Screen</span></div>
        <div class="grid2">
          <label class="field"><span>rows</span><input type="number" min="1" max="6" bind:value={project.rows} /></label>
          <label class="field"><span>shift</span><input type="number" bind:value={project.shift} /></label>
          <label class="field"><span>ascent</span><input type="number" bind:value={project.ascent} /></label>
          <label class="field"><span>zoom</span><input type="number" min="1" max="8" bind:value={zoom} /></label>
        </div>
        <label class="field top"><span>codepoint</span><input bind:value={project.codepoint} /></label>
        <label class="field top"><span>fallback title</span><input bind:value={project.fallbackTitle} /></label>
        <label class="check"><input type="checkbox" bind:checked={guides} /> guides</label>
        <label class="check"><input type="checkbox" bind:checked={project.bakeWindow} /> bake window into the sheet</label>
        <p class="hint">
          Erase tool: tap any part of the window — a slot, the top band, a margin — and it
          becomes a transparent hole; the contour redraws around it. Tap again to restore.
          Holes: <b>{project.holes?.length ?? 0}</b>.
        </p>
      </section>

      <section class="card">
        <div class="card-head"><span class="label-mono">Measured</span></div>
        <dl class="kv">
          <div><dt>Advance</dt><dd>{baked.advance}</dd></div>
          <div>
            <dt>Strays</dt>
            <dd>
              {#if baked.straysRemoved > 0}
                <span class="badge warn">{baked.straysRemoved} stripped</span>
              {:else}
                <span class="badge ok">none</span>
              {/if}
            </dd>
          </div>
        </dl>
        {#if !fonts.minecraft}
          <p class="hint bad">Pack font not loaded — the minecraft face falls back to mono.</p>
        {/if}
        {#if !infoboxSkin}
          <p class="hint bad">No infobox skin in the profile — using the procedural stand-in.</p>
        {/if}
      </section>

      <section class="card">
        <div class="card-head"><span class="label-mono">Copy out</span></div>
        <div class="stack">
          <button class="btn block" onclick={() => copy(visualsYmlBlock(screenConfig), "visuals yml")}>Visuals yml</button>
          <button class="btn block" onclick={() => copy(configYmlBlock(`${project.module}.gui`, screenConfig), "config yml")}>Config yml</button>
          <button class="btn block" onclick={() => {
            const files = scaffoldFiles(scaffoldInput());
            const text = Object.entries(files).map(([path, body]) => `// ==== ${path}\n${body}`).join("\n");
            copy(text + "\n" + advanceTable(scaffoldInput()), "Java scaffold");
          }}>Java scaffold</button>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">Push</span>
          <span class="badge info nodot">dev</span>
        </div>
        <label class="field"><span>pack path</span><input bind:value={deployPath} placeholder="…/.slotify-staging/pack" /></label>
        <div class="grid2 top">
          <label class="field"><span>host</span><input bind:value={rconHost} /></label>
          <label class="field"><span>port</span><input type="number" bind:value={rconPort} /></label>
        </div>
        <label class="field top"><span>password</span><input type="password" bind:value={rconPassword} /></label>
        <div class="stack top">
          <button class="btn block" onclick={writeDeployFiles}>Write files</button>
          <button class="btn block" onclick={runReload} disabled={!rconHost || !rconPassword}>nexo reload pack</button>
        </div>
      </section>

      {#if statusLine}
        <p class="status">{statusLine}</p>
      {/if}
    </aside>
  </div>
</div>

<style>
  /*
   * Touch-first: a drag on the canvas moves an element, it never scrolls the pane. Only
   * the editor claims the gesture — the viewer's stage still pans with a finger.
   */
  .stage,
  .stage canvas {
    touch-action: none;
  }

  /* The screen's identity in the top bar, where a document title belongs. */
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

  .chips {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  /* Nine tools, wrapped: a pill row would scroll and hide half of them. */
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .tool {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-soft);
    padding: 0.28rem 0.55rem;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.12s,
      border-color 0.12s,
      color 0.12s;
  }

  .tool:hover {
    border-color: var(--line-strong);
    background: var(--canvas);
    color: var(--ink);
  }

  .tool.active {
    border-color: transparent;
    background: var(--primary);
    color: #fff;
    box-shadow: var(--shadow-red);
  }

  .truncate {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layer-row,
  .hotspot-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .layer-row .row-btn,
  .hotspot-row .row-btn {
    flex: 1;
    min-width: 0;
  }

  .hotspot-row select {
    flex: 0 0 5.5rem;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex: 0 0 auto;
  }

  .hidden {
    display: none;
  }

  .row2 {
    display: flex;
    align-items: end;
    gap: 0.3rem;
    margin: 0.4rem 0 0.3rem;
  }

  .row2 > input,
  .row2 > label {
    flex: 1;
    min-width: 0;
  }

  .line-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .line-row input[type="color"] {
    flex: 0 0 34px;
  }

  .top {
    margin-top: 0.45rem;
  }

  /* One pixel at a time, with a target big enough for a finger. */
  .nudge {
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    margin-top: 0.6rem;
  }

  .pad {
    display: grid;
    justify-items: center;
    gap: 0.2rem;
  }

  .pad-row {
    display: flex;
    gap: 1.4rem;
  }

  .pad .btn {
    width: 42px;
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

  @media (max-width: 1180px) {
    .chips {
      display: none;
    }
  }
</style>
