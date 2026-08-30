<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { t } from "../i18n/i18n.svelte";
  import Modal from "./kit/Modal.svelte";

  /**
   * What a new screen is called, asked once, at the moment it is created.
   *
   * It used to be `mymodule` / `screen1`, hard-coded, with no way to change either — so
   * every screen anyone ever made was called that until they went looking for the field
   * that does not exist. The two names are not decoration: together they are the project
   * file (`<module>-<screen>.guiproj.json`), the texture path the export writes, and the
   * Java constants the scaffold generates. Getting them right at the start costs one
   * dialog; getting them wrong costs a rename across four places.
   */
  let {
    open = $bindable(false),
    /** A codepoint nothing in the pack claims. The registry works it out, not this. */
    suggestedCodepoint,
    /** Project file names already on disk, so a collision is said out loud, not hidden. */
    taken = [],
    /** Modules the pack already has, offered rather than remembered by the person. */
    modules = [],
    oncreate,
  }: {
    open?: boolean;
    suggestedCodepoint: string;
    taken?: string[];
    modules?: string[];
    oncreate: (spec: { module: string; screenKey: string; codepoint: string; rows: number }) => void;
  } = $props();

  let module = $state("");
  let screenKey = $state("");
  let codepoint = $state("");
  let rows = $state(6);

  /**
   * The fields start empty and Create stays off until both are filled.
   *
   * Prefilling them with `mymodule` and `screen1` is how every screen anybody made ended
   * up called that: a default that is valid is a default that ships. An empty field asks
   * the question instead, and the pack's own module names are one tap away below it.
   */
  $effect(() => {
    if (!open) return;
    codepoint = suggestedCodepoint;
  });

  /** Lowercase, digits, dash and underscore: what a file name and a Java constant share. */
  function clean(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  const fileName = $derived(`${clean(module)}-${clean(screenKey)}.guiproj.json`);
  const collides = $derived(taken.includes(fileName));
  const valid = $derived(clean(module).length > 0 && clean(screenKey).length > 0);

  function create(): void {
    if (!valid) return;
    oncreate({
      module: clean(module),
      screenKey: clean(screenKey),
      codepoint: codepoint.trim() || suggestedCodepoint,
      rows,
    });
    open = false;
  }
</script>

<Modal bind:open title={t("dialog.newScreen")}>
  <div class="stack">
    <label class="field"><span>{t("field.module")}</span>
      <input bind:value={module} placeholder="mymodule" list="slotify-modules" />
    </label>
    {#if modules.length > 0}
      <datalist id="slotify-modules">
        {#each modules as known}<option value={known}></option>{/each}
      </datalist>
      <div class="known">
        <span class="hint">{t("hint.pickModule")}</span>
        <div class="chips">
          {#each modules as known}
            <button class="chip pick" class:on={clean(module) === known} onclick={() => (module = known)}>
              {known}
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <label class="field"><span>{t("field.screenKey")}</span>
      <input bind:value={screenKey} placeholder="screen1" />
    </label>
    <div class="grid2">
      <label class="field"><span>{t("field.codepoint")}</span>
        <input bind:value={codepoint} />
      </label>
      <label class="field"><span>{t("field.rows")}</span>
        <input type="number" min="1" max="6" bind:value={rows} />
      </label>
    </div>

    {#if valid}
      <p class="hint">{t("hint.newScreenFile", { file: fileName })}</p>
      <p class="hint">{t("hint.newScreenTexture", { path: `custom_ui/${clean(module)}/${clean(screenKey)}.png` })}</p>
    {/if}
    {#if collides}
      <p class="hint bad">{t("hint.newScreenTaken")}</p>
    {:else if !valid}
      <p class="hint">{t("hint.moduleNeeded")}</p>
    {/if}

    <div class="row2">
      <button class="btn" onclick={() => (open = false)}>{t("btn.cancel")}</button>
      <button class="btn primary" disabled={!valid} onclick={create}>{t("btn.create")}</button>
    </div>
  </div>
</Modal>

<style>
  .known {
    display: grid;
    gap: var(--s2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  .pick {
    border: 1px solid var(--line);
    background: var(--canvas);
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }
  .pick:hover {
    border-color: var(--line-strong);
    color: var(--ink);
  }
  .pick.on {
    border-color: var(--primary);
    color: var(--ink);
  }
  .row2 {
    display: flex;
    justify-content: flex-end;
    gap: var(--s3);
    margin-top: var(--s3);
  }
</style>
