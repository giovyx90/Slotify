# Slotify — where this is going

Aseprite for Minecraft GUIs. Not a slogan: a list of the things Aseprite has that Slotify
does not, in the order they are worth building.

Read [README.md](README.md) first — it says what exists today. This says what does not,
and why each missing piece is missing on purpose or by accident.

---

## §0 — Geometry stops being constants

Everything below depends on this one change, so it goes first and alone.

Today the window **is** a chest. `src/engine/geometry.ts:16-29` hard-codes `WINDOW_W = 176`,
`COLS = 9`, the 18px lattice and the canonical (8,18) origin; `src/engine/project.ts:150`
caps `rows` at 6; `src/engine/chestRenderer.ts:67` draws the window procedurally in the
vanilla greys. An anvil does not fit anywhere in that — not for want of a feature, for
want of a type.

The change is **`ContainerProfile` as data**:

```
id, windowW, windowH, titleOrigin {x, k}, slots[] {index, x, y},
inventory[], clientDraws[] {rect, what}, source, indicesVerified
```

And the half that matters: **profiles are measured, never typed.**

1. **Slots are detected from the texture.** A vanilla well is an exact signature — a 16×16
   `#8B8B8B` field, `#373737` above and left, `#FFFFFF` below and right — and it is the
   same one `impliedAscent` already looks for on artist sheets. Point Slotify at
   `textures/gui/container/anvil.png` and it reports every well and their raw indices. No
   constant is ever typed by a human. Verified: run against the NEXT pack's own anvil
   texture it finds the 36 player-inventory wells at x=8, y=84/102/120/142 — and, correctly,
   none of the three anvil slots, because that texture has them erased.
2. **The title origin is calibrated once, by dropping a screenshot in.** `titleLabelX/Y` lives
   in client code, not in any texture, so it cannot be detected. It gets measured instead:
   Slotify writes a sheet with a magenta cross at known coordinates, you open that screen in
   game and drop the screenshot on the app. It finds the window by the slot grid it has already
   measured, finds the cross by its colour, gets the GUI scale from the two together, and
   solves — with nothing typed. What it stores is not `titleLabelX/Y` but the two numbers the
   engine already uses: `windowX = x + shift + sheetX` and `windowY = sheetY − ascent + k`.
   One ritual per container, forever.

   And it is not a wall: a measured container is **ready to draw on**. The origin is only
   needed to export, so it sits before shipping rather than before the work.
3. **The result is shareable.** `slotify.containers.json` next to the pack, versioned, extended by
   whoever measures a screen nobody has measured yet. Slotify does not know where the anvil's
   title sits; the first person who calibrates it does, and then everybody does.

Corollary, and the reason this is a Slotify feature rather than a data file: **the hazard
map.** The anvil draws its text field and level cost over your art; the furnace its flame and
arrow; the brewing stand its bubbles; the merchant its scroll bar and trade arrows. Those
rectangles belong in the profile and get hatched red on the canvas — *the client wins here*.
This is the tool's existing promise (measured, checked, visible) applied to screens it does
not know yet, instead of a surprise on the dev server.

**Mojang assets are never bundled.** Detection runs on a texture the user already has — their
pack, or their own extracted client jar. A profile ships as numbers, not as pixels.

---

## §1 — The timeline

Aseprite is not the brush. It is **layers × frames**, and Slotify already owns half that
drawing without having noticed: `overlays` (`src/engine/project.ts:130`) *are* the frames.

- **A layers × states dock.** Today every overlay carries its own `elements` array, so moving
  one background panel across four states is four moves that diverge the first time somebody
  is in a hurry. The missing primitive is the **linked cel**: one element, shared, edited once.
- **Tags** (`idle` / `hover` / `press` / `loading`) and **onion skin between states** — the
  reference-PNG machinery exists, it just needs pointing at the previous state.
