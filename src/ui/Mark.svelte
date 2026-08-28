<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  The app mark, drawn inline so it inherits the theme's red and needs no asset request:
  the inventory grid with one slot selected, which is what this whole tool is about.
  `art/app-icon.svg` remains the packaged application icon.
-->
<script lang="ts">
  let { size = 26 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="var(--ink)" />
  <g stroke="#ffffff" stroke-opacity="0.16" stroke-width="1.15">
    <path d="M8.6 2.2v19.6M15.4 2.2v19.6M2.2 8.6h19.6M2.2 15.4h19.6" />
  </g>
  <rect x="9.1" y="9.1" width="5.8" height="5.8" rx="1.3" fill="var(--primary)" />
</svg>

<style>
  svg {
    display: block;
    flex: 0 0 auto;
  }
</style>
