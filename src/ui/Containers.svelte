<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  /**
   * The container screens Slotify can design for.
   *
   * The first version of this was a diagnostic table: sixteen rows, fifteen of them
   * saying "not in pack", and a calibration form with six numeric fields to be read off a
   * screenshot by hand. That is a panel for whoever wrote it. What an artist needs is one
   * button that makes all sixteen work, pictures instead of numbers, and calibration that
   * happens by dropping an image in.
   *
   * The other half of the fix is not in this file but in what it now says: a container
   * that has been measured is **ready to draw on**. The title origin is only needed to
   * export, so it stopped being a wall in front of the work and became a step before
   * shipping. SLOTIFY-VISION.md §0.
   */
  import {
    CONTAINERS_FILE,
    CONTAINER_KINDS,
    parseContainerLibrary,
    serializeContainerLibrary,
    type ContainerKind,
    type ContainerLibrary,
    type ContainerProfile,
  } from "../engine/containers";
  import { calibrationSheet } from "../engine/calibrate";
  import { detectContainer, profileFromDetection } from "../engine/detect";
  import { calibrateFromScreenshot } from "../engine/screenshot";
  import { decodePng, encodePng } from "../engine/png";
  import type { Raster } from "../engine/raster";
  import { isContainerTexture, readZipEntries } from "../engine/zip";
  import { JAR_FILTER, pickFile } from "../platform/pick";
  import { joinPath, type FsBackend } from "../platform/fs";
  import { listContainerTextures, type LoadedPack } from "./model";
  import { t } from "../i18n/i18n.svelte";
  import Icon from "./kit/Icon.svelte";

  interface Props {
    backend: FsBackend;
    pack: LoadedPack;
    onExit: () => void;
  }

  const { backend, pack, onExit }: Props = $props();

  /** Where a container's measurements came from. Shown, because it changes what they mean. */
  type Origin = "pack" | "game";

  interface Card {
    kind: ContainerKind;
    profile: ContainerProfile;
    from: Origin;
  }

  let cards: Card[] = $state([]);
  let library: ContainerLibrary = $state({ version: 1, profiles: [] });
  let selectedId: string | null = $state(null);
  let busy = $state(false);
  /**
   * The pack is read once. Without this the empty case loops: no override found leaves
   * `cards` empty, the effect sees an empty list and scans again, forever.
   */
  let scannedPack = $state(false);
  let statusLine = $state("");
  let showManual = $state(false);
  let dropping = $state(false);

  /** Kept for the previews only; never written anywhere. */
  const textures = new Map<string, Raster>();

  const selected = $derived(cards.find((card) => card.kind.id === selectedId) ?? null);
  const libraryPath = $derived(joinPath(pack.root, CONTAINERS_FILE));

  // The calibration sheet's marker. Fixed on purpose: two numbers nobody has a reason to
  // change, and changing them is the kind of choice that produces a wrong answer quietly.
  const MARKER = { x: 120, y: 40 };
  const CALIBRATION_ASCENT = 13;

  type Health = "ready" | "needsTitle" | "partial" | "extra";

  function health(card: Card): Health {
    // Both directions matter. Fewer wells than the container has means some slots are
    // drawn in a way the detector does not recognise; more means something else in the
    // texture is the well grey. Either way the artist should place those by hand rather
    // than trust a count.
    if (card.profile.slots.length < card.kind.slotCount) return "partial";
    if (card.profile.slots.length > card.kind.slotCount) return "extra";
    return card.profile.titleOrigin ? "ready" : "needsTitle";
  }

  async function loadLibrary(): Promise<void> {
    try {
      library = parseContainerLibrary(await backend.readText(libraryPath));
    } catch {
      library = { version: 1, profiles: [] };
    }
  }

  /** A saved title origin is a measurement somebody made; re-measuring pixels keeps it. */
  function withSaved(profile: ContainerProfile): ContainerProfile {
    const saved = library.profiles.find((entry) => entry.id === profile.id);
    if (!saved?.titleOrigin) return profile;
    return { ...profile, titleOrigin: saved.titleOrigin, source: "calibrated" };
  }

  function measure(kind: ContainerKind, raster: Raster, from: Origin): Card {
    textures.set(kind.id, raster);
    const detection = detectContainer(raster, kind);
    return { kind, profile: withSaved(profileFromDetection(kind.id, kind.name, detection, kind)), from };
  }

  /** What the pack itself overrides — those are the pixels this server actually shows. */
  async function scanPack(): Promise<void> {
    busy = true;
    scannedPack = true;
    await loadLibrary();
    const available = await listContainerTextures(backend, pack).catch(() => new Map<string, string>());
    const found: Card[] = [];

    for (const kind of CONTAINER_KINDS) {
      const path = kind.texture.map((name) => available.get(name)).find((entry) => entry !== undefined);
      if (!path) continue;
      try {
        found.push(measure(kind, decodePng(await backend.read(path)), "pack"));
      } catch {
        // A texture that will not decode is one card missing, not a broken screen.
      }
    }

    merge(found);
    busy = false;
    statusLine = found.length > 0 ? t("containers.fromPackCount", { n: String(found.length) }) : "";
  }

  /**
   * One file, and every container Slotify knows becomes designable.
   *
   * The jar is read, the textures are measured, and the pixels are dropped: what is kept
   * is a table of numbers. Nothing of Mojang's is written into anybody's pack.
   */
  async function importFromGame(): Promise<void> {
    const picked = await pickFile(JAR_FILTER);
    if (!picked) return;

    busy = true;
    statusLine = t("containers.reading", { file: picked.name });
    try {
      await loadLibrary();
      const entries = await readZipEntries(picked.bytes, isContainerTexture);
      const byFile = new Map(entries.map((entry) => [`gui/container/${entry.name.split("/").pop()}`, entry.bytes]));
      const found: Card[] = [];

      for (const kind of CONTAINER_KINDS) {
        const bytes = kind.texture.map((name) => byFile.get(name)).find((entry) => entry !== undefined);
        if (!bytes) continue;
        try {
          found.push(measure(kind, decodePng(bytes), "game"));
        } catch {
          // Skip the one texture, keep the other twenty-five.
        }
      }

      if (found.length === 0) {
        statusLine = t("containers.notAJar", { file: picked.name });
      } else {
        merge(found);
        statusLine = t("containers.imported", { n: String(found.length), file: picked.name });
        await saveAll();
      }
    } catch (error) {
      statusLine = t("containers.notAJar", { file: picked.name });
      console.warn(error);
    } finally {
      busy = false;
    }
  }

  /** The pack's own override wins: it is what this server's players are looking at. */
  function merge(incoming: Card[]): void {
    const next = new Map(cards.map((card) => [card.kind.id, card]));
    for (const card of incoming) {
      const existing = next.get(card.kind.id);
      if (existing?.from === "pack" && card.from === "game") continue;
      next.set(card.kind.id, card);
    }
    cards = CONTAINER_KINDS.map((kind) => next.get(kind.id)).filter((card): card is Card => card !== undefined);
    if (selectedId === null) selectedId = cards[0]?.kind.id ?? null;
  }

  async function saveAll(): Promise<void> {
    const measured = new Map(cards.map((card) => [card.profile.id, card.profile]));
    for (const profile of library.profiles) if (!measured.has(profile.id)) measured.set(profile.id, profile);
    const next: ContainerLibrary = {
      version: 1,
      profiles: [...measured.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
    await backend.write(libraryPath, new TextEncoder().encode(serializeContainerLibrary(next)));
    library = next;
  }

  function downloadSheet(): void {
    const blob = new Blob([encodePng(calibrationSheet(MARKER.x, MARKER.y)) as BlobPart], { type: "image/png" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `slotify-calibration.png`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    statusLine = t("containers.sheetDownloaded");
  }

  async function readShot(file: File | null | undefined): Promise<void> {
    const card = selected;
    if (!file || !card) return;

    busy = true;
    try {
      const shot = decodePng(new Uint8Array(await file.arrayBuffer()));
      const result = calibrateFromScreenshot(shot, card.profile, MARKER, CALIBRATION_ASCENT);
      if (!result.ok) {
        statusLine = result.problem;
        return;
      }
      card.profile = { ...card.profile, titleOrigin: result.origin, source: "calibrated" };
      cards = [...cards];
      await saveAll();
      statusLine = t("containers.calibrated", {
        name: card.kind.name,
        scale: String(result.scale),
      });
    } catch {
      statusLine = t("containers.notAnImage");
    } finally {
      busy = false;
    }
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dropping = false;
    void readShot(event.dataTransfer?.files?.[0]);
  }

  async function pickShot(): Promise<void> {
    const picked = await pickFile();
    if (!picked) return;
    await readShot(new File([picked.bytes as BlobPart], picked.name));
  }

  /** Draws a measured window at 1:1, slots marked, the way the client will show it. */
  function preview(canvas: HTMLCanvasElement, card: Card) {
    const paint = () => {
      const raster = textures.get(card.kind.id);
      if (!raster) return;
      const { windowW: w, windowH: h } = card.profile;

      const source = document.createElement("canvas");
      source.width = raster.width;
      source.height = raster.height;
      source
        .getContext("2d")!
        .putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);

      canvas.width = w;
      canvas.height = h;
      const target = canvas.getContext("2d")!;
      target.clearRect(0, 0, w, h);
      target.drawImage(source, 0, 0, w, h, 0, 0, w, h);

      target.fillStyle = "rgba(255, 59, 71, 0.34)";
      for (const slot of card.profile.slots) target.fillRect(slot.x, slot.y, 16, 16);
    };

    paint();
    return { update: paint };
  }

  $effect(() => {
    if (!scannedPack && !busy) void scanPack();
  });
</script>

<div class="screen">
  <header class="topbar">
    <button class="btn ghost" onclick={onExit}>&larr; {t("chrome.viewer")}</button>
    <h1>{t("containers.title")}</h1>
    <div class="spacer"></div>
    {#if statusLine}<span class="status">{statusLine}</span>{/if}
    <button class="btn primary" onclick={importFromGame} disabled={busy}>
      <Icon name="import" />{t("containers.import")}
    </button>
  </header>

  {#if cards.length === 0}
    <div class="blank">
      <div class="blank-card">
        <h2>{t("containers.empty.title")}</h2>
        <p>{t("containers.empty.body")}</p>
        <button class="btn primary big" onclick={importFromGame} disabled={busy}>
          <Icon name="import" />{busy ? t("containers.working") : t("containers.import")}
        </button>
        <p class="fine">{t("containers.empty.privacy")}</p>
        <p class="fine">{t("containers.empty.where")}</p>
      </div>
    </div>
  {:else}
    <div class="body">
      <section class="wall">
        {#each cards as card (card.kind.id)}
          {@const state = health(card)}
          <button
            class="card"
            class:active={card.kind.id === selectedId}
            onclick={() => (selectedId = card.kind.id)}
          >
            <div class="thumb">
              <canvas use:preview={card}></canvas>
            </div>
            <span class="cname">{card.kind.name}</span>
            <span class="pill {state}">
              {state === "ready"
                ? t("containers.state.ready")
                : state === "needsTitle"
                  ? t("containers.state.needsTitle")
                  : state === "extra"
                    ? t("containers.state.extra")
                    : t("containers.state.partial")}
            </span>
          </button>
        {/each}
      </section>

      {#if selected}
        {@const card = selected}
        {@const state = health(card)}
        <aside class="detail">
          <h2>{card.kind.name}</h2>
          <p class="lede">
            {state === "ready"
              ? t("containers.ready.body")
              : state === "needsTitle"
                ? t("containers.needsTitle.body")
                : t(state === "extra" ? "containers.extra.body" : "containers.partial.body", {
                    found: String(card.profile.slots.length),
                    total: String(card.kind.slotCount),
                  })}
          </p>

          <dl class="facts">
            <dt>{t("containers.window")}</dt>
            <dd>{card.profile.windowW} × {card.profile.windowH}</dd>
            <dt>{t("containers.slots")}</dt>
            <dd>{card.profile.slots.length} / {card.kind.slotCount}</dd>
            <dt>{t("containers.measuredFrom")}</dt>
            <dd>{card.from === "pack" ? t("containers.fromPack") : t("containers.fromGame")}</dd>
          </dl>

          <h3>{t("containers.calibrate.title")}</h3>
          {#if card.profile.titleOrigin}
            <p class="done">
              {t("containers.calibrate.done", {
                x: String(card.profile.titleOrigin.x),
                k: String(card.profile.titleOrigin.k),
              })}
            </p>
          {/if}
          <p class="fine">{t("containers.calibrate.why")}</p>

          <ol class="steps">
            <li>
              {t("containers.calibrate.step1")}
              <button class="btn small" onclick={downloadSheet}>{t("containers.calibrate.download")}</button>
            </li>
            <li>{t("containers.calibrate.step2")}</li>
            <li>{t("containers.calibrate.step3")}</li>
          </ol>

          <div
            class="dropzone"
            class:over={dropping}
            role="button"
            tabindex="0"
            ondragover={(event) => {
              event.preventDefault();
              dropping = true;
            }}
            ondragleave={() => (dropping = false)}
            ondrop={onDrop}
            onclick={pickShot}
            onkeydown={(event) => event.key === "Enter" && pickShot()}
          >
            <Icon name="image" />
            <span>{t("containers.calibrate.drop")}</span>
          </div>

          <button class="link" onclick={() => (showManual = !showManual)}>
            {showManual ? t("containers.advanced.hide") : t("containers.advanced.show")}
          </button>
          {#if showManual}
            <p class="fine mono">
              marker {MARKER.x},{MARKER.y} · ascent {CALIBRATION_ASCENT} · windowY = sheetY &minus; ascent + k
            </p>
            <p class="fine">{t("containers.advanced.body", { file: CONTAINERS_FILE })}</p>
          {/if}
        </aside>
      {/if}
    </div>
  {/if}
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
    flex: none;
  }
  h1 {
    font-size: 1rem;
    margin: 0;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0 0 var(--s2);
  }
  h3 {
    font-size: 0.78rem;
    margin: var(--s6) 0 var(--s2);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--ink-soft);
  }
  .spacer {
    flex: 1;
  }
  .status {
    font-size: 0.78rem;
    color: var(--ink-soft);
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .blank {
    display: grid;
    place-items: center;
    flex: 1;
    padding: var(--s6);
  }
  .blank-card {
    max-width: 46ch;
    text-align: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--s6);
    box-shadow: var(--shadow-card);
  }
  .blank-card p {
    color: var(--ink-soft);
    font-size: 0.9rem;
    margin: 0 0 var(--s5);
  }

  .body {
    display: grid;
    grid-template-columns: 1fr minmax(300px, 380px);
    gap: var(--s5);
    padding: var(--s5);
    overflow: auto;
    flex: 1;
    align-items: start;
  }
  .wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: var(--s4);
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s2);
    padding: var(--s3);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    background: var(--surface);
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .card:hover {
    border-color: var(--line-strong);
  }
  .card.active {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary);
  }
  .thumb {
    display: grid;
    place-items: center;
    width: 100%;
    height: 104px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--canvas);
  }
  .thumb canvas {
    max-width: 100%;
    max-height: 100%;
    image-rendering: pixelated;
  }
  .cname {
    font-size: 0.82rem;
    text-align: center;
  }
  .pill {
    font-size: 0.68rem;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-pill);
    background: var(--line);
    color: var(--ink-soft);
  }
  .pill.ready {
    background: var(--success-soft);
    color: var(--success);
  }
  .pill.needsTitle {
    background: var(--info-soft);
    color: var(--info);
  }
  .pill.partial,
  .pill.extra {
    background: var(--warning-soft);
    color: var(--warning);
  }

  .detail {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--s5);
    position: sticky;
    top: 0;
  }
  .lede {
    font-size: 0.88rem;
    color: var(--ink-soft);
    margin: 0 0 var(--s4);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--s1) var(--s4);
    font-size: 0.84rem;
    margin: 0;
  }
  .facts dt {
    color: var(--ink-soft);
  }
  .facts dd {
    margin: 0;
    font-family: var(--font-mono);
  }
  .steps {
    margin: var(--s3) 0;
    padding-left: 1.1rem;
    font-size: 0.84rem;
    color: var(--ink-soft);
  }
  .steps li {
    margin-bottom: var(--s2);
  }
  .dropzone {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s3);
    padding: var(--s5);
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius);
    color: var(--ink-soft);
    font-size: 0.84rem;
    cursor: pointer;
    text-align: center;
  }
  .dropzone.over,
  .dropzone:hover {
    border-color: var(--primary);
    background: var(--primary-soft);
    color: var(--primary-deep);
  }
  .done {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--success);
    margin: 0 0 var(--s2);
  }
  .fine {
    font-size: 0.76rem;
    color: var(--ink-faint);
    margin: var(--s2) 0;
  }
  .mono {
    font-family: var(--font-mono);
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
    font: inherit;
    font-size: 0.85rem;
  }
  .btn:hover {
    background: var(--hover);
  }
  .btn.ghost {
    border-color: transparent;
  }
  .btn.primary {
    background: var(--primary);
    border-color: var(--primary);
    color: #fff;
  }
  .btn.primary:hover {
    background: var(--primary-hover);
  }
  .btn.big {
    padding: var(--s3) var(--s5);
    font-size: 0.95rem;
  }
  .btn.small {
    padding: 0.1rem var(--s3);
    font-size: 0.76rem;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.78rem;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
