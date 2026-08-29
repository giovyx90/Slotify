<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import type { DrawnSheet } from "../engine/chestRenderer";
  import { newProject, parseProject, type Project } from "../engine/project";
  import { detectCells, type Raster } from "../engine/raster";
  import { describeCollision, nextFree } from "../engine/registry";
  import { formatCodepoint } from "../engine/unicode";
  import { buildMono5Font } from "../engine/mono5";
  import type { BitmapFont } from "../engine/textFont";
  import { detectBackend, joinPath } from "../platform/fs";
  import Mark from "./Mark.svelte";
  import Editor from "./Editor.svelte";
  import Preview from "./Preview.svelte";
  import TagTool from "./TagTool.svelte";
  import {
    decodeTexture,
    loadGameFont,
    loadInfoboxSkin,
    loadPack,
    loadPanelSkin,
    measureSheet,
    resolveTexture,
    type LoadedPack,
    type Measurements,
    type ScreenEntry,
  } from "./model";

  const backend = detectBackend();
  // Which profile a repository uses is discovered, not assumed: see PROFILE_CANDIDATES.

  let status = $state("Loading…");
  let pack: LoadedPack | null = $state(null);
  let selected: ScreenEntry | null = $state(null);
  let overlaysOn = $state(new Set<number>());
  let rows = $state(6);
  let shift = $state(-8);
  let zoom = $state(2);
  let guides = $state(true);
  let hideViewerInventory = $state(false);
  let measurements: Measurements | null = $state(null);
  let missingTexture = $state(false);

  const textures = new Map<number, Raster>();
  let baseSheet: DrawnSheet | null = $state(null);
  let overlaySheets: DrawnSheet[] = $state([]);

  let mode: "viewer" | "editor" | "tag" = $state("viewer");
  let project: Project | null = $state(null);
  let editorBackground: Raster | undefined = $state(undefined);
  let savedProjects: string[] = $state([]);
  let gameFont: BitmapFont | null = $state(null);
  let infoboxSkin: { raster: Raster; border: number } | undefined = $state(undefined);
  let panelSkin: { raster: Raster; border: number } | undefined = $state(undefined);
  const mono5 = buildMono5Font();
  const fonts = $derived({ minecraft: gameFont ?? undefined, mono5 });

  const folders = $derived.by(() => {
    if (!pack) return [] as { folder: string; screens: ScreenEntry[] }[];
    const grouped = new Map<string, ScreenEntry[]>();
    for (const screen of pack.screens) {
      grouped.set(screen.folder, [...(grouped.get(screen.folder) ?? []), screen]);
    }
    return [...grouped.entries()].map(([folder, screens]) => ({ folder, screens }));
  });

  const siblings = $derived(
    pack && selected ? pack.screens.filter((s) => s.folder === selected!.folder && s.codepoint !== selected!.codepoint) : [],
  );

  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  let needsFolder = $state(false);

  async function openRoot(root: string): Promise<void> {
    status = "Reading fonts…";
    needsFolder = false;
    pack = await loadPack(backend, root);
    status = "";
    void refreshProjects();
    gameFont = await loadGameFont(backend, pack);
    infoboxSkin = (await loadInfoboxSkin(backend, pack)) ?? undefined;
    panelSkin = (await loadPanelSkin(backend, pack)) ?? undefined;
    try {
      localStorage.setItem("slotify.root", root);
    } catch {
      // per-viewer convenience only
    }
  }

  /** The packaged app's way in: pick the pack repository with the native dialog. */
  async function pickFolder(): Promise<void> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Choose your pack repository (the repo root)" });
    if (typeof dir === "string") {
      try {
        await openRoot(dir.replace(/\\/g, "/"));
      } catch (error) {
        status = `Failed to open pack: ${error}`;
        needsFolder = true;
      }
    }
  }

  $effect(() => {
    void (async () => {
      try {
        const roots = await backend.roots();
        const first = Object.entries(roots)[0];
        if (first) {
          await openRoot(first[1]);
          return;
        }

        if (isTauri) {
          let remembered: string | null = null;
          try {
            remembered = localStorage.getItem("slotify.root");
          } catch {
            // fine — ask instead
          }
          if (remembered) {
            try {
              await openRoot(remembered);
              return;
            } catch {
              // the folder moved — ask again
            }
          }
          needsFolder = true;
          status = "Pick your pack repository folder to begin.";
          return;
        }

        status = "No roots configured — copy slotify.dev.example.json to slotify.dev.json and point it at your pack checkout.";
      } catch (error) {
        status = `Failed to open pack: ${error}`;
      }
    })();
  });

  async function sheetFor(screen: ScreenEntry): Promise<DrawnSheet | null> {
    let texture = textures.get(screen.codepoint);
    if (!texture) {
      const path = await resolveTexture(backend, pack!, screen.textureFile);
      if (!path) return null;
      texture = decodeTexture(await backend.read(path));
      textures.set(screen.codepoint, texture);
    }
    return {
      codepoint: screen.codepoint,
      ascent: screen.ascent,
      advance: measureSheet(texture).advance,
      texture,
    };
  }

  async function select(screen: ScreenEntry): Promise<void> {
    selected = screen;
    overlaysOn = new Set();
    overlaySheets = [];
    missingTexture = false;

    const sheet = await sheetFor(screen);
    if (!sheet) {
      baseSheet = null;
      measurements = null;
      missingTexture = true;
      return;
    }
    baseSheet = sheet;
    measurements = measureSheet(sheet.texture);
  }

  async function toggleOverlay(screen: ScreenEntry): Promise<void> {
    const next = new Set(overlaysOn);
    if (next.has(screen.codepoint)) next.delete(screen.codepoint);
    else next.add(screen.codepoint);
    overlaysOn = next;

    const sheets: DrawnSheet[] = [];
    for (const sibling of siblings) {
      if (!next.has(sibling.codepoint)) continue;
      const sheet = await sheetFor(sibling);
      if (sheet) sheets.push(sheet);
    }
    overlaySheets = sheets;
  }

  async function refreshProjects(): Promise<void> {
    if (!pack) return;
    try {
      const entries = await backend.list(joinPath(pack.root, "tools/slotify/projects"));
      savedProjects = entries
        .filter((entry) => !entry.dir && entry.name.endsWith(".guiproj.json"))
        .map((entry) => entry.name);
    } catch {
      savedProjects = [];
    }
  }

  function openInEditor(): void {
    if (!pack || !selected || !baseSheet) return;
    const texture = baseSheet.texture;
    const opened = newProject(selected.folder, selected.name, formatCodepoint(selected.codepoint));
    opened.ascent = selected.ascent;
    opened.textureFile = selected.textureFile;
    opened.background = { textureFile: selected.textureFile };

    // Suggest hotspots (and the row count) from the cells the artist actually drew.
    const cells = detectCells(texture, selected.ascent);
    if (cells.length > 0) {
      opened.rows = Math.max(...cells.map((cell) => cell.row)) + 1;
      opened.hotspots = [{ id: "detected", role: "action", slots: cells.map((cell) => cell.row * 9 + cell.col) }];
    }

    project = opened;
    editorBackground = texture;
    mode = "editor";
  }

  function newScreen(): void {
    if (!pack) return;
    const free = nextFree(pack.registry, { module: "new", first: 0xe8e0, last: 0xf8ff });
    project = newProject("mymodule", "screen1", formatCodepoint(free ?? 0xe8e0));
    editorBackground = undefined;
    mode = "editor";
  }

  async function openProject(name: string): Promise<void> {
    if (!pack) return;
    const text = await backend.readText(joinPath(pack.root, "tools/slotify/projects", name));
    const opened = parseProject(text);
    let texture: Raster | undefined;
    if (opened.background) {
      const path = await resolveTexture(backend, pack, opened.background.textureFile);
      if (path) texture = decodeTexture(await backend.read(path));
    }
    project = opened;
    editorBackground = texture;
    mode = "editor";
  }

  const ascentCheck = $derived.by(() => {
    if (!selected || !measurements) return null;
    for (let row = 0; row < measurements.impliedAscents.length; row++) {
      const implied = measurements.impliedAscents[row];
      if (implied !== null && implied !== undefined) {
        return { row, implied, matches: implied === selected.ascent };
      }
    }
    return null;
  });