- **Animation, one timeline, two export targets.** (a) `.mcmeta` on the font texture: frames
  stacked, `frametime`, the client animates it for free — but identically for everyone and
  deaf to input. (b) N sheets plus a generated ticker: per-player and interactive, and it
  costs a task. Progress bars, spinners, a blinking cursor in an anvil field: none of them are
  drawn today because there is nowhere to draw them.
- **Real tilemap layers.** `src/engine/tiles.ts` is one special case of this — button-shaped
  regions on the 18px lattice. Generalised: any tileset, any grid, **blob/wang auto-tiling**,
  so painting a region resolves its own corners.
- **Slices → designs.** Draw a panel, drag four slice guides across it, name it: it becomes a
  `design` (`src/engine/designs.ts`, `ninepatch.ts`). Today a ninepatch can only arrive as an
  imported PNG, so the loop never closes inside the tool.
- **The palette as a document**: ramps, indexed mode, a shading brush that walks the ramp
  instead of replacing colour, palette-from-image. The multiplier is already built — `@brand.red`
  resolves through the profile — so **a pack-wide reskin is one swatch and a re-export**.

---

## §2 — Stop drawing a picture, start drawing a screen

The largest jump in what the tool *is*, and cheap, because the pack is already open.

- **Items in the slots.** Render real stacks in the preview: vanilla item models from the pack,
  Nexo custom items resolved out of the same pack, player heads. Half of a painted GUI is the
  items, and the preview is currently the other half.
- **Tooltips in the game font.** Name, lore, colours. The other half of the UX, invisible until
  it is on a server.
- **A GUI-scale strip** — the same screen at scale 1/2/3/4, side by side. Half-pixel problems
  die there instead of on the dev server.
- **Play mode.** Hotspot → state is nearly data already (`hotspots` + `overlays`). Make it
  clickable in the app, then export it twice: a shareable HTML prototype for people without the
  repo, and the click routing in the Java scaffold.
- **`kind: "input"`** (`src/engine/project.ts:52`): the anvil's text field as an element — clip
  region, cursor, max length, and the certainty that the client will write over it.

---

## §3 — The loop with the server

- **Live link.** Export → `nexo reload pack` (built) → **reopen the screen on the designer's
  client**. Under a second. The difference between trying and looking.
- **Screenshot round-trip.** Paste an in-game screenshot; Slotify finds the window contour,
  diffs it against the design and says *ascent off by 2, shift off by 1*, with the number that
  fixes it. The format's signature silent failure finally gets an instrument.
- **An optional companion module** server-side: `/slotify open <module>:<screen>` opens the
  exported screen with nothing behind it, `/slotify probe` prints the codepoints and shift
  actually sent. Those two lists disagreeing is most of the bugs.

---

## §4 — From an app to a tool: headless, scripts, exporters

The engine is pure TypeScript with no DOM. That is the most valuable decision in the project
and today only the UI benefits from it.

- **A `slotify` CLI**: `export`, `lint`, `diff`, `registry`, `reskin`. Then the CI job that
  re-exports every project and **fails when a PNG in the pack no longer matches its
  `.guiproj.json`**. The pack loses the ability to lie.
- **A visual diff for git.** `slotify diff` renders before and after, highlights changed pixels
  and names the elements that moved. PNGs in a monorepo are unreviewable; this makes them
  reviewable.
- **Scripting.** A JS console over the engine plus a `scripts/` folder — Aseprite's Lua.
  *Generate forty shop pages from a CSV. Recolour everything. Renumber a module's codepoints.*
- **Exporters as declarative plugins.** Export is PNG + `gui.json` splice + Java + NEXT YAML
  today. As templates it also reaches DeluxeMenus, Nexo GUIs, ItemsAdder, TrMenu,
  ChestCommands, a bare MiniMessage title, Adventure JSON. **This is the single biggest lever
  on "versatile"**: it is how somebody who is not NEXT gets in, and a new target becomes a file
  instead of a change to the engine.
- **Importers, symmetrically.** Vectorise an existing pack — 18px lattice, bevels, text, back
  into elements. Import already does half of this with cell-detected hotspots. Pushed further,
  a pack full of dead PNGs becomes a pack you can edit.

