<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  /**
   * A dialog, on the browser's own `<dialog>`.
   *
   * The editor had none — not one `showModal` in three thousand lines — which is exactly
   * why both rails grew into scrolling stacks: everything that should have been "pick one
   * and come back" had to live permanently on screen instead. The platform already gives
   * the focus trap, the escape key and the inert background; nothing here reimplements
   * them.
   */
  let {
    open = $bindable(false),
    title,
    children,
  }: { open?: boolean; title: string; children: Snippet } = $props();

  let node: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  });
</script>

<dialog
  bind:this={node}
  onclose={() => (open = false)}
  onclick={(event) => {
    // A click on the backdrop is a click on the dialog element itself, never on its box.
    if (event.target === node) open = false;
  }}
>
  <div class="box">
    <header>
      <h2>{title}</h2>
      <button class="close" onclick={() => (open = false)} aria-label="close"><Icon name="close" /></button>
    </header>
    <div class="body">{@render children()}</div>
  </div>
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--ink);
    max-width: 100vw;
    max-height: 100vh;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .box {
    width: min(720px, calc(100vw - 2rem));
    max-height: calc(100vh - 4rem);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s4) var(--s5);
    border-bottom: 1px solid var(--line);
  }
  h2 {
    flex: 1 1 auto;
    margin: 0;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.01em;
  }
  .close {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .close:hover {
    background: var(--hover);
    color: var(--ink);
  }
  .body {
    padding: var(--s5);
    overflow: auto;
  }
</style>