</script>

{#if mode === "editor" && project && pack}
  <Editor
    bind:project={project as Project}
    background={editorBackground}
    {backend}
    packRoot={pack.root}
    fontPath={pack.profile.paths.fontDir + "/gui.json"}
    packPalette={pack.profile.palette ?? []}
    {fonts}
    {infoboxSkin}
    {panelSkin}
    onExit={() => {
      mode = "viewer";
      void refreshProjects();
    }}
  />
{:else if mode === "tag" && pack}
  <TagTool
    {fonts}
    {backend}
    packRoot={pack.root}
    onExit={() => (mode = "viewer")}
  />
{:else}
<div class="app">
  <header class="topbar">
    <div class="brand">
      <Mark />
      <span class="wordmark">Slotify</span>
      <span class="tagline">GUI studio</span>
    </div>

    {#if pack}
      <div class="seg">
        <button class="active">Viewer</button>
        <button onclick={() => (mode = "tag")}>Tag generator</button>
      </div>
    {/if}

    <div class="spacer"></div>

    {#if pack}
      <div class="chips">
        <span class="chip"><b>{pack.fonts.length}</b> fonts</span>
        <span class="chip"><b>{pack.registry.glyphs.size}</b> glyphs</span>
        <span class="chip"><b>{pack.screens.length}</b> sheets</span>
        {#if pack.collisions.length > 0}
          <span class="badge warn">{pack.collisions.length} collision{pack.collisions.length === 1 ? "" : "s"}</span>
        {:else}
          <span class="badge ok">no collisions</span>
        {/if}
      </div>
      <button class="btn primary" onclick={newScreen}>+ New screen</button>
    {/if}
  </header>

  <div class="workspace">
    <aside class="pane left">
      {#if pack}
        {#if savedProjects.length > 0}
          <section class="card">
            <div class="card-head">
              <span class="label-mono">Projects</span>
              <span class="count">{savedProjects.length}</span>
            </div>
            <ul class="list">
              {#each savedProjects as name}
                <li>
                  <button class="row-btn" onclick={() => openProject(name)}>
                    <span class="truncate">{name.replace(".guiproj.json", "")}</span>
                    <span class="trail">open</span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if pack.warnings.length > 0}
          <section class="card alarm">
            <details open>
              <summary>
                <span class="label-mono">Profile disagrees</span>
                <span class="count">{pack.warnings.length}</span>
              </summary>
              <ul class="collisions">
                {#each pack.warnings as warning}
                  <li>{warning}</li>
                {/each}
              </ul>
            </details>
          </section>
        {/if}

        {#if pack.collisions.length > 0}
          <section class="card alarm">
            <details open>
              <summary>
                <span class="label-mono">Codepoint collisions</span>
                <span class="count">{pack.collisions.length}</span>
              </summary>
              <ul class="collisions">
                {#each pack.collisions as collision}
                  <li>{describeCollision(collision)}</li>
                {/each}
              </ul>
            </details>
          </section>
        {/if}

        <section class="card screens">
          <div class="card-head">
            <span class="label-mono">Screens</span>
            <span class="count">{pack.screens.length}</span>
          </div>
          <nav>
            {#each folders as group}
              <details open={selected?.folder === group.folder}>
                <summary>
                  {group.folder}
                  <span class="count">{group.screens.length}</span>
                </summary>
                <ul class="list">
                  {#each group.screens as screen}
                    <li>
                      <button
                        class="row-btn"
                        class:active={selected?.codepoint === screen.codepoint}
                        onclick={() => select(screen)}
                      >
                        <span class="truncate">{screen.name}</span>
                        <span class="trail">{formatCodepoint(screen.codepoint)}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              </details>
            {/each}
          </nav>
        </section>

        <p class="root hint">{pack.root}</p>
      {:else}
        <section class="card">
          <span class="label-mono">Pack</span>
          <p class="hint">{status}</p>
          {#if needsFolder}
            <button class="btn primary block" onclick={pickFolder}>Open pack folder…</button>
          {/if}
        </section>
      {/if}
    </aside>

    {#if missingTexture}
      <section class="stage">
        <div class="empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 21 21 3" />
          </svg>
          <p>
            No texture in the pack for <span class="mono">{selected?.textureFile}</span>.
            The font declares a provider that points at nothing — a dangling reference.
          </p>
        </div>
      </section>
    {:else}
      <Preview base={baseSheet} overlays={overlaySheets} {rows} {shift} {zoom} {guides} {hideViewerInventory} />
    {/if}

    <aside class="pane right">
      {#if selected}
        <section class="card">
          <div class="card-head">
            <div class="title">
              <span class="label-mono">{selected.folder}</span>
              <h2>{selected.name}</h2>
            </div>
            <span class="chip">{formatCodepoint(selected.codepoint)}</span>
          </div>
          {#if baseSheet}
            <button class="btn primary block" onclick={openInEditor}>Open in editor</button>
          {/if}
        </section>

        <section class="card">
          <div class="card-head"><span class="label-mono">Provider</span></div>
          <dl class="kv">
            <div><dt>Font</dt><dd>{selected.fontFile}</dd></div>
            <div><dt>Texture</dt><dd>{selected.textureFile}</dd></div>
            <div><dt>Ascent</dt><dd>{selected.ascent}</dd></div>
            <div><dt>Height</dt><dd>{selected.height}</dd></div>
          </dl>
        </section>

        {#if measurements}
          <section class="card">
            <div class="card-head"><span class="label-mono">Measured</span></div>
            <dl class="kv">
              <div>
                <dt>Advance</dt>
                <dd>{measurements.advance}</dd>
              </div>
              <div>
                <dt>Strays</dt>
                <dd>
                  {#if measurements.strays > 0}
                    <span class="badge bad">{measurements.strays} px</span>
                  {:else}
                    <span class="badge ok">none</span>
                  {/if}
                </dd>
              </div>
              <div>
                <dt>Canvas</dt>
                <dd>
                  {#if measurements.is256}
                    <span class="badge ok">256×256</span>
                  {:else}
                    <span class="badge bad">not 256×256</span>
                  {/if}
                </dd>
              </div>
              {#if ascentCheck}
                <div>
                  <dt>Implied ascent</dt>
                  <dd>
                    {#if ascentCheck.matches}
                      <span class="badge ok">{ascentCheck.implied} · matches</span>
                    {:else}
                      <span class="badge bad">{ascentCheck.implied} ≠ {selected.ascent}</span>
                    {/if}
                  </dd>
                </div>
              {/if}
            </dl>
            <p class="hint note">
              Advance is the rightmost opaque column ({measurements.rightmostColumn}) plus two.
              {#if measurements.strays > 0}
                <span class="bad">Those stray pixels inflate it — strip them and it will change.</span>
              {/if}
              {#if !measurements.is256}
                <span class="bad">A sheet that is not 256×256 scales instead of cropping.</span>
              {/if}
              {#if ascentCheck && !ascentCheck.matches}
                <span class="bad">
                  Row {ascentCheck.row} of the artwork implies ascent {ascentCheck.implied}, but
                  gui.json declares {selected.ascent}: the screen draws off by the difference.
                </span>
              {/if}
            </p>
          </section>
        {/if}

        {#if siblings.length > 0}
          <section class="card">
            <div class="card-head">
              <span class="label-mono">Overlays</span>
              <span class="count">{siblings.length}</span>
            </div>
            <ul class="list">
              {#each siblings as sibling}
                <li>
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={overlaysOn.has(sibling.codepoint)}
                      onchange={() => toggleOverlay(sibling)}
                    />
                    <span class="truncate">{sibling.name}</span>
                  </label>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <section class="card">
          <div class="card-head"><span class="label-mono">View</span></div>
          <div class="grid2">
            <label class="field"><span>rows</span><input type="number" min="1" max="6" bind:value={rows} /></label>
            <label class="field"><span>shift</span><input type="number" min="-256" max="256" bind:value={shift} /></label>
          </div>
          <label class="field zoom">
            <span>zoom · {zoom}×</span>
            <input type="range" min="1" max="8" bind:value={zoom} />
          </label>
          <label class="check"><input type="checkbox" bind:checked={guides} /> guides</label>
          <label class="check"><input type="checkbox" bind:checked={hideViewerInventory} /> hide viewer inventory</label>
        </section>
      {:else if pack}
        <div class="empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
          </svg>
          <p>Pick a sheet on the left to see what the pack actually declares, and what the pixels actually measure.</p>
        </div>
      {/if}
    </aside>
  </div>
</div>
{/if}

<style>
  .chips {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  /* The pack's own path, parked at the foot of the navigation where it belongs. */
  .root {
    margin: auto 0 0;
    padding-top: 0.4rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    overflow-wrap: anywhere;
  }

  .screens nav {
    display: grid;
    gap: 0.1rem;
  }

  .screens summary {
    text-transform: capitalize;
  }

  /* The sheets of an open folder, hung off a rail: one glance says which is which. */
  .screens details > ul {
    margin-left: 0.7rem;
    padding-left: 0.3rem;
    border-left: 1px solid var(--line);
  }

  .card.alarm summary {
    padding-left: 0;
    padding-right: 0;
  }

  .collisions {
    margin: 0.35rem 0 0;
    padding-left: 1.1rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    line-height: 1.5;
    color: color-mix(in srgb, var(--warning) 55%, var(--ink));
    overflow-wrap: anywhere;
  }

  .title {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .title h2 {
    font-size: 0.95rem;
    font-weight: 800;
    overflow-wrap: anywhere;
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    margin: 0.5rem 0 0;
    display: grid;
    gap: 0.3rem;
  }

  .zoom {
    margin-top: 0.4rem;
  }

  .card > .btn {
    margin-top: 0.15rem;
  }

  /* Below this the top bar has to choose: the actions win, the read-outs go. */
  @media (max-width: 1180px) {
    .chips {
      display: none;
    }
  }
</style>