---

## §5 — 1.21: the vanilla sprites, not only the title

Since 1.20.2 the vanilla GUI is an atlas under `textures/gui/sprites/` with nine-slice metadata
in each `.mcmeta`. For the parts the title glyph **cannot reach** — the widgets the client draws
over you (§0) — the honest fix is not to paint underneath, it is to restyle the widget. Slotify
already understands nine-patch; making it the editor for `gui/sprites` (browse, edit, write
`nine_slice`, preview stretched at several sizes) is a second product inside the same tool, and
it is the real answer to "anvil, and the rest".

The warning belongs in the UI, not in a document: this is **global to every screen on the
server** — the same trade already accepted for the anvil and the generic chest.

---

## §6 — A tool you can live in

- **Document tabs** and a split view. One screen at a time today.
- **A command palette (ctrl+K).** `src/ui/Editor.svelte` is 3709 lines: it has more controls
  than any rail can show, and splitting it is the one plan item still open. The palette makes
  it bearable *before* the split.
- **Templates per container type**: anvil input, shop page, confirm, six-row menu.
- **Every extension point is a folder next to the pack**: container profiles, exporters,
  designs, components, scripts. That is what separates NEXT's internal tool from a tool other
  people use.

---

## Decisions

| Question | Answer | Why not the other thing |
|---|---|---|
| How does a container type get its geometry? | Detected from its texture, title anchor calibrated once against a screenshot | Typing twenty screens' constants is an afternoon and then twenty years of 1px bugs, each found in production |
| Ship vanilla textures with Slotify? | Never — detect against the user's own pack or client jar | Mojang assets in a GPL repo, and a stale copy the day the game updates |
| Where do non-chest slot positions live? | `slotify.containers.json` next to the pack, versioned and shareable | Hard-coding them makes Slotify the bottleneck for every screen nobody has measured |
| Frames, or more overlays? | Overlays *are* frames — one timeline, linked cels | A second concept for the same thing, and two ways to move one panel |
| New export targets? | Declarative exporter templates | Every plugin's YAML dialect welded into the engine, forever |
| Widgets the client draws over? | Hazard rectangles in the profile, and the 1.21 sprite editor for the ones worth restyling | Discovering them on the dev server, one screen at a time |

## What does NOT get built

- **A general image editor.** No filters, no layer effects, no curves. Instead: **round-trip
  with Aseprite** — open a paint layer in Aseprite, Slotify watches the file and reloads on
  save. Aseprite is better at being Aseprite.
- **Anything at runtime.** Slotify stays design-time. The generated Java is scaffold and is
  never re-patched — hand-tuned click code is not machine-mergeable.
- **Generated click *behaviour*.** Constants and routing yes, decisions no.
- **Writing to production.** Unchanged, and it now covers every new export target too.
- **Bedrock.**
- **A menu-config editor for one specific plugin as the core model.** That is an *exporter*.
  Confusing the two is how a tool ends up married to DeluxeMenus.

## Delivery order

| # | Stage | Why then |
|---|---|---|
| 1 | `ContainerProfile`, well detection, title calibration | Unlocks the anvil and everything after it; without it each new screen is a guess |
| 2 | Hazard map, `kind:"input"` | Makes the anvil designable rather than merely drawable |
| 3 | Items in slots, tooltips, GUI-scale strip | The biggest change in what the tool feels like, at constant engine |
| 4 | Timeline: states matrix, linked cels, tags, onion skin | Names what the overlays already are |
| 5 | Headless CLI, lint, visual diff, CI | The pack loses the ability to lie |
| 6 | Exporters as plugins | The front door for everybody who is not NEXT |
| 7 | Animation, tilemaps with auto-tiling, slices → designs | Aseprite, properly |
| 8 | The 1.21 sprite editor | The parts the title cannot reach |
| 9 | Screenshot round-trip, live link | Closes the loop with the server |
| **never** | General image editor, runtime, generated behaviour, writes to production, Bedrock | — |
