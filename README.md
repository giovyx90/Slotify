<p align="center">
  <img src="art/app-icon.svg" width="96" alt="Slotify" />
</p>

# Slotify

**A design tool for Minecraft painted-GUI resource packs — pixel-perfect preview, glyph
registry, one-click deploy.**

## What is a painted GUI?

A trick most large Minecraft servers rely on: a vanilla chest inventory whose **title**
is a bitmap font glyph. The glyph is a full 256×256 sheet registered in
`assets/minecraft/font/gui.json`; a run of invisible negative-space characters walks the
title cursor left so the image lands behind the whole window, painting a completely
custom screen over a plain chest. Buttons are painted into the sheet; clicks are plain
slot indices.

It works beautifully and it fails silently. A wrong `ascent` draws the whole screen a
few pixels off with no warning in any log, ever. A single stray opaque pixel far to the
right of the artwork inflates the glyph's advance and drags every overlay across the
screen — invisible in an image viewer. Two providers claiming one codepoint means the
later one silently wins. Slotify exists to make every one of those numbers **measured,
checked and visible** instead of guessed.

## Status

The roadmap, each stage useful on its own:

- **v0 — Registry + Viewer** ✅: open a pack checkout, parse every font file, build the
  codepoint registry (collisions, dangling references, next-free allocation), browse
  every painted sheet with a pixel-perfect chest-window preview and live measurements
  (advance, stray pixels, implied vs declared ascent). Found three undocumented
  collisions in its first production pack on first run.
- **v1 — Editor + Export** ✅: touch-first canvas editor (place/drag/nudge slots,
  buttons, panels, wells in window coordinates — the ascent bakes at export, so it can
  never be "designed wrong"), hotspot painting on the slot grid, projects saved and
  reopened as JSON, import of existing screens with cell-detected hotspot suggestions;
  exports the PNG (stray-stripped, advance measured), an **idempotent textual splice**
  into `gui.json` (never re-serialised; verified byte-identical against a production
  file), and visuals/config YAML snippets.
- **v2 — Deploy + scaffold** ✅ *(mechanism)*: generates the server-side triplet
  (`<Name>Glyphs` with measured advances, `<Name>Layout` slot constants, a cursor-sim
  test), builds deploy plans (texture + spliced font, shown before anything is
  written), and runs `nexo reload pack` over RCON — from the dev bridge today, from the
  Rust side once packaged.
- **v3 — Text, colours & components** ✅: the pack's own bitmap font (`ascii.png`)
  rendered live — button labels, free text and infobox panels with editable fill, text
  and border colours; a **pixel tag generator** (gradient fill, outline, shadow,
  background plate → PNG or straight into the library); and an NXMenu-style **component
  library**: save any group of elements as a reusable composite, or import a PNG as a
  sprite, and place either with a tap — components live next to the pack
  (`tools/slotify/components/`) so every future screen starts from the same parts.
  Dragged elements edge-snap to each other; slots snap to the container grid.

## Using it

1. `npm run dev`, open `localhost:1420` (or the packaged app once built).
2. The **viewer** lists every painted sheet in the pack with collisions flagged; pick
   one to see measurements, or **Open in editor** to start from it.
3. **+ New screen** starts blank. Buttons and infoboxes are **connectable tiles**: tap
   a grid cell for a 1×1 piece, tap the next cell and it grows into one merged piece —
   the bevel wraps the region outline, and recolouring hue-shifts the highlights and
   shadows instead of leaving them white and black. The **erase** tool removes (and
   restores) individual container or player-inventory slots. Free elements
   (slot/text/panel/well) place with a tap, drag with edge snapping, and refine with
   the 1px nudge pad. Infoboxes render the profile's own artist texture as a ninepatch,
   with a colour per line; all text can use the pack font or the built-in 5×5 mono,
   with an optional directional shadow. Paint hotspots by tapping slots with a group
   active.
4. **Library**: check some layers, name them, *save ✓* — or *Import PNG…* — then tap
   any library entry and tap the canvas to place it.
5. **Tag generator**, the second tab in the top bar, renders styled game-font text;
   download it or save it to the library as a sprite.
6. **Export to pack** — in the editor's top bar, next to **Save project** — writes the
   stray-stripped PNG and splices the provider into `gui.json`; the *Copy out* card hands
   you the visuals/config YAML and the Java scaffold. **Push** writes a deploy plan under
   a target pack path and runs `nexo reload pack` over RCON.

## The interface

Slotify wears the [NEXT Roleplay](https://nextroleplay.gg) portal's design language:
its red, its ink ramp, white cards on a pale canvas, Archivo for prose and IBM Plex Mono
for every number a machine measured. A painted screen is designed here and documented
there, so the two should not look like they came from different studios.

The whole skin is one file, [`src/ui/theme.css`](src/ui/theme.css) — tokens and a small
set of primitives (card, button, segmented control, field, badge, checkerboard stage)
that the three screens share instead of each growing its own. Retheming Slotify for
another project means editing the tokens at the top of that file and nothing else. The
two faces are bundled under the SIL OFL rather than fetched from a CDN, because a
desktop tool has to look the same with no network; see
[`src/ui/fonts/README.md`](src/ui/fonts/README.md).

## Generic engine, per-project profiles

The engine knows the *mechanics* — font providers, cursor arithmetic, slot geometry,
measurement. Everything project-specific (paths, codepoint ranges per module, palette,
deploy targets) lives in a **profile** JSON you keep next to your pack. See
[`profiles/example.profile.json`](profiles/example.profile.json). Machine-local values
(absolute paths, hosts) belong in a gitignored `*.profile.local.json`; credentials never
belong in any file — the deploy adapter will use the OS keychain.

## Development

```bash
npm install
npm test          # engine unit tests (no pack needed)
npm run dev       # browser dev server on :1420
```

To browse a real pack in the browser dev server, copy
[`slotify.dev.example.json`](slotify.dev.example.json) to `slotify.dev.json` and point a
root at your pack checkout. The packaged desktop app (Tauri v2) needs a Rust toolchain:
`npm run tauri dev`.

Golden tests that re-measure a real production pack are gated on the
`SLOTIFY_NEXT_REPO` environment variable and skip cleanly without it.

## License

[GPL-3.0-or-later](LICENSE).
