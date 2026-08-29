<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { align, boundingBox, distribute, type AlignMode, type Axis } from "../engine/align";
  import { regionKeyAt, regionRect } from "../engine/carve";
  import { renderScreen } from "../engine/chestRenderer";
  import {
    componentFromElements,
    instantiate,
    slugify,
    type LibraryComponent,
  } from "../engine/components";
  import { buildDeployPlan } from "../engine/deploy";
  import { CELL, COLS, GRID_X, GRID_Y, WINDOW_W, hotbarY, playerInvY, slotIndex, slotWindowRect, windowHeight } from "../engine/geometry";
  import { commit, createStack, redo, undo } from "../engine/history";
  import { scaffoldFiles, advanceTable, type ScaffoldInput } from "../engine/javaScaffold";
  import {
    contrastRatio,
    extractPalette,
    freeSwatchId,
    resolveColour,
    toHex,
    type Swatch,
  } from "../engine/palette";
  import { hueShiftedBevels } from "../engine/paint";
  import { encodePng } from "../engine/png";
  import {
    serializeProject,
    type Element,
    type Hotspot,
    type Overlay,
    type Project,
  } from "../engine/project";
  import {
    bakeScreen,
    drawnSheet,
    freeOverlayId,
    overlayConstant,
  } from "../engine/overlay";
  import type { PlateStyle } from "../engine/paint";
  import type { Raster } from "../engine/raster";
  import { bakeSheet, type RenderContext } from "../engine/renderProject";
  import { snapToEdges } from "../engine/snap";
  import { spliceProviders } from "../engine/spliceGuiJson";
  import { measureText, type BitmapFont, type ShadowDir } from "../engine/textFont";
  import { cellAt, cellsCovering, regionBBox, type TileCell } from "../engine/tiles";
  import { formatCodepoint, parseCodepoint } from "../engine/unicode";
  import { visualsYmlBlock, configYmlBlock } from "../engine/visualsYml";
  import { joinPath, type FsBackend } from "../platform/fs";
  import { pickFile } from "../platform/pick";
  import { rconExec } from "../platform/rcon";
  import ColorField from "./ColorField.svelte";
  import { decodeTexture, deleteComponent, listComponents, loadSpriteRaster, saveComponent } from "./model";

  // The canvas margin grows with the space above the window (ascent − 13), so a GUI
  // pushed down to make room for a title panel keeps that room visible and tappable.
  const PAD = $derived(Math.max(32, (project?.ascent ?? 13) - 13 + 16));
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
    packPalette,
    suggestCodepoint,
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
    /** The pack's named colours, from the profile. The project's own come first. */
    packPalette: Swatch[];
    /** A codepoint nothing in the pack claims — the registry knows, this editor does not. */
    suggestCodepoint: () => string;
    onExit: () => void;
  } = $props();

  type Tool =
    | "select"
    | "button"
    | "plate"
    | "infobox"
    | "slot"
    | "erase"
    | "cover"
    | "text"
    | "panel"
    | "well"
    | "hotspot";
  /** Also the digit shortcuts, in this order: 1 selects, 2 draws a button, and so on. */
  const TOOLS: Tool[] = [
    "select", "button", "plate", "infobox", "slot", "erase", "cover", "text", "panel", "well",
    "hotspot",
  ];
  let tool: Tool = $state("select");

  /*
   * Which layer the editor is writing to: the base screen, or one of its states.
   *
   * A state is a second sheet drawn over the first, so the whole editor has to point at
   * one array of elements or another. Everything below reads `elements` and writes
   * `setElements`; nothing touches `project.elements` directly any more, and that single
   * indirection is what makes a state cost one sheet instead of a whole second screen.
   */
  let activeLayer: string | null = $state(null);
  const layer = $derived(
    activeLayer == null
      ? null
      : ((project.overlays ?? []).find((overlay) => overlay.id === activeLayer) ?? null),
  );
  const elements = $derived(layer ? layer.elements : project.elements);
  const hotspots = $derived(layer ? layer.hotspots : project.hotspots);

  function setElements(next: Element[]): void {
    if (layer) {
      layer.elements = next;
      touch();
      return;
    }
    project = { ...project, elements: next };
  }

  function setHotspots(next: Hotspot[]): void {
    if (layer) {
      layer.hotspots = next;
      touch();
      return;
    }
    project = { ...project, hotspots: next };
  }

  /** States shown behind or over what is being edited. The active one always shows. */
  let previewLayers = $state(new Set<string>());
  const shownOverlayIds = $derived(
    new Set([...previewLayers, ...(activeLayer ? [activeLayer] : [])]),
  );
  let selectedId: string | null = $state(null);
  let checked = $state(new Set<string>());
  let activeHotspot: string | null = $state(hotspots[0]?.id ?? null);
  let zoom = $state(2);
  let guides = $state(true);
  let statusLine = $state("");

  let canvas: HTMLCanvasElement | undefined = $state();
  let nextIdCounter = $state(1);

  /** The eight corners and edges of the selection box, as a drag can grab them. */
  type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
  const RESIZABLE = ["button", "panel", "well", "infobox"];
  const PLATE_STYLES: PlateStyle[] = ["single", "double", "flat"];
  /** Cell multiples, then the whole window: the widths a real screen actually uses. */
  const WIDTH_PRESETS = [18, 36, 54, 90, WINDOW_W];
  const HEIGHT_PRESETS = [12, 16, 18, 36];
  type DragState =
    | {
        kind: "move";
        ids: string[];
        startX: number;
        startY: number;
        origins: Map<string, { x: number; y: number }>;
      }
    | { kind: "resize"; id: string; handle: Handle; x: number; y: number; w: number; h: number };
  let drag: DragState | null = null;

  /** Where the pointer is over the artwork, in window pixels — shown in the top bar. */
  let cursor: { x: number; y: number } | null = $state(null);
  let showSlotNumbers = $state(false);
  let clipboard: Element[] = [];

  /**
   * The composed screen as last drawn, kept so the eyedropper reads the artwork and not
   * the chrome painted over it — a pick on a selected element must not return red.
   */
  /** The plate being dragged out right now, so a click without a drag still lands. */
  let creating: string | null = null;
  let composed: Raster | null = null;
  let eyedropper: ((hex: string) => void) | null = $state(null);

  let library: LibraryComponent[] = $state([]);
  let pendingComponent: LibraryComponent | null = $state(null);
  let spriteRasters = $state(new Map<string, Raster>());
  let componentName = $state("");

  /**
   * The onion skin: an imported PNG drawn over the artwork at a chosen opacity, so a
   * screen can be matched against a mockup or against the screenshot it replaces. It
   * lives only in this session — the project never carries it and the sheet never bakes
   * it.
   */
  let reference: Raster | null = $state(null);
  let referenceName = $state("");
  let referenceOpacity = $state(45);
  let referenceX = $state(0);
  let referenceY = $state(0);

  let deployPath = $state("");
  let rconHost = $state("");
  let rconPort = $state(25575);
  let rconPassword = $state("");

  /**
   * The unsaved draft. Everything the history records also lands in localStorage, so
   * closing the window between two saves costs the session and not the work. The
   * password is never part of it, and neither is anything outside the project.
   */
  const draftKey = $derived(`slotify.draft.${project.module}-${project.screenKey}`);
  let recoverable: Project | null = $state(null);
  let draftChecked = false;
  /** Where the project was last written, to notice a rename leaving an orphan behind. */
  let lastSavedPath: string | null = null;

  $effect(() => {
    const key = draftKey;
    if (draftChecked) return;
    draftChecked = true;
    try {
      const text = localStorage.getItem(key);
      if (text && text !== JSON.stringify(project)) recoverable = JSON.parse(text) as Project;
    } catch {
      // no storage, no draft — the editor works the same either way
    }
    try {
      const rcon = JSON.parse(localStorage.getItem("slotify.rcon") ?? "{}") as {
        host?: string;
        port?: number;
        deployPath?: string;
      };
      rconHost = rcon.host ?? "";
      rconPort = rcon.port ?? 25575;
      deployPath = rcon.deployPath ?? "";
    } catch {
      // same
    }
  });

  function rememberDeployTarget(): void {
    try {
      localStorage.setItem(
        "slotify.rcon",
        JSON.stringify({ host: rconHost, port: rconPort, deployPath }),
      );
    } catch {
      // the password is deliberately not in here, and nor is anything else
    }
  }

  const palette = $derived([...(project.palette ?? []), ...packPalette]);
  const context = $derived<RenderContext>({
    fonts,
    sprites: spriteRasters,
    infoboxSkin,
    panelSkin,
    palette: packPalette,
  });
  const screenBake = $derived(bakeScreen(project, background, context));
  /** The sheet the top bar measures and the export writes: whichever layer is active. */
  const baked = $derived(
    layer
      ? (screenBake.overlays.find((entry) => entry.overlay.id === layer.id)?.bake ?? screenBake.base)
      : screenBake.base,
  );
  const selected = $derived(elements.find((element) => element.id === selectedId) ?? null);
  const fillHex = $derived(resolveColour(selected?.color, palette, "#C6C6C6") ?? "#C6C6C6");
  const textHex = $derived(resolveColour(selected?.textColor, palette, "#FFFFFF") ?? "#FFFFFF");
  const bevelPreview = $derived(hueShiftedBevels(rgbaOf(fillHex)));
  const textContrast = $derived(contrastRatio(textHex, fillHex));

  function rgbaOf(hex: string): [number, number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
  }

  const rgbaCss = (colour: readonly number[]): string =>
    `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;

  const hasText = $derived(
    selected != null && ["button", "text", "infobox", "tiles", "panel"].includes(selected.kind),
  );

  function nextId(): string {
    return `e${nextIdCounter++}`;
  }

  function touch(): void {
    project = { ...project };
  }

  /*
   * Undo, without a hook on every mutation.
   *
   * Half the edits in here never pass through a function: `bind:value` on the x field
   * writes `selected.x` and nobody is told. So instead of recording commands, an effect
   * watches the serialised project and records a snapshot once it has settled. The delay
   * is what turns a drag of forty pointermoves, or a typed label, into one undo step.
   *
   * The stack is deliberately a plain object, not `$state`: reading it inside the effect
   * would make the effect depend on it and record its own writes forever.
   */
  const HISTORY_SETTLE_MS = 320;
  let historyStack = createStack(JSON.stringify(project));
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Mirrors of the stack's depths — the stack itself is not reactive on purpose. */
  let undoDepth = $state(0);
  let redoDepth = $state(0);

  function syncHistory(): void {
    undoDepth = historyStack.past.length;
    redoDepth = historyStack.future.length;
  }

  $effect(() => {
    const text = JSON.stringify(project);
    if (text === historyStack.present) return;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(flushHistory, HISTORY_SETTLE_MS);
  });

  $effect(() => () => {
    if (historyTimer) clearTimeout(historyTimer);
  });

  /**
   * The keyboard. Everything is ignored while a field has the focus — in a text box
   * ctrl+Z belongs to the box, and the arrows belong to the caret.
   */
  $effect(() => {
    const inField = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

    const onKey = (event: KeyboardEvent): void => {
      if (inField(event.target)) return;
      const step = event.shiftKey ? CELL : 1;

      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case "z":
            event.preventDefault();
            if (event.shiftKey) redoStep();
            else undoStep();
            return;
          case "y":
            event.preventDefault();
            redoStep();
            return;
          case "s":
            event.preventDefault();
            void saveProject();
            return;
          case "d":
            event.preventDefault();
            duplicateSelection();
            return;
          case "c":
            event.preventDefault();
            void copySelection();
            return;
          case "v":
            event.preventDefault();
            void pasteClipboard();
            return;
          case "a":
            event.preventDefault();
            checked = new Set(elements.map((element) => element.id));
            statusLine = `${checked.size} layer(s) ticked`;
            return;
          default:
            return;
        }
      }

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          nudge(-step, 0);
          return;
        case "ArrowRight":
          event.preventDefault();
          nudge(step, 0);
          return;
        case "ArrowUp":
          event.preventDefault();
          nudge(0, -step);
          return;
        case "ArrowDown":
          event.preventDefault();
          nudge(0, step);
          return;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          removeSelected();
          return;
        case "Escape":
          tool = "select";
          pendingComponent = null;
          selectedId = null;
          checked = new Set();
          return;
        case "+":
        case "=":
          zoom = Math.min(8, zoom + 1);
          return;
        case "-":
          zoom = Math.max(1, zoom - 1);
          return;
        case "g":
          guides = !guides;
          return;
        case "n":
          showSlotNumbers = !showSlotNumbers;
          return;
      }

      // 1..9 then 0 pick a tool, in the order the palette shows them.
      if (/^[0-9]$/.test(event.key)) {
        const index = event.key === "0" ? 9 : Number(event.key) - 1;
        const picked = TOOLS[index];
        if (picked) {
          tool = picked;
          pendingComponent = null;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Wheel zoom, kept off the passive path so the page underneath does not scroll. */
  $effect(() => {
    const element = canvas;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoom = Math.min(8, Math.max(1, zoom + (event.deltaY < 0 ? 1 : -1)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  /** Records whatever is pending right now — before an undo, and before leaving. */
  function flushHistory(): void {
    if (historyTimer) {
      clearTimeout(historyTimer);
      historyTimer = null;
    }
    if (commit(historyStack, JSON.stringify(project))) {
      syncHistory();
      try {
        localStorage.setItem(draftKey, historyStack.present);
      } catch {
        // a session without storage simply has no safety net
      }
    }
  }

  function discardDraft(): void {
    recoverable = null;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // nothing to remove
    }
  }

  function restoreDraft(): void {
    if (!recoverable) return;
    flushHistory();
    applySnapshot(JSON.stringify(recoverable));
    recoverable = null;
    statusLine = "draft restored - the file on disk is untouched until you save";
  }

  function applySnapshot(text: string): void {
    project = JSON.parse(text) as Project;
    if (selectedId && !elements.some((element) => element.id === selectedId)) selectedId = null;
    checked = new Set([...checked].filter((id) => elements.some((element) => element.id === id)));
    syncHistory();
    void ensureSprites(elements);
  }

  function undoStep(): void {
    flushHistory();
    const previous = undo(historyStack);
    if (previous === null) {
      statusLine = "nothing left to undo";
      return;
    }
    applySnapshot(previous);
    statusLine = `undone - ${historyStack.past.length} step(s) further back`;
  }

  function redoStep(): void {
    const next = redo(historyStack);
    if (next === null) {
      statusLine = "nothing to redo";
      return;
    }
    applySnapshot(next);
    statusLine = `redone - ${historyStack.future.length} step(s) further forward`;
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
    // Element ids are handed out per project, not per layer: a layer copied into a
    // state must not arrive carrying an id the base already answers to.
    const everyElement = [
      ...project.elements,
      ...(project.overlays ?? []).flatMap((overlay) => overlay.elements),
    ];
    void ensureSprites(everyElement);
    const used = everyElement
      .map((element) => Number(/^e(\d+)$/.exec(element.id)?.[1] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    if (used >= nextIdCounter) nextIdCounter = used + 1;
  });

  $effect(() => {
    if (!canvas) return;
    // The preview replays the title's real cursor arithmetic instead of assuming every
    // sheet lands on the base origin, so a wrong advance displaces a state here by
    // exactly what it would displace in game.
    const shown = screenBake.overlays
      .filter((entry) => shownOverlayIds.has(entry.overlay.id))
      .map((entry) => drawnSheet(entry.bake, entry.overlay.ascent ?? project.ascent));

    const raster = renderScreen({
      rows: project.rows,
      shift: project.shift,
      base: {
        codepoint: parseCodepoint(project.codepoint),
        advance: screenBake.base.advance,
        ascent: project.ascent,
        texture: screenBake.base.sheet,
      },
      overlays: shown,
      pad: PAD,
      // When the window is baked into the sheet, drawing it again underneath would
      // fill the carved holes back in — the checkerboard behind IS the transparency.
      bare: project.bakeWindow ?? false,
      hiddenContainerSlots: new Set(project.hiddenSlots ?? []),
      hiddenInvSlots: new Set(project.hiddenInvSlots ?? []),
      holes: new Set(project.holes ?? []),
    });

    composed = raster;

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
    if (reference && referenceOpacity > 0) drawReference(target);
    drawOverlays(target);
  });

  function drawReference(target: CanvasRenderingContext2D): void {
    const sheet = document.createElement("canvas");
    sheet.width = reference!.width;
    sheet.height = reference!.height;
    sheet.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(reference!.data), reference!.width, reference!.height), 0, 0,
    );
    target.save();
    target.globalAlpha = referenceOpacity / 100;
    target.imageSmoothingEnabled = false;
    target.drawImage(
      sheet,
      (PAD + referenceX) * zoom,
      (PAD + referenceY) * zoom,
      reference!.width * zoom,
      reference!.height * zoom,
    );
    target.restore();
  }

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

    for (const hotspot of hotspots) {
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

    if (tool === "cover") {
      const tint = (x: number, y: number) => {
        fill(x, y, 16, 16, "rgba(11,13,16,0.25)");
        stroke(x, y, 16, 16, "rgba(11,13,16,0.6)");
      };
      for (const slot of project.hiddenSlots ?? []) {
        const rect = slotWindowRect(Math.floor(slot / COLS), slot % COLS);
        tint(rect.x, rect.y);
      }
      for (const slot of project.hiddenInvSlots ?? []) {
        const y = slot >= 27 ? hotbarY(project.rows) : playerInvY(project.rows) + Math.floor(slot / COLS) * CELL;
        tint(GRID_X + (slot % COLS) * CELL, y);
      }
    }

    for (const id of checked) {
      const element = elements.find((candidate) => candidate.id === id);
      if (element) stroke(element.x - 1, element.y - 1, element.w + 2, element.h + 2, OVERLAY.staged);
    }

    if (showSlotNumbers) {
      target.font = "600 9px ui-monospace, monospace";
      target.textAlign = "center";
      target.textBaseline = "middle";
      for (let row = 0; row < project.rows; row++) {
        for (let col = 0; col < COLS; col++) {
          const rect = slotWindowRect(row, col);
          const label = String(slotIndex(row, col));
          const cx = (PAD + rect.x + rect.w / 2) * zoom;
          const cy = (PAD + rect.y + rect.h / 2) * zoom;
          target.fillStyle = "rgba(255,255,255,0.85)";
          target.fillText(label, cx + 1, cy + 1);
          target.fillStyle = "rgba(11,13,16,0.9)";
          target.fillText(label, cx, cy);
        }
      }
    }

    if (selected) {
      stroke(selected.x - 1, selected.y - 1, selected.w + 2, selected.h + 2, OVERLAY.selected, 2);
      if (isResizable(selected)) drawHandles(target, selected);
    }
  }

  /** The eight grips, drawn in screen pixels so they stay grabbable at zoom 1. */
  function drawHandles(target: CanvasRenderingContext2D, element: Element): void {
    const size = 7;
    for (const point of handlePoints(element)) {
      const cx = (PAD + point.x + 0.5) * zoom;
      const cy = (PAD + point.y + 0.5) * zoom;
      target.fillStyle = "#FFFFFF";
      target.fillRect(cx - size / 2, cy - size / 2, size, size);
      target.strokeStyle = OVERLAY.selected;
      target.lineWidth = 1;
      target.strokeRect(cx - size / 2 + 0.5, cy - size / 2 + 0.5, size - 1, size - 1);
    }
  }

  function windowPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = canvas!.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - bounds.left) / zoom) - PAD,
      y: Math.floor((event.clientY - bounds.top) / zoom) - PAD,
    };
  }

  /** Arms the eyedropper: the next tap on the canvas answers into this field. */
  function armEyedropper(apply: (hex: string) => void): void {
    eyedropper = apply;
    statusLine = "tap the artwork to pick a colour";
  }

  /** The colour of one pixel of the drawn screen, or null where it is transparent. */
  function pixelAt(x: number, y: number): string | null {
    if (!composed) return null;
    const px = x + PAD;
    const py = y + PAD;
    if (px < 0 || py < 0 || px >= composed.width || py >= composed.height) return null;
    const index = (py * composed.width + px) * 4;
    if (composed.data[index + 3]! < 8) return null;
    return toHex(composed.data[index]!, composed.data[index + 1]!, composed.data[index + 2]!);
  }

  function snapSlot(x: number, y: number): { x: number; y: number } {
    const col = Math.min(COLS - 1, Math.max(0, Math.round((x - GRID_X) / CELL)));
    const row = Math.min(project.rows - 1, Math.max(0, Math.round((y - GRID_Y) / CELL)));
    return { x: GRID_X + col * CELL, y: GRID_Y + row * CELL };
  }

  function hitElement(x: number, y: number): Element | null {
    for (let index = elements.length - 1; index >= 0; index--) {
      const element = elements[index]!;
      if (element.locked || element.hidden) continue;
      if (x >= element.x && x < element.x + element.w && y >= element.y && y < element.y + element.h) {
        return element;
      }
    }
    return null;
  }

  /** The eight grab points of a box, in window pixels. */
  function handlePoints(element: Element): { handle: Handle; x: number; y: number }[] {
    const midX = element.x + (element.w >> 1);
    const midY = element.y + (element.h >> 1);
    const right = element.x + element.w - 1;
    const bottom = element.y + element.h - 1;
    return [
      { handle: "nw", x: element.x, y: element.y },
      { handle: "n", x: midX, y: element.y },
      { handle: "ne", x: right, y: element.y },
      { handle: "e", x: right, y: midY },
      { handle: "se", x: right, y: bottom },
      { handle: "s", x: midX, y: bottom },
      { handle: "sw", x: element.x, y: bottom },
      { handle: "w", x: element.x, y: midY },
    ];
  }

  const isResizable = (element: Element | null): boolean =>
    element != null && RESIZABLE.includes(element.kind) && !element.locked;

  /** Which handle the pointer is on, with a target that stays finger-sized at any zoom. */
  function handleAt(element: Element, x: number, y: number): Handle | null {
    const tolerance = Math.max(2, Math.round(7 / zoom));
    for (const point of handlePoints(element)) {
      if (Math.abs(x - point.x) <= tolerance && Math.abs(y - point.y) <= tolerance) return point.handle;
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
        setElements(elements.filter((element) => element.id !== current.id));
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
    setElements([...elements, element]);
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

  /**
   * The gentler sibling of erase: the slot's well disappears but the panel grey stays —
   * as if no slot were ever drawn there. Container and viewer inventory alike.
   */
  function tapCover(point: { x: number; y: number }): void {
    const col = Math.floor((point.x - GRID_X) / CELL);
    if (col < 0 || col >= COLS) return;

    const containerRow = Math.floor((point.y - GRID_Y) / CELL);
    if (containerRow >= 0 && containerRow < project.rows) {
      const index = slotIndex(containerRow, col);
      const hidden = new Set(project.hiddenSlots ?? []);
      if (hidden.has(index)) hidden.delete(index);
      else hidden.add(index);
      project = { ...project, hiddenSlots: [...hidden].sort((a, b) => a - b) };
      return;
    }

    const invRow = Math.floor((point.y - playerInvY(project.rows)) / CELL);
    const isHotbar = Math.floor((point.y - hotbarY(project.rows)) / CELL) === 0;
    const invIndex = isHotbar ? 27 + col : invRow >= 0 && invRow < 3 ? invRow * COLS + col : null;
    if (invIndex === null) return;
    const hidden = new Set(project.hiddenInvSlots ?? []);
    if (hidden.has(invIndex)) hidden.delete(invIndex);
    else hidden.add(invIndex);
    project = { ...project, hiddenInvSlots: [...hidden].sort((a, b) => a - b) };
  }

  function onPointerDown(event: PointerEvent): void {
    const point = windowPoint(event);

    if (eyedropper) {
      const hex = pixelAt(point.x, point.y);
      if (hex) {
        eyedropper(hex);
        statusLine = `picked ${hex}`;
      } else {
        statusLine = "nothing but transparency there";
      }
      eyedropper = null;
      return;
    }

    if (pendingComponent) {
      const placed = instantiate(
        pendingComponent,
        point.x - (pendingComponent.w >> 1),
        point.y - (pendingComponent.h >> 1),
        nextId,
      );
      setElements([...elements, ...placed]);
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

    // The plate: a button at whatever size the drag gives it, off the 18px lattice
    // entirely. Released without moving, it takes the size a button usually wants.
    if (tool === "plate") {
      const element: Element = { id: nextId(), kind: "button", x: point.x, y: point.y, w: 2, h: 2 };
      setElements([...elements, element]);
      selectedId = element.id;
      creating = element.id;
      tool = "select";
      drag = { kind: "resize", id: element.id, handle: "se", x: point.x, y: point.y, w: 2, h: 2 };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
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
      setElements([...elements, element]);
      selectedId = element.id;
      tool = "select";
      return;
    }

    if (tool === "erase") {
      tapErase(point);
      return;
    }

    if (tool === "cover") {
      tapCover(point);
      return;
    }

    if (tool === "hotspot") {
      const col = Math.floor((point.x - GRID_X) / CELL);
      const row = Math.floor((point.y - GRID_Y) / CELL);
      if (col < 0 || col >= COLS || row < 0 || row >= project.rows || !activeHotspot) return;
      const index = slotIndex(row, col);
      const hotspot = hotspots.find((candidate) => candidate.id === activeHotspot);
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
      setElements([...elements, element]);
      selectedId = element.id;
      tool = "select";
      return;
    }

    // A handle on the current selection wins over whatever sits under the pointer:
    // otherwise the corner of a button lying on a panel could never be grabbed.
    if (isResizable(selected)) {
      const handle = handleAt(selected!, point.x, point.y);
      if (handle) {
        flushHistory();
        drag = {
          kind: "resize",
          id: selected!.id,
          handle,
          x: selected!.x,
          y: selected!.y,
          w: selected!.w,
          h: selected!.h,
        };
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
        return;
      }
    }

    const hit = hitElement(point.x, point.y);
    selectedId = hit?.id ?? null;
    if (hit && hit.kind !== "tiles") {
      // Dragging one of several ticked layers drags all of them: the tick list is the
      // multi-selection, the same one the align buttons and a saved component read.
      const ids =
        checked.has(hit.id) && checked.size > 1
          ? [...checked].filter((id) => {
              const element = elements.find((candidate) => candidate.id === id);
              return element != null && element.kind !== "tiles" && !element.locked;
            })
          : [hit.id];
      flushHistory();
      drag = {
        kind: "move",
        ids,
        startX: point.x,
        startY: point.y,
        origins: new Map(
          ids.map((id) => {
            const element = elements.find((candidate) => candidate.id === id)!;
            return [id, { x: element.x, y: element.y }];
          }),
        ),
      };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const point = windowPoint(event);
    cursor = point;
    if (!drag) return;

    if (drag.kind === "resize") {
      const element = elements.find((candidate) => candidate.id === drag!.id);
      if (!element) return;
      resizeTo(element, drag.handle, drag, point);
      touch();
      return;
    }

    const dragging = drag;
    const moved = dragging.ids
      .map((id) => elements.find((candidate) => candidate.id === id))
      .filter((element): element is Element => element != null);
    if (moved.length === 0) return;

    let dx = point.x - dragging.startX;
    let dy = point.y - dragging.startY;

    if (moved.length === 1) {
      const element = moved[0]!;
      const origin = dragging.origins.get(element.id)!;
      let x = origin.x + dx;
      let y = origin.y + dy;
      if (element.kind === "slot") {
        ({ x, y } = snapSlot(x + 8, y + 8));
      } else {
        const others = elements
          .filter((candidate) => candidate.id !== element.id)
          .map((candidate) => ({ x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h }));
        ({ x, y } = snapToEdges({ x, y, w: element.w, h: element.h }, others));
      }
      element.x = x;
      element.y = y;
      touch();
      return;
    }

    // A group snaps as one box, so the pieces keep the spacing they were given.
    const boxes = moved.map((element) => {
      const origin = dragging.origins.get(element.id)!;
      return { x: origin.x + dx, y: origin.y + dy, w: element.w, h: element.h };
    });
    const group = boundingBox(boxes);
    const others = elements
      .filter((candidate) => !dragging.ids.includes(candidate.id))
      .map((candidate) => ({ x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h }));
    const snapped = snapToEdges(group, others);
    dx += snapped.x - group.x;
    dy += snapped.y - group.y;

    for (const element of moved) {
      const origin = dragging.origins.get(element.id)!;
      element.x = origin.x + dx;
      element.y = origin.y + dy;
    }
    touch();
  }

  /** Drags one edge or corner; the opposite one stays put and nothing goes under 2px. */
  function resizeTo(
    element: Element,
    handle: Handle,
    start: { x: number; y: number; w: number; h: number },
    point: { x: number; y: number },
  ): void {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;

    if (handle.includes("w")) left = Math.min(point.x, right - 2);
    if (handle.includes("e")) right = Math.max(point.x + 1, left + 2);
    if (handle.includes("n")) top = Math.min(point.y, bottom - 2);
    if (handle.includes("s")) bottom = Math.max(point.y + 1, top + 2);

    element.x = left;
    element.y = top;
    element.w = right - left;
    element.h = bottom - top;
  }

  function onPointerUp(): void {
    if (creating) {
      const element = elements.find((candidate) => candidate.id === creating);
      if (element && element.w < 6 && element.h < 6) {
        element.w = 40;
        element.h = 18;
        touch();
      }
      creating = null;
    }
    if (drag) flushHistory();
    drag = null;
  }

  /**
   * What the commands act on: the ticked layers once there are two or more of them,
   * otherwise whatever is selected. One rule for nudging, deleting, duplicating,
   * aligning and dragging, so the tick boxes never mean two different things.
   */
  function selectionElements(): Element[] {
    const ids = checked.size > 1 ? [...checked] : selectedId ? [selectedId] : [];
    return ids
      .map((id) => elements.find((element) => element.id === id))
      .filter((element): element is Element => element != null);
  }

  /** Movable members of the selection: tiles live on the lattice, locks say no. */
  function movableSelection(): Element[] {
    return selectionElements().filter((element) => element.kind !== "tiles" && !element.locked);
  }

  function nudge(dx: number, dy: number): void {
    const targets = movableSelection();
    if (targets.length === 0) return;
    for (const element of targets) {
      element.x += dx;
      element.y += dy;
    }
    touch();
  }

  function removeSelected(): void {
    const ids = new Set(selectionElements().map((element) => element.id));
    if (ids.size === 0) return;
    setElements(elements.filter((element) => !ids.has(element.id)));
    selectedId = null;
    checked = new Set([...checked].filter((id) => !ids.has(id)));
    statusLine = `${ids.size} layer(s) deleted`;
  }

  /** A copy two pixels down and right — far enough to grab, near enough to place. */
  function duplicateSelection(): void {
    const originals = selectionElements();
    if (originals.length === 0) return;
    const copies = originals.map((element) => ({
      ...structuredClone($state.snapshot(element)),
      id: nextId(),
      x: element.x + 2,
      y: element.y + 2,
    })) as Element[];
    setElements([...elements, ...copies]);
    void ensureSprites(copies);
    selectedId = copies[0]!.id;
    checked = copies.length > 1 ? new Set(copies.map((element) => element.id)) : new Set();
    statusLine = `${copies.length} layer(s) duplicated`;
  }

  /** Adds a colour to the project's own palette and returns the reference to it. */
  function addSwatch(hex: string, name?: string): string {
    const id = freeSwatchId(name ?? hex.replace("#", "c"), palette);
    project = {
      ...project,
      palette: [...(project.palette ?? []), { id, name: name ?? hex, hex: hex.toUpperCase() }],
    };
    return `@${id}`;
  }

  function removeSwatch(id: string): void {
    project = { ...project, palette: (project.palette ?? []).filter((entry) => entry.id !== id) };
    statusLine = `@${id} removed - screens naming it fall back to the plain plate`;
  }

  /** Copies one of the pack's colours into the project so it can be edited here. */
  function adoptSwatch(entry: Swatch): void {
    if ((project.palette ?? []).some((candidate) => candidate.id === entry.id)) return;
    project = { ...project, palette: [...(project.palette ?? []), { ...entry }] };
  }

  /**
   * Lifts a palette off the picture underneath — the imported reference if there is one,
   * else the screen as drawn. Beats typing hexes out of an art brief.
   */
  function samplePalette(): void {
    const source = reference ?? composed;
    if (!source) {
      statusLine = "nothing to sample from";
      return;
    }
    const sampled = extractPalette(source, 8);
    const existing = project.palette ?? [];
    const fresh = sampled
      .filter((entry) => !existing.some((candidate) => candidate.hex === entry.hex))
      .map((entry) => ({ ...entry, id: freeSwatchId(entry.hex.replace("#", "c"), existing) }));
    project = { ...project, palette: [...existing, ...fresh] };
    statusLine = `${fresh.length} colour(s) sampled`;
  }

  const CLIPBOARD_KIND = "slotify/elements@1";

  /**
   * The clipboard is kept in this window and, best effort, in the system one as JSON —
   * which is what lets a row of buttons cross from one screen to another.
   */
  async function copySelection(): Promise<void> {
    const chosen = selectionElements();
    if (chosen.length === 0) return;
    clipboard = structuredClone($state.snapshot(chosen)) as Element[];
    try {
      await navigator.clipboard.writeText(JSON.stringify({ kind: CLIPBOARD_KIND, elements: clipboard }));
    } catch {
      // the in-window clipboard still holds it
    }
    statusLine = `${clipboard.length} layer(s) copied`;
  }

  async function pasteClipboard(): Promise<void> {
    let source = clipboard;
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text) as { kind?: string; elements?: Element[] };
      if (parsed.kind === CLIPBOARD_KIND && Array.isArray(parsed.elements)) source = parsed.elements;
    } catch {
      // not our JSON, or no permission — fall back to what this window copied
    }
    if (source.length === 0) {
      statusLine = "nothing to paste";
      return;
    }
    const copies = source.map((element) => ({
      ...structuredClone(element),
      id: nextId(),
      x: element.x + 4,
      y: element.y + 4,
    })) as Element[];
    setElements([...elements, ...copies]);
    void ensureSprites(copies);
    selectedId = copies[0]!.id;
    checked = copies.length > 1 ? new Set(copies.map((element) => element.id)) : new Set();
    statusLine = `${copies.length} layer(s) pasted`;
  }

  const windowBounds = $derived({ x: 0, y: 0, w: WINDOW_W, h: windowHeight(project.rows) });

  function alignSelection(mode: AlignMode): void {
    const targets = movableSelection();
    if (targets.length === 0) return;
    const placements = align(targets, mode, windowBounds);
    targets.forEach((element, index) => {
      element.x = placements[index]!.x;
      element.y = placements[index]!.y;
    });
    touch();
    statusLine = targets.length > 1 ? `${targets.length} layers aligned` : `aligned in the window`;
  }

  function distributeSelection(axis: Axis): void {
    const targets = movableSelection();
    if (targets.length < 3) {
      statusLine = "tick at least three layers to distribute them";
      return;
    }
    const placements = distribute(targets, axis);
    targets.forEach((element, index) => {
      element.x = placements[index]!.x;
      element.y = placements[index]!.y;
    });
    touch();
  }

  /** Everything takes the selected layer's width or height — or the first one ticked. */
  function matchSize(dimension: "w" | "h"): void {
    const targets = movableSelection().filter((element) => RESIZABLE.includes(element.kind));
    if (targets.length < 2) {
      statusLine = "tick two or more resizable layers first";
      return;
    }
    const reference = targets.find((element) => element.id === selectedId) ?? targets[0]!;
    for (const element of targets) element[dimension] = reference[dimension];
    touch();
  }

  /**
   * Layer order is draw order: earlier in the list is drawn first, so it ends up behind.
   */
  function moveLayer(id: string, delta: number): void {
    const index = elements.findIndex((element) => element.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= elements.length) return;
    const reordered = [...elements];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    setElements(reordered);
  }

  /**
   * Off the lattice: the tile region keeps its box and becomes a plate, free to be any
   * size. The label, colour and bevel come with it.
   */
  function toFreePlate(element: Element): void {
    if (element.kind !== "tiles" || element.tileKind !== "button") return;
    const box = regionBBox((element.cells ?? []) as TileCell[]);
    const replacement: Element = {
      ...structuredClone($state.snapshot(element)),
      kind: "button",
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    };
    delete replacement.cells;
    delete replacement.tileKind;
    setElements(elements.map((candidate) => (candidate.id === element.id ? replacement : candidate)));
    statusLine = "now a free plate - drag its handles to any size";
  }

  /** Back onto the lattice: the nearest whole cells the box covers. */
  function toTiles(element: Element): void {
    if (element.kind !== "button") return;
    const cells = cellsCovering(element);
    const box = regionBBox(cells);
    const replacement: Element = {
      ...structuredClone($state.snapshot(element)),
      kind: "tiles",
      tileKind: "button",
      cells,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    };
    setElements(elements.map((candidate) => (candidate.id === element.id ? replacement : candidate)));
    statusLine = `snapped onto ${cells.length} cell(s) of the lattice`;
  }

  function setSize(dimension: "w" | "h", value: number): void {
    if (!selected || selected.kind === "tiles") return;
    selected[dimension] = value;
    touch();
  }

  /**
   * A new state: its own codepoint, its own sheet, no elements. It draws over the base
   * and the base is not copied into it — which is the entire point.
   */
  /**
   * The registry knows what the pack has claimed; it does not know about the states this
   * project added since the last export. Two new states in a row would otherwise be
   * handed the same codepoint, and the second would silently win in game.
   */
  function freeCodepoint(): string {
    const taken = new Set(
      [project.codepoint, ...(project.overlays ?? []).map((overlay) => overlay.codepoint)].map(
        (value) => value.toUpperCase(),
      ),
    );
    let candidate = parseCodepoint(suggestCodepoint());
    while (taken.has(formatCodepoint(candidate))) candidate++;
    return formatCodepoint(candidate);
  }

  function addState(): void {
    const name = `State ${(project.overlays ?? []).length + 1}`;
    const id = freeOverlayId(name, project);
    const overlay: Overlay = {
      id,
      name,
      codepoint: freeCodepoint(),
      textureFile: `custom_ui/${project.module}/${project.screenKey}-${id}.png`,
      elements: [],
      hotspots: [],
    };
    project = { ...project, overlays: [...(project.overlays ?? []), overlay] };
    // Visible from the moment it exists, including from the base: a state you cannot
    // see while editing the thing underneath it is a state you will draw twice.
    previewLayers = new Set([...previewLayers, id]);
    selectLayer(id);
    statusLine = `state "${name}" added - it draws over the base and exports its own sheet`;
  }

  /** Copies a state's contents into a new one, for two states that differ in a detail. */
  function duplicateState(source: Overlay): void {
    const name = `${source.name} copy`;
    const id = freeOverlayId(name, project);
    const overlay: Overlay = {
      ...structuredClone($state.snapshot(source)),
      id,
      name,
      codepoint: freeCodepoint(),
      textureFile: `custom_ui/${project.module}/${project.screenKey}-${id}.png`,
      elements: structuredClone($state.snapshot(source.elements)).map((element) => ({
        ...element,
        id: nextId(),
      })),
    };
    project = { ...project, overlays: [...(project.overlays ?? []), overlay] };
    previewLayers = new Set([...previewLayers, id]);
    selectLayer(id);
  }

  function removeState(overlay: Overlay): void {
    if (!window.confirm(`Delete the state "${overlay.name}"? Its sheet stays in the pack.`)) return;
    project = {
      ...project,
      overlays: (project.overlays ?? []).filter((candidate) => candidate.id !== overlay.id),
    };
    if (activeLayer === overlay.id) selectLayer(null);
    statusLine = `state deleted - ${overlay.textureFile} is still on disk`;
  }

  /** Title order: each state backtracks by the advance of the sheet drawn before it. */
  function moveState(id: string, delta: number): void {
    const states = [...(project.overlays ?? [])];
    const index = states.findIndex((overlay) => overlay.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= states.length) return;
    const [moved] = states.splice(index, 1);
    states.splice(target, 0, moved!);
    project = { ...project, overlays: states };
  }

  function selectLayer(id: string | null): void {
    activeLayer = id;
    selectedId = null;
    checked = new Set();
    activeHotspot = null;
    if (tool === "hotspot") tool = "select";
  }

  function togglePreviewLayer(id: string): void {
    const next = new Set(previewLayers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    previewLayers = next;
  }

  function toggleFlag(element: Element, flag: "hidden" | "locked"): void {
    element[flag] = !element[flag];
    touch();
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
    const chosen = elements.filter((element) => ids.has(element.id));
    if (chosen.length === 0 || !componentName.trim()) {
      statusLine = "check some layers and give the component a name first";
      return;
    }
    const component = componentFromElements(slugify(componentName), componentName.trim(), chosen);
    await saveComponent(backend, packRoot, component);
    componentName = "";
    checked = new Set();
    await refreshLibrary();
    statusLine = `component "${component.name}" saved to the library`;
  }

  /**
   * Import a PNG as a library sprite. Every failure here used to be silent — a picker
   * that never opened, a write into a directory that did not exist — so each step now
   * says what went wrong on the status line.
   */
  async function importSpritePng(): Promise<void> {
    let picked: Awaited<ReturnType<typeof pickFile>>;
    try {
      picked = await pickFile();
    } catch (error) {
      statusLine = `could not open the file picker: ${error}`;
      return;
    }
    if (!picked) return;

    let raster: Raster;
    try {
      raster = decodeTexture(picked.bytes);
    } catch (error) {
      statusLine = `${picked.name} is not a PNG this tool can read: ${error}`;
      return;
    }

    const name = picked.name.replace(/\.png$/i, "");
    const component: LibraryComponent = {
      version: 1,
      id: slugify(name),
      name,
      kind: "sprite",
      w: raster.width,
      h: raster.height,
    };
    try {
      await saveComponent(backend, packRoot, component, picked.bytes);
    } catch (error) {
      statusLine = `could not write the sprite into the library: ${error}`;
      return;
    }
    spriteRasters = new Map(spriteRasters).set(component.id, raster);
    await refreshLibrary();
    statusLine = `sprite "${name}" imported (${raster.width}x${raster.height}) — tap the canvas to place it`;
    pendingComponent = component;
  }

  /**
   * Import a PNG as a reference sheet drawn under everything — the screen you are
   * copying, or a mockup painted elsewhere. It is never exported; it only helps you aim.
   */
  async function importReference(): Promise<void> {
    const picked = await pickFile().catch((error) => {
      statusLine = `could not open the file picker: ${error}`;
      return null;
    });
    if (!picked) return;
    try {
      reference = decodeTexture(picked.bytes);
      referenceName = picked.name;
      statusLine = `reference "${picked.name}" loaded — it guides the eye, it never exports`;
    } catch (error) {
      statusLine = `${picked.name} is not a PNG this tool can read: ${error}`;
    }
  }

  function addHotspot(): void {
    const id = `group${hotspots.length + 1}`;
    setHotspots([...hotspots, { id, role: "action", slots: [] }]);
    activeHotspot = id;
    tool = "hotspot";
  }

  async function saveProject(): Promise<void> {
    const path = joinPath(packRoot, "tools/slotify/projects", `${project.module}-${project.screenKey}.guiproj.json`);
    await backend.write(path, new TextEncoder().encode(serializeProject(project)));

    // The file name is derived from module and screenKey, so renaming either writes a
    // new file and leaves the old one sitting there. Say so rather than let it rot.
    const orphaned = lastSavedPath != null && lastSavedPath !== path ? lastSavedPath : null;
    lastSavedPath = path;
    discardDraft();
    statusLine = orphaned ? `saved ${path} - ${orphaned} is now stale` : `saved ${path}`;
  }

  /** How many pixels two sheets disagree on, or -1 when they are not the same size. */
  function pixelsChanged(before: Raster, after: Raster): number {
    if (before.width !== after.width || before.height !== after.height) return -1;
    let changed = 0;
    for (let index = 0; index < after.data.length; index += 4) {
      if (
        before.data[index] !== after.data[index] ||
        before.data[index + 1] !== after.data[index + 1] ||
        before.data[index + 2] !== after.data[index + 2] ||
        before.data[index + 3] !== after.data[index + 3]
      ) {
        changed++;
      }
    }
    return changed;
  }

  /** The screen as drawn, written out for an art brief. Never part of the pack. */
  async function savePreviewPng(): Promise<void> {
    if (!composed) return;
    const path = joinPath(packRoot, "tools/slotify/previews", `${project.module}-${project.screenKey}.png`);
    await backend.write(path, encodePng(composed));
    statusLine = `preview written to ${path}`;
  }

  /**
   * Writes every sheet this screen owns — the base and one per state — and splices all
   * their providers into `gui.json` in one pass. The whole screen goes out together
   * because a state exported without its base, or a base without the state that was
   * edited beside it, is a pack that disagrees with itself.
   */
  async function exportToPack(): Promise<void> {
    const sheets = [
      { name: "base", file: project.textureFile, bake: screenBake.base },
      ...screenBake.overlays.map((entry) => ({
        name: entry.overlay.id,
        file: entry.overlay.textureFile,
        bake: entry.bake,
      })),
    ];

    const notes: string[] = [];
    for (const sheet of sheets) {
      const texturePath = joinPath(
        packRoot, "pack-source", project.module, "assets/minecraft/textures", sheet.file,
      );

      // What is about to be overwritten, kept and counted. The splice into gui.json is
      // proven byte-identical by a golden test; the texture never was, and this is a
      // one-way door onto somebody's art.
      let note = "new";
      try {
        const existing = await backend.read(texturePath);
        await backend.write(`${texturePath}.bak`, existing);
        const changed = pixelsChanged(decodeTexture(existing), sheet.bake.sheet);
        note = changed < 0 ? "resized" : `${changed}px changed`;
      } catch {
        // nothing there yet
      }
      await backend.write(texturePath, encodePng(sheet.bake.sheet));
      notes.push(`${sheet.name}: ${note}, advance ${sheet.bake.advance}`);
    }

    const guiJsonPath = joinPath(packRoot, fontPath);
    const raw = await backend.readText(guiJsonPath);
    const result = spliceProviders(raw, sheets.map((sheet) => sheet.bake.provider));
    if (result.added.length > 0 || result.corrected.length > 0) {
      await backend.write(`${guiJsonPath}.bak`, new TextEncoder().encode(raw));
      await backend.write(guiJsonPath, new TextEncoder().encode(result.text));
    }
    statusLine =
      `${sheets.length} sheet(s) written - ${notes.join("; ")}. gui.json: ` +
      `+${result.added.length} added, ${result.corrected.length} corrected, ` +
      `${result.skipped.length} already present.`;
  }

  function scaffoldInput(): ScaffoldInput {
    const className = project.screenKey.replace(/(^|[_-])(\w)/g, (_, __, letter: string) => letter.toUpperCase());
    return {
      packageName: `it.meridian.${project.module}.gui`,
      className,
      base: {
        constant: "MAIN",
        codepoint: parseCodepoint(project.codepoint),
        advance: screenBake.base.advance,
      },
      overlays: screenBake.overlays.map((entry) => ({
        constant: overlayConstant(entry.overlay.id),
        codepoint: parseCodepoint(entry.overlay.codepoint),
        advance: entry.bake.advance,
      })),
      // A state's slot groups are named after the state, so two states can both have a
      // "confirm" group without one quietly becoming the other.
      hotspots: [
        ...project.hotspots.map((hotspot) => ({
          constant: `${hotspot.id.replace(/\W/g, "_").toUpperCase()}_SLOTS`,
          slots: hotspot.slots,
        })),
        ...(project.overlays ?? []).flatMap((overlay) =>
          overlay.hotspots.map((hotspot) => ({
            constant: `${overlayConstant(overlay.id)}_${hotspot.id.replace(/\W/g, "_").toUpperCase()}_SLOTS`,
            slots: hotspot.slots,
          })),
        ),
      ],
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
    rememberDeployTarget();
    statusLine = `wrote ${plan.files.length} file(s) under ${deployPath}`;
  }

  async function runReload(): Promise<void> {
    try {
      statusLine = "rcon: running…";
      rememberDeployTarget();
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
      {#if cursor}<span class="chip">{cursor.x},{cursor.y}</span>{/if}
      {#if baked.straysRemoved > 0}
        <span class="badge warn">{baked.straysRemoved} strays stripped</span>
      {/if}
    </div>

    <button
      class="btn ghost"
      title="Undo (ctrl+Z)"
      disabled={undoDepth === 0}
      onclick={undoStep}
      aria-label="undo"
    >&#x21B6;</button>
    <button
      class="btn ghost"
      title="Redo (ctrl+shift+Z)"
      disabled={redoDepth === 0}
      onclick={redoStep}
      aria-label="redo"
    >&#x21B7;</button>

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
          {#each TOOLS as candidate, index}
            <button
              class="tool"
              class:active={tool === candidate && !pendingComponent}
              title={`${candidate} (${index === 9 ? 0 : index + 1})`}
              onclick={() => { tool = candidate as Tool; pendingComponent = null; }}
            >{candidate}</button>
          {/each}
        </div>
        <p class="hint">
          Button and infobox grow tile by tile: tap a cell, then the next. Plate is the
          same button off the lattice - drag out any size.
        </p>
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
        <button class="btn block sm" onclick={importSpritePng}>Import PNG…</button>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">States</span>
          <span class="count">{1 + (project.overlays ?? []).length}</span>
        </div>
        <ul class="list">
          <li class="layer-row">
            <button
              class="row-btn"
              class:active={activeLayer === null}
              onclick={() => selectLayer(null)}
            >
              <span class="truncate">Base screen</span>
              <span class="trail">{project.codepoint}</span>
            </button>
          </li>
          {#each project.overlays ?? [] as overlay}
            <li class="layer-row">
              <button
                class="row-btn"
                class:active={activeLayer === overlay.id}
                class:muted={!shownOverlayIds.has(overlay.id)}
                onclick={() => selectLayer(overlay.id)}
              >
                <span class="truncate">{overlay.name}</span>
                <span class="trail">{overlay.elements.length}</span>
              </button>
              <div class="layer-tools">
                <button
                  class="icon"
                  class:on={shownOverlayIds.has(overlay.id)}
                  title="Show this state in the preview"
                  aria-label={`preview ${overlay.name}`}
                  onclick={() => togglePreviewLayer(overlay.id)}
                >{shownOverlayIds.has(overlay.id) ? "\u25CF" : "\u25CB"}</button>
                <button
                  class="icon"
                  title="Earlier in the title"
                  aria-label="move state up"
                  onclick={() => moveState(overlay.id, -1)}
                >&#x25B2;</button>
                <button
                  class="icon"
                  title="Later in the title"
                  aria-label="move state down"
                  onclick={() => moveState(overlay.id, 1)}
                >&#x25BC;</button>
                <button
                  class="icon"
                  title="Duplicate this state"
                  aria-label={`duplicate ${overlay.name}`}
                  onclick={() => duplicateState(overlay)}
                >&#x29C9;</button>
                <button
                  class="icon danger"
                  aria-label={`delete ${overlay.name}`}
                  title="Delete this state"
                  onclick={() => removeState(overlay)}
                >&times;</button>
              </div>
            </li>
          {/each}
        </ul>

        {#if layer}
          <div class="grid2 top">
            <label class="field"><span>name</span>
              <input value={layer.name} oninput={(event) => { layer!.name = (event.target as HTMLInputElement).value; touch(); }} />
            </label>
            <label class="field"><span>codepoint</span>
              <input value={layer.codepoint} oninput={(event) => { layer!.codepoint = (event.target as HTMLInputElement).value; touch(); }} />
            </label>
          </div>
          <label class="field top"><span>texture</span>
            <input value={layer.textureFile} oninput={(event) => { layer!.textureFile = (event.target as HTMLInputElement).value; touch(); }} />
          </label>
          <p class="hint">
            Java constant <code>{overlayConstant(layer.id)}</code>. The id never follows
            the name: it is what the constant and the file are called.
          </p>
        {:else}
          <p class="hint">
            A state is a second sheet drawn over this one, with its own codepoint. The
            base is not copied into it - transparent pixels are the base showing through.
          </p>
        {/if}
        <button class="btn block sm" onclick={addState}>+ State</button>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">{layer ? `Layers in ${layer.name}` : "Layers"}</span>
          <span class="count">{elements.length}</span>
        </div>
        <ul class="list">
          {#each elements as element}
            <li class="layer-row">
              <input type="checkbox" checked={checked.has(element.id)} onchange={() => toggleChecked(element.id)} />
              <button
                class="row-btn"
                class:active={selectedId === element.id}
                class:muted={element.hidden}
                onclick={() => (selectedId = element.id)}
              >
                <span class="truncate">
                  {element.kind === "tiles" ? `${element.tileKind} ×${element.cells?.length ?? 0}` : element.kind}{element.label ? ` “${element.label}”` : ""}
                </span>
                <span class="trail">{element.x},{element.y}</span>
              </button>
              <div class="layer-tools">
                <button
                  class="icon"
                  title="Move up: drawn earlier, so further back"
                  aria-label="move layer up"
                  onclick={() => moveLayer(element.id, -1)}
                >&#x25B2;</button>
                <button
                  class="icon"
                  title="Move down: drawn later, so further forward"
                  aria-label="move layer down"
                  onclick={() => moveLayer(element.id, 1)}
                >&#x25BC;</button>
                <button
                  class="icon"
                  class:on={element.hidden}
                  title="Hidden layers are not drawn and not exported"
                  aria-label="hide layer"
                  onclick={() => toggleFlag(element, "hidden")}
                >{element.hidden ? "\u25CB" : "\u25CF"}</button>
                <button
                  class="icon"
                  class:on={element.locked}
                  title="Locked layers ignore clicks on the canvas"
                  aria-label="lock layer"
                  onclick={() => toggleFlag(element, "locked")}
                >{element.locked ? "\u25A0" : "\u25A1"}</button>
              </div>
            </li>
          {/each}
          {#if elements.length === 0}
            <li class="hint">Pick button or infobox, then tap the grid — each tap grows the piece.</li>
          {/if}
        </ul>
        {#if elements.length > 0}
          <p class="hint">A ticked layer joins the next saved component.</p>
        {/if}
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">Hotspots</span>
          <span class="count">{hotspots.length}</span>
        </div>
        <ul class="list">
          {#each hotspots as hotspot}
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
      {#if recoverable}
        <section class="card alarm">
          <div class="card-head"><span class="label-mono">Unsaved draft</span></div>
          <p class="hint">
            This screen was left with changes that never reached disk. Restoring touches
            nothing on disk either - you still have to save.
          </p>
          <div class="row2">
            <button class="btn sm" onclick={restoreDraft}>Restore</button>
            <button class="btn sm danger" onclick={discardDraft}>Discard</button>
          </div>
        </section>
      {/if}

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
            {#if RESIZABLE.includes(selected.kind)}
              <div class="presets">
                <span class="label-mono">w</span>
                {#each WIDTH_PRESETS as preset}
                  <button class="btn sm" onclick={() => setSize("w", preset)}>{preset}</button>
                {/each}
              </div>
              <div class="presets">
                <span class="label-mono">h</span>
                {#each HEIGHT_PRESETS as preset}
                  <button class="btn sm" onclick={() => setSize("h", preset)}>{preset}</button>
                {/each}
              </div>
            {/if}
            {#if selected.kind === "button"}
              <button class="btn block sm top" onclick={() => toTiles(selected!)}>
                Snap onto the lattice
              </button>
            {/if}
          {:else}
            <p class="hint">Tap cells with the {selected.tileKind} tool to grow or shrink this piece.</p>
            {#if selected.tileKind === "button"}
              <button class="btn block sm" onclick={() => toFreePlate(selected!)}>
                Free from the lattice
              </button>
            {/if}
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
                  value={resolveColour(
                    selected.lineColors?.[index] ?? selected.textColor,
                    palette,
                    "#E6E2DA",
                  )}
                  oninput={(event) => setLineColor(index, (event.target as HTMLInputElement).value.toUpperCase())}
                />
                {#if palette.length > 0}
                  <select
                    class="line-swatch"
                    title="Use a palette colour for this line"
                    value={(selected.lineColors?.[index] ?? "").startsWith("@") ? selected.lineColors![index] : ""}
                    onchange={(event) => setLineColor(index, (event.target as HTMLSelectElement).value)}
                  >
                    <option value="">-</option>
                    {#each palette as entry}
                      <option value={`@${entry.id}`}>{entry.name}</option>
                    {/each}
                  </select>
                {/if}
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

          {#if selected.kind === "button" || (selected.kind === "tiles" && selected.tileKind === "button")}
            <label class="field top"><span>edge</span>
              <select
                value={selected.bevel ?? "single"}
                onchange={(event) => { selected!.bevel = (event.target as HTMLSelectElement).value as PlateStyle; touch(); }}
              >
                <option value="single">single - 1px bevel</option>
                <option value="double">double - 2px, for big plates</option>
                <option value="flat">flat - outline only</option>
              </select>
            </label>
          {/if}

          {#if hasText}
            <div class="grid2 top">
              <label class="field"><span>align</span>
                <select
                  value={selected.align ?? "center"}
                  onchange={(event) => { selected!.align = (event.target as HTMLSelectElement).value as "left" | "center" | "right"; touch(); }}
                >
                  <option value="left">left</option>
                  <option value="center">centre</option>
                  <option value="right">right</option>
                </select>
              </label>
              <label class="field" title="Nudge the text off that position">
                <span>text dx</span>
                <input type="number" value={selected.textDx ?? 0} onchange={(event) => { selected!.textDx = Number((event.target as HTMLInputElement).value); touch(); }} />
              </label>
              <label class="field">
                <span>text dy</span>
                <input type="number" value={selected.textDy ?? 0} onchange={(event) => { selected!.textDy = Number((event.target as HTMLInputElement).value); touch(); }} />
              </label>
            </div>
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

          <div class="colours top">
            {#if !["text", "sprite", "slot"].includes(selected.kind) && !(selected.kind === "tiles" && selected.tileKind === "infobox") && selected.kind !== "infobox"}
              <ColorField
                label="fill"
                value={selected.color}
                fallback="#C6C6C6"
                {palette}
                onchange={(next) => { selected!.color = next; touch(); }}
                oneyedrop={() => armEyedropper((hex) => { selected!.color = hex; touch(); })}
              />
              <div class="bevels" title="What the fill turns into: highlight, shadow, edge">
                <span class="label-mono">bevels</span>
                <span class="bevel" style:background={rgbaCss(bevelPreview.light)}></span>
                <span class="bevel" style:background={rgbaCss(bevelPreview.dark)}></span>
                <span class="bevel" style:background={rgbaCss(bevelPreview.edge)}></span>
              </div>
            {/if}
            {#if hasText}
              <ColorField
                label="text"
                value={selected.textColor}
                fallback="#FFFFFF"
                {palette}
                onchange={(next) => { selected!.textColor = next; touch(); }}
                oneyedrop={() => armEyedropper((hex) => { selected!.textColor = hex; touch(); })}
              />
              {#if selected.color && textContrast < 3}
                <p class="hint bad">
                  Contrast {textContrast.toFixed(1)}:1 against the fill - at this size the
                  label will not read.
                </p>
              {/if}
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
        <div class="card-head">
          <span class="label-mono">Palette</span>
          <span class="count">{palette.length}</span>
        </div>
        {#if (project.palette ?? []).length > 0}
          <ul class="list">
            {#each project.palette ?? [] as entry, index}
              <li class="swatch-row">
                <input
                  type="color"
                  value={entry.hex}
                  oninput={(event) => {
                    const entries = [...(project.palette ?? [])];
                    entries[index] = { ...entry, hex: (event.target as HTMLInputElement).value.toUpperCase() };
                    project = { ...project, palette: entries };
                  }}
                />
                <input
                  class="swatch-name"
                  value={entry.name}
                  oninput={(event) => {
                    const entries = [...(project.palette ?? [])];
                    entries[index] = { ...entry, name: (event.target as HTMLInputElement).value };
                    project = { ...project, palette: entries };
                  }}
                />
                <code class="swatch-id">@{entry.id}</code>
                <button class="btn sm danger" aria-label={`remove ${entry.name}`} onclick={() => removeSwatch(entry.id)}
                  >&times;</button
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">
            No colour named here yet. A named colour is stored as <code>@id</code>, so
            moving the swatch moves every screen that used it.
          </p>
        {/if}

        {#if packPalette.length > 0}
          <p class="hint top">From the pack - tap to make it editable here:</p>
          <div class="swatches">
            {#each packPalette as entry}
              <button
                class="chipswatch"
                style:background={entry.hex}
                title={`${entry.name} (@${entry.id})`}
                aria-label={entry.name}
                onclick={() => adoptSwatch(entry)}
              ></button>
            {/each}
          </div>
        {/if}

        <div class="row2">
          <button class="btn sm" onclick={() => addSwatch(fillHex)}>+ current fill</button>
          <button class="btn sm" onclick={samplePalette}>Sample art</button>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">Arrange</span>
          <span class="count">{checked.size > 1 ? checked.size : selected ? 1 : 0}</span>
        </div>
        <p class="hint">
          {#if checked.size > 1}
            Aligns the {checked.size} ticked layers to each other.
          {:else}
            Aligns the selected layer inside the window. Tick two or more to align them
            to each other instead.
          {/if}
        </p>
        <div class="btn-grid">
          <button class="btn sm" title="Align left" onclick={() => alignSelection("left")}>&#x2523;</button>
          <button class="btn sm" title="Centre horizontally" onclick={() => alignSelection("hcenter")}>&#x2503;</button>
          <button class="btn sm" title="Align right" onclick={() => alignSelection("right")}>&#x252B;</button>
          <button class="btn sm" title="Align top" onclick={() => alignSelection("top")}>&#x2533;</button>
          <button class="btn sm" title="Centre vertically" onclick={() => alignSelection("vcenter")}>&#x2501;</button>
          <button class="btn sm" title="Align bottom" onclick={() => alignSelection("bottom")}>&#x253B;</button>
        </div>
        <div class="row2">
          <button class="btn sm" onclick={() => distributeSelection("h")}>Space across</button>
          <button class="btn sm" onclick={() => distributeSelection("v")}>Space down</button>
        </div>
        <div class="row2">
          <button class="btn sm" onclick={() => matchSize("w")}>Same width</button>
          <button class="btn sm" onclick={() => matchSize("h")}>Same height</button>
        </div>
        <div class="row2">
          <button class="btn sm" onclick={duplicateSelection}>Duplicate</button>
          <button class="btn sm" onclick={copySelection}>Copy</button>
          <button class="btn sm" onclick={pasteClipboard}>Paste</button>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><span class="label-mono">Screen</span></div>
        <div class="grid2">
          <label class="field"><span>rows</span><input type="number" min="1" max="6" bind:value={project.rows} /></label>
          <label class="field"><span>shift</span><input type="number" bind:value={project.shift} /></label>
          <label class="field"><span>ascent</span><input type="number" bind:value={project.ascent} /></label>
          <label class="field" title="Space above the GUI on the sheet — the friendly face of the ascent. Raise it to fit a title panel above the window.">
            <span>gui ↓</span>
            <input
              type="number"
              min="-13"
              max="60"
              value={project.ascent - 13}
              oninput={(event) => { project.ascent = 13 + Number((event.target as HTMLInputElement).value); touch(); }}
            />
          </label>
          <label class="field"><span>zoom</span><input type="number" min="1" max="8" bind:value={zoom} /></label>
        </div>
        <label class="field top"><span>codepoint</span><input bind:value={project.codepoint} /></label>
        <label class="field top"><span>fallback title</span><input bind:value={project.fallbackTitle} /></label>
        <label class="check"><input type="checkbox" bind:checked={guides} /> guides</label>
        <label class="check">
          <input type="checkbox" bind:checked={showSlotNumbers} /> raw slot numbers
        </label>
        <label class="check"><input type="checkbox" bind:checked={project.bakeWindow} /> bake window into the sheet</label>
        <p class="hint">
          Erase tool: tap any part of the window — a slot, the top band, a margin — and it
          becomes a transparent hole; the contour redraws around it. Cover tool: the slot's
          well goes away but the panel grey stays, as if no slot were drawn. Tap again to
          restore. Holes: <b>{project.holes?.length ?? 0}</b> · covered:
          <b>{(project.hiddenSlots?.length ?? 0) + (project.hiddenInvSlots?.length ?? 0)}</b>.
        </p>
      </section>

      <section class="card">
        <div class="card-head">
          <span class="label-mono">Reference</span>
          {#if reference}<span class="chip">{reference.width}x{reference.height}</span>{/if}
        </div>
        {#if reference}
          <p class="hint truncate-line">{referenceName}</p>
          <div class="grid2">
            <label class="field"><span>opacity</span>
              <input type="range" min="0" max="100" bind:value={referenceOpacity} />
            </label>
            <label class="field"><span>%</span>
              <input type="number" min="0" max="100" bind:value={referenceOpacity} />
            </label>
            <label class="field"><span>x</span><input type="number" bind:value={referenceX} /></label>
            <label class="field"><span>y</span><input type="number" bind:value={referenceY} /></label>
          </div>
          <div class="row2">
            <button class="btn sm" onclick={importReference}>Replace…</button>
            <button class="btn sm danger" onclick={() => { reference = null; referenceName = ""; }}>Remove</button>
          </div>
        {:else}
          <button class="btn block sm" onclick={importReference}>Import PNG as onion skin…</button>
          <p class="hint">Drawn over the artwork to trace or compare. Never exported.</p>
        {/if}
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
          <button class="btn block" onclick={savePreviewPng}>Save preview PNG</button>
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

  /* Colour fields stack: each one carries its own swatch strip under it. */
  .colours {
    display: grid;
    gap: 0.5rem;
  }

  .bevels {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  .bevel {
    width: 14px;
    height: 14px;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
  }

  .swatch-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }

  .swatch-row input[type="color"] {
    flex: 0 0 28px;
  }

  .swatch-name {
    flex: 1;
    min-width: 0;
  }

  .swatch-id {
    flex: 0 0 auto;
    max-width: 5.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--ink-soft);
  }

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

  .line-swatch {
    flex: 0 0 3.2rem;
    min-width: 0;
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

  /* The per-layer controls: small, quiet, and never wider than the name they follow. */
  .layer-tools {
    display: flex;
    flex: 0 0 auto;
    gap: 0.1rem;
  }

  .icon {
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--ink-soft);
    padding: 0.1rem 0.22rem;
    font: inherit;
    font-size: 0.6rem;
    line-height: 1;
    cursor: pointer;
  }

  .icon:hover {
    border-color: var(--line);
    background: var(--canvas);
    color: var(--ink);
  }

  .icon.on {
    color: var(--primary);
  }

  .muted {
    opacity: 0.45;
  }

  /* Six alignment buttons in the shape of the thing they do: two rows of three. */
  .btn-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }

  /* Preset sizes: a label and a short row of the numbers a screen actually uses. */
  .presets {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-top: 0.3rem;
  }

  .presets .btn {
    flex: 1;
    min-width: 0;
    padding-left: 0.2rem;
    padding-right: 0.2rem;
  }

  .truncate-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
