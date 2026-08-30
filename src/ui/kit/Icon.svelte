<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { ICONS, type IconName } from "./icons";

  /**
   * One icon from the set. Decorative by default: an icon that repeats the label beside
   * it must not be read out twice, so `aria-hidden` is the norm and a `label` is only
   * given where the icon is the whole control.
   */
  const { name, size = 16, label }: { name: IconName; size?: number; label?: string } = $props();

  const spec = $derived(ICONS[name]);
</script>

<svg
  class="icon"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? "img" : "presentation"}
  aria-hidden={label ? undefined : "true"}
  aria-label={label}
>
  {#if spec.d}<path d={spec.d} />{/if}
  {#if "fill" in spec && spec.fill}<path d={spec.fill} fill="currentColor" stroke="none" />{/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
