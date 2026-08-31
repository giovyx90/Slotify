<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  /**
   * Measuring a container screen, so a design can be drawn for one.
   *
   * SLOTIFY-VISION.md §0. Two halves, and they are different in kind: the slot grid and
   * the window size are *detected* from the container's own texture, and the title origin
   * — which lives in client code and appears in no file — is *calibrated* against a
   * screenshot. A profile with only the first half is honestly incomplete and says so;
   * nothing here ever fills a number in by resemblance to another screen.
   */
  import {
    CONTAINERS_FILE,
    CONTAINER_KINDS,
    parseContainerLibrary,
    profileGaps,
    serializeContainerLibrary,
    type ContainerKind,
    type ContainerLibrary,
    type ContainerProfile,
  } from "../engine/containers";
  import { calibrationSheet, solveTitleOrigin } from "../engine/calibrate";
  import { detectContainer, profileFromDetection, type Detection } from "../engine/detect";
  import { encodePng, decodePng } from "../engine/png";
  import { joinPath, type FsBackend } from "../platform/fs";
  import { listContainerTextures, type LoadedPack } from "./model";
  import { t } from "../i18n/i18n.svelte";

  interface Props {
    backend: FsBackend;
    pack: LoadedPack;
    onExit: () => void;
  }

  const { backend, pack, onExit }: Props = $props();

  interface Row {
    kind: ContainerKind;
    texture: string | null;
    detection: Detection | null;
    profile: ContainerProfile | null;
    error?: string;
  }

  let rows: Row[] = $state([]);
  let scanning = $state(false);
  let selectedId: string | null = $state(null);
  let library: ContainerLibrary = $state({ version: 1, profiles: [] });
  let statusLine = $state("");

  const selected = $derived(rows.find((row) => row.kind.id === selectedId) ?? null);
  const libraryPath = $derived(joinPath(pack.root, CONTAINERS_FILE));

  // Calibration form. Deliberately raw numbers: the gesture that fills them in (drag the
  // window, click the marker) belongs to a later stage, and typing four numbers off a
  // screenshot beats not being able to measure the screen at all.
  let markerX = $state(120);
  let markerY = $state(40);
  let calAscent = $state(13);
  let shotWindowX = $state(0);
  let shotWindowY = $state(0);
  let shotWindowW = $state(0);
  let shotWindowH = $state(0);
  let shotMarkerX = $state(0);
  let shotMarkerY = $state(0);

  const calibration = $derived.by(() => {
    const profile = selected?.profile;
    if (!profile || shotWindowW <= 0 || shotWindowH <= 0) return null;
    return solveTitleOrigin({
      marker: { x: markerX, y: markerY },
      ascent: calAscent,
      window: { w: profile.windowW, h: profile.windowH },
      windowRect: { x: shotWindowX, y: shotWindowY, w: shotWindowW, h: shotWindowH },
      markerAt: { x: shotMarkerX, y: shotMarkerY },
    });
  });

  async function scan(): Promise<void> {
    scanning = true;
    statusLine = "";
    const found: Row[] = [];

    try {
      const text = await backend.readText(libraryPath);
      library = parseContainerLibrary(text);
    } catch {
      library = { version: 1, profiles: [] };
    }

    const available = await listContainerTextures(backend, pack).catch(() => new Map<string, string>());

    for (const kind of CONTAINER_KINDS) {
      try {
        const texture = kind.texture.map((name) => available.get(name)).find((path) => path !== undefined) ?? null;
        if (!texture) {
          found.push({ kind, texture: null, detection: null, profile: null });
          continue;
        }
        const raster = decodePng(await backend.read(texture));
        const detection = detectContainer(raster, kind);
        const saved = library.profiles.find((profile) => profile.id === kind.id);
        const measured = profileFromDetection(kind.id, kind.name, detection, kind);
        // A saved title origin is a measurement somebody made; re-detecting the pixels
        // must not throw it away.
        if (saved?.titleOrigin) {
          measured.titleOrigin = saved.titleOrigin;
          measured.source = "calibrated";
        }
        found.push({ kind, texture, detection, profile: measured });
      } catch (error) {
        found.push({ kind, texture: null, detection: null, profile: null, error: String(error) });
      }
    }

    rows = found;
    scanning = false;
    const measured = found.filter((row) => row.profile !== null).length;
    statusLine = t("containers.scanned", { measured: String(measured), total: String(found.length) });
  }

  function downloadCalibrationSheet(): void {
    const sheet = calibrationSheet(markerX, markerY);
    const blob = new Blob([encodePng(sheet) as BlobPart], { type: "image/png" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `calibration-${markerX}-${markerY}.png`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    statusLine = t("containers.sheetDownloaded");
  }

  function applyCalibration(): void {
    const row = selected;
    if (!row?.profile || !calibration?.ok) return;
    row.profile = { ...row.profile, titleOrigin: calibration.origin, source: "calibrated" };
    rows = [...rows];
    statusLine = t("containers.calibrated", { x: String(calibration.origin.x), k: String(calibration.origin.k) });
  }

  async function saveProfile(): Promise<void> {
    const profile = selected?.profile;
    if (!profile) return;
    const next: ContainerLibrary = {
      version: 1,
      profiles: [...library.profiles.filter((entry) => entry.id !== profile.id), profile].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    };
    const bytes = new TextEncoder().encode(serializeContainerLibrary(next));
    await backend.write(libraryPath, bytes);
    library = next;
    statusLine = t("containers.saved", { file: CONTAINERS_FILE });
  }

  $effect(() => {
    if (rows.length === 0 && !scanning) void scan();
  });
</script>

<div class="screen">
  <header class="topbar">
    <button class="btn" onclick={onExit}>&larr; {t("chrome.viewer")}</button>
    <h1>{t("containers.title")}</h1>
    <span class="hint">{t("containers.subtitle")}</span>
    <div class="spacer"></div>
    {#if statusLine}<span class="status">{statusLine}</span>{/if}
    <button class="btn" onclick={scan} disabled={scanning}>{t("containers.rescan")}</button>
  </header>

  <div class="body">
    <section class="list">
      {#each rows as row (row.kind.id)}
        {@const gaps = row.profile ? profileGaps(row.profile, row.kind) : []}
        <button
          class="row"
          class:active={row.kind.id === selectedId}
          onclick={() => (selectedId = row.kind.id)}
        >
          <span class="name">{row.kind.name}</span>
          {#if row.texture === null}
            <span class="badge muted">{t("containers.noTexture")}</span>
          {:else if row.profile}
            <span class="badge" class:ok={gaps.length === 0} class:warn={gaps.length > 0}>
              {row.profile.slots.length}/{row.kind.slotCount}
            </span>
            <span class="dims">{row.profile.windowW}×{row.profile.windowH}</span>
          {:else}
            <span class="badge warn">{t("containers.failed")}</span>
          {/if}
        </button>
      {/each}
      {#if rows.length === 0}
        <p class="empty">{scanning ? t("containers.scanning") : t("containers.nothing")}</p>
      {/if}
    </section>

    <section class="detail">
      {#if !selected}
        <p class="empty">{t("containers.pick")}</p>
      {:else}
        <h2>{selected.kind.name}</h2>
        {#if selected.texture}
          <p class="path">{selected.texture}</p>
        {:else}
          <p class="empty">
            {t("containers.notInPack", { files: selected.kind.texture.join(", ") })}
          </p>
        {/if}

        {#if selected.error}
          <p class="problem">{selected.error}</p>
        {/if}

        {#if selected.profile}
          {@const profile = selected.profile}
          <dl class="facts">
            <dt>{t("containers.window")}</dt>
            <dd>{profile.windowW} × {profile.windowH}</dd>
            <dt>{t("containers.slots")}</dt>
            <dd>{profile.slots.length} / {selected.kind.slotCount}</dd>
            <dt>{t("containers.viewerInv")}</dt>
            <dd>{profile.inventory.length}</dd>
            <dt>{t("containers.titleOrigin")}</dt>
            <dd>
              {#if profile.titleOrigin}
                x={profile.titleOrigin.x}, k={profile.titleOrigin.k}
              {:else}
                <span class="problem">{t("containers.uncalibrated")}</span>
              {/if}
            </dd>
            <dt>{t("containers.source")}</dt>
            <dd>{profile.source}</dd>
          </dl>

          {#each profileGaps(profile, selected.kind) as gap}
            <p class="gap">{gap}</p>
          {/each}
          {#each profile.notes as note}
            <p class="note">{note}</p>
          {/each}

          <h3>{t("containers.calibration")}</h3>
          <p class="hint">{t("containers.calibrationHow")}</p>

          <div class="grid">
            <label>{t("containers.markerX")}<input type="number" bind:value={markerX} /></label>
            <label>{t("containers.markerY")}<input type="number" bind:value={markerY} /></label>
            <label>{t("containers.ascent")}<input type="number" bind:value={calAscent} /></label>
          </div>
          <button class="btn" onclick={downloadCalibrationSheet}>{t("containers.downloadSheet")}</button>

          <div class="grid">
            <label>{t("containers.shotWindowX")}<input type="number" bind:value={shotWindowX} /></label>
            <label>{t("containers.shotWindowY")}<input type="number" bind:value={shotWindowY} /></label>
            <label>{t("containers.shotWindowW")}<input type="number" bind:value={shotWindowW} /></label>
            <label>{t("containers.shotWindowH")}<input type="number" bind:value={shotWindowH} /></label>
            <label>{t("containers.shotMarkerX")}<input type="number" bind:value={shotMarkerX} /></label>
            <label>{t("containers.shotMarkerY")}<input type="number" bind:value={shotMarkerY} /></label>
          </div>

          {#if calibration === null}
            <p class="hint">{t("containers.awaitingShot")}</p>
          {:else if calibration.ok}
            <p class="solved">
              {t("containers.solved", {
                x: String(calibration.origin.x),
                k: String(calibration.origin.k),
                scale: String(calibration.scale),
              })}
            </p>
            <button class="btn primary" onclick={applyCalibration}>{t("containers.apply")}</button>
          {:else}
            <p class="problem">{calibration.problem}</p>
          {/if}

          <h3>{t("containers.saving")}</h3>
          <p class="hint">{t("containers.savingWhere", { file: CONTAINERS_FILE })}</p>
          <button class="btn primary" onclick={saveProfile}>{t("containers.save")}</button>
        {/if}
      {/if}
    </section>
  </div>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--canvas);
    color: var(--ink);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--s4);
    padding: 0 var(--s5);
    height: var(--topbar-h);
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }
  h1 {
    font-size: 1rem;
    margin: 0;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0 0 var(--s2);
  }
  h3 {
    font-size: 0.85rem;
    margin: var(--s5) 0 var(--s2);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
  }
  .spacer {
    flex: 1;
  }
  .status {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--ink-soft);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(240px, 320px) 1fr;
    gap: var(--s5);
    padding: var(--s5);
    overflow: auto;
    flex: 1;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    align-content: start;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s3);
    width: 100%;
    padding: var(--s3) var(--s4);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
    color: inherit;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.active {
    border-color: var(--primary);
  }
  .name {
    flex: 1;
  }
  .dims,
  .path {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--ink-faint);
    word-break: break-all;
  }
  .badge {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-pill);
    background: var(--line);
  }
  .badge.ok {
    background: var(--success-soft);
    color: var(--success);
  }
  .badge.warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .badge.muted {
    color: var(--ink-faint);
  }
  .detail {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--s5);
    align-self: start;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--s1) var(--s4);
    margin: var(--s4) 0;
    font-size: 0.85rem;
  }
  .facts dt {
    color: var(--ink-soft);
  }
  .facts dd {
    margin: 0;
    font-family: var(--font-mono);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--s3);
    margin: var(--s3) 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    font-size: 0.75rem;
    color: var(--ink-soft);
  }
  input {
    font-family: var(--font-mono);
    padding: var(--s2);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--canvas);
    color: var(--ink);
  }
  .hint,
  .empty,
  .note {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .gap,
  .problem {
    font-size: 0.8rem;
    color: var(--danger);
  }
  .solved {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--success);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) var(--s4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: inherit;
    cursor: pointer;
  }
  .btn:hover {
    background: var(--hover);
  }
  .btn.primary {
    background: var(--primary);
    border-color: var(--primary);
    color: #fff;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
