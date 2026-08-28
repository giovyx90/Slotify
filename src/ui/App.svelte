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
  import Editor from "./Editor.svelte";
  import Preview from "./Preview.svelte";
  import TagTool from "./TagTool.svelte";
  import {
    decodeTexture,
    loadGameFont,
    loadInfoboxSkin,
    loadPack,
    measureSheet,
    resolveTexture,
    type LoadedPack,
    type Measurements,
    type ScreenEntry,
  } from "./model";

  const backend = detectBackend();
  const PROFILE_PATH = "tools/slotify/next.profile.json";

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

  $effect(() => {
    void (async () => {
      try {
        const roots = await backend.roots();
        const first = Object.entries(roots)[0];
        if (!first) {
          status = "No roots configured — copy slotify.dev.example.json to slotify.dev.json and point it at your pack checkout.";
          return;
        }
        status = `Reading fonts from ${first[0]}…`;
        pack = await loadPack(backend, first[1], PROFILE_PATH);
        status = "";
        void refreshProjects();
        gameFont = await loadGameFont(backend, pack);
        infoboxSkin = (await loadInfoboxSkin(backend, pack)) ?? undefined;
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
    {fonts}
    {infoboxSkin}
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
<main>
  <aside class="sidebar">
    <header class="brand">
      <img src="/art/app-icon.svg" alt="" width="28" height="28" />
      <h1>Slotify</h1>
    </header>

    {#if pack}
      <p class="meta">{pack.fonts.length} fonts · {pack.registry.glyphs.size} glyphs · {pack.screens.length} sheets</p>

      <button class="primary" onclick={newScreen}>+ New screen</button>
      <button class="primary" onclick={() => (mode = "tag")}>Aa Tag generator</button>

      {#if savedProjects.length > 0}
        <details class="projects" open>
          <summary>Projects <span class="count">{savedProjects.length}</span></summary>
          <ul>
            {#each savedProjects as name}
              <li><button onclick={() => openProject(name)}>{name.replace(".guiproj.json", "")}</button></li>
            {/each}
          </ul>
        </details>
      {/if}

      {#if pack.collisions.length > 0}
        <details class="collisions" open>
          <summary>⚠ {pack.collisions.length} codepoint collision{pack.collisions.length === 1 ? "" : "s"}</summary>
          <ul>
            {#each pack.collisions as collision}
              <li>{describeCollision(collision)}</li>
            {/each}
          </ul>
        </details>
      {/if}

      <nav>
        {#each folders as group}
          <details open={selected?.folder === group.folder}>
            <summary>{group.folder} <span class="count">{group.screens.length}</span></summary>
            <ul>
              {#each group.screens as screen}
                <li>
                  <button
                    class:active={selected?.codepoint === screen.codepoint}
                    onclick={() => select(screen)}
                  >
                    {screen.name}
                    <span class="cp">{formatCodepoint(screen.codepoint)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </details>
        {/each}
      </nav>
    {:else}
      <p class="meta">{status}</p>
    {/if}
  </aside>

  <section class="stage-wrap">
    {#if missingTexture}
      <p class="warn big">Texture not found in the pack for {selected?.textureFile} — this is a dangling provider.</p>
    {:else}
      <Preview base={baseSheet} overlays={overlaySheets} {rows} {shift} {zoom} {guides} {hideViewerInventory} />
    {/if}
  </section>

  <aside class="inspector">
    {#if selected}
      <h2>{selected.name}</h2>
      {#if baseSheet}
        <button class="primary" onclick={openInEditor}>Open in editor</button>
      {/if}
      <dl>
        <dt>Codepoint</dt>
        <dd>{formatCodepoint(selected.codepoint)} · {selected.fontFile}</dd>
        <dt>Texture</dt>
        <dd>{selected.textureFile}</dd>
        <dt>Declared ascent</dt>
        <dd>{selected.ascent} (height {selected.height})</dd>
      </dl>

      {#if measurements}
        <dl>
          <dt>Measured advance</dt>
          <dd>{measurements.advance} <span class="hint">(rightmost opaque column {measurements.rightmostColumn} + 2)</span></dd>
          <dt>Stray pixels</dt>
          <dd class={measurements.strays > 0 ? "warn" : ""}>
            {measurements.strays}{measurements.strays > 0 ? " — the advance above is wrong until these are stripped" : ""}
          </dd>
          <dt>Canvas</dt>
          <dd class={measurements.is256 ? "" : "warn"}>{measurements.is256 ? "256×256" : "NOT 256×256 — the ascent will scale, not crop"}</dd>
          {#if ascentCheck}
            <dt>Implied ascent</dt>
            <dd class={ascentCheck.matches ? "" : "warn"}>
              {ascentCheck.implied} (cell on row {ascentCheck.row})
              {ascentCheck.matches ? "— matches" : `— gui.json declares ${selected.ascent}`}
            </dd>
          {/if}
        </dl>
      {/if}

      {#if siblings.length > 0}
        <h3>Overlays ({selected.folder})</h3>
        <ul class="overlays">
          {#each siblings as sibling}
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={overlaysOn.has(sibling.codepoint)}
                  onchange={() => toggleOverlay(sibling)}
                />
                {sibling.name}
              </label>
            </li>
          {/each}
        </ul>
      {/if}

      <h3>View</h3>
      <div class="controls">
        <label>rows <input type="number" min="1" max="6" bind:value={rows} /></label>
        <label>shift <input type="number" min="-256" max="256" bind:value={shift} /></label>
        <label>zoom <input type="range" min="1" max="8" bind:value={zoom} /> {zoom}×</label>
        <label><input type="checkbox" bind:checked={guides} /> guides</label>
        <label><input type="checkbox" bind:checked={hideViewerInventory} /> hide viewer inventory</label>
      </div>
    {:else if pack}
      <p class="meta">Pick a sheet to see its measurements.</p>
    {/if}
  </aside>
</main>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #141417;
    color: #e6e2da;
    font: 14px/1.45 system-ui, "Segoe UI", sans-serif;
  }

  main {
    display: grid;
    grid-template-columns: 270px 1fr 300px;
    height: 100vh;
  }

  /* Narrow panes and tablets: stack, keep the preview tallest. */
  @media (max-width: 980px) {
    main {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: minmax(45vh, 1fr) minmax(0, 55vh);
      height: auto;
      min-height: 100vh;
    }

    .stage-wrap {
      grid-column: 1 / -1;
      grid-row: 1;
      min-height: 45vh;
    }

    .sidebar,
    .inspector {
      grid-row: 2;
      border: 0;
      border-top: 1px solid #2c2c33;
    }
  }

  .sidebar,
  .inspector {
    overflow-y: auto;
    padding: 0.75rem;
    background: #1c1c21;
  }

  .sidebar {
    border-right: 1px solid #2c2c33;
  }

  .inspector {
    border-left: 1px solid #2c2c33;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .brand h1 {
    font-size: 1.05rem;
    margin: 0;
    letter-spacing: 0.02em;
  }

  .meta {
    color: #9a958c;
    font-size: 0.8rem;
  }

  .primary {
    display: block;
    width: 100%;
    margin: 0.4rem 0;
    background: #3b2a1a;
    color: #ffc65c;
    border: 1px solid #7a5220;
    border-radius: 6px;
    padding: 0.5rem;
    font: inherit;
    cursor: pointer;
    min-height: 38px;
  }

  .projects {
    font-size: 0.82rem;
    margin-bottom: 0.4rem;
  }

  .projects ul {
    list-style: none;
    margin: 0.25rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }

  .projects button {
    width: 100%;
    text-align: left;
    background: #26262d;
    color: inherit;
    border: 1px solid #33333b;
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
    font: inherit;
    cursor: pointer;
  }

  .collisions {
    background: #2a1f16;
    border: 1px solid #7a5220;
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font-size: 0.78rem;
    margin-bottom: 0.5rem;
  }

  .collisions ul {
    margin: 0.25rem 0 0;
    padding-left: 1rem;
    word-break: break-all;
  }

  nav details {
    margin-bottom: 0.15rem;
  }

  nav summary {
    cursor: pointer;
    padding: 0.35rem 0.4rem;
    border-radius: 6px;
    text-transform: capitalize;
  }

  nav summary:hover {
    background: #26262d;
  }

  .count {
    color: #77726a;
    font-size: 0.75rem;
  }

  nav ul {
    list-style: none;
    margin: 0;
    padding-left: 0.6rem;
  }

  nav button {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.5rem; /* generous — touch is a first-class pointer here */
    background: none;
    border: 0;
    border-radius: 6px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  nav button:hover {
    background: #26262d;
  }

  nav button.active {
    background: #3b2a1a;
    color: #ffc65c;
  }

  .cp {
    color: #77726a;
    font-size: 0.72rem;
  }

  .stage-wrap {
    overflow: auto;
  }

  h2 {
    font-size: 1rem;
    margin: 0.25rem 0 0.5rem;
  }

  h3 {
    font-size: 0.85rem;
    margin: 1rem 0 0.35rem;
    color: #b8b2a7;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.6rem;
    font-size: 0.82rem;
    margin: 0.4rem 0;
  }

  dt {
    color: #9a958c;
  }

  dd {
    margin: 0;
    word-break: break-all;
  }

  .hint {
    color: #77726a;
  }

  .warn {
    color: #ff9c5b;
  }

  .warn.big {
    padding: 2rem;
  }

  .overlays {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .overlays label,
  .controls label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0;
    min-height: 28px;
  }

  .controls input[type="number"] {
    width: 4.5rem;
    background: #26262d;
    color: inherit;
    border: 1px solid #33333b;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
  }
</style>
