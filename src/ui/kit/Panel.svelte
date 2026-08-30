<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { isPanelOpen, setPanelOpen } from "../settings.svelte";

  /**
   * A section of a rail, with a head that stays useful when the body is shut.
   *
   * The rails used to be twelve always-open cards stacked into a scroll, which is why
   * nothing could be found: the panel you wanted was four screens down, under six you had
   * finished with. Collapsing them is only half the answer, though — a shut panel that
   * says nothing is a panel you have to open to check. So the head carries the one number
   * or word that panel is about, and stays readable shut.
   *
   * Open and shut is remembered per panel id, because a person's rail is a working set
   * and rebuilding it on every launch is a tax.
   */
  const {
    id,
    title,
    count,
    chip,
    tone = "plain",
    collapsible = true,
    startOpen = true,
    children,
  }: {
    id: string;
    title: string;
    count?: number | string;
    chip?: string;
    tone?: "plain" | "alarm";
    collapsible?: boolean;
    startOpen?: boolean;
    children: Snippet;
  } = $props();

  const open = $derived(collapsible ? isPanelOpen(id, startOpen) : true);
</script>

<section class="card" class:alarm={tone === "alarm"}>
  {#if collapsible}
    <button
      type="button"
      class="card-head toggle"
      aria-expanded={open}
      onclick={() => setPanelOpen(id, !open)}
    >
      <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
      <span class="label-mono">{title}</span>
      <span class="grow"></span>
      {#if chip}<span class="chip">{chip}</span>{/if}
      {#if count !== undefined}<span class="count">{count}</span>{/if}
    </button>
  {:else}
    <div class="card-head">
      <span class="label-mono">{title}</span>
      <span class="grow"></span>
      {#if chip}<span class="chip">{chip}</span>{/if}
      {#if count !== undefined}<span class="count">{count}</span>{/if}
    </div>
  {/if}

  {#if open}
    {@render children()}
  {/if}
</section>

<style>
  .toggle {
    width: 100%;
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0;
    gap: var(--s2);
  }
  .toggle:hover .label-mono {
    color: var(--ink);
  }
  .grow {
    flex: 1 1 auto;
  }
</style>
