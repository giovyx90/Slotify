# Packaging

What a Linux install needs beyond the binary. Everything here is shared: the `.deb`, the
`.rpm`, the AppImage and the Arch package all come from these files, so the menu entry
and the store listing are written once and cannot drift apart.

| File | What it is |
|---|---|
| [`linux/slotify.desktop.hbs`](linux/slotify.desktop.hbs) | The menu entry. A Handlebars template, because that is what the Tauri bundler renders; `arch/PKGBUILD` renders the same file with `sed` for the Arch package. |
| [`linux/dev.giovyx.slotify.metainfo.xml`](linux/dev.giovyx.slotify.metainfo.xml) | AppStream metadata — the name, summary and description GNOME Software and KDE Discover show. Installed to `/usr/share/metainfo/`. |
| [`arch/PKGBUILD`](arch/PKGBUILD) | The Arch package. `cd packaging/arch && makepkg -si`. |

`src-tauri/tauri.conf.json` wires the first two into the bundler under
`bundle.linux.{deb,rpm}` — `desktopTemplate` for the entry, `files` for the metainfo.

## Two details worth keeping

**`Categories` is spelled out, not taken from `{{categories}}`.** That variable renders
`bundle.category` through Tauri's own mapping, which is a single freedesktop entry; the
template writes `Graphics;2DGraphics;` so the extra one is there too. Exactly one *main*
category, on purpose — `desktop-file-validate` warns about more, because a second one
puts the app in the menu twice.

The AppStream file lists Graphics *and* Development, and that is not a contradiction: it
is a catalogue, not a menu, so a second category is a second way to be found rather than
a duplicate entry.

**`StartupWMClass=Slotify` is not the binary name.** The running app's `WM_CLASS` is
`"slotify", "Slotify"` — instance, then class — and the shell matches the launcher on the
class half. Get it wrong and a running Slotify shows up in the dock a second time, as a
generic iconless window next to its own launcher. Check it with:

```bash
xprop WM_CLASS       # then click the window
```

## What the packages lay down

```
/usr/bin/slotify                                     the binary — lowercase, it is a command
/usr/share/applications/Slotify.desktop              the menu entry
/usr/share/metainfo/dev.giovyx.slotify.metainfo.xml  the store listing
/usr/share/icons/hicolor/<size>/apps/slotify.png     the icon
```

The sizes differ by package, and only because of who chooses them. The `.deb` and `.rpm`
take the three PNGs listed in `bundle.icon` and name each directory after the file's own
pixel size, so `128x128@2x.png` lands in `256x256@2/` rather than the `256x256/` the icon
theme spec would use — harmless, since `128x128/` is what gets picked anyway. The Arch
package installs the set by hand and so gets it right: 32, 64, 128, 256 and 512, plus
`scalable/apps/slotify.svg`, which is the one a HiDPI shell will actually prefer.

## Building them

```bash
./scripts/linux-deps.sh     # WebKitGTK and friends, per distro
npm ci
npm run tauri build         # -> src-tauri/target/release/bundle/{deb,rpm,appimage}/
```

CI does the same on `ubuntu-22.04` for every `v*` tag — old enough that the glibc floor it
bakes into the `.deb` and the AppImage still admits Debian 12 and Ubuntu 22.04.
