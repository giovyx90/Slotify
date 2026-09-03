#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Installs the system libraries Slotify needs to build on Linux.
#
# Building a Tauri app means linking against the distro's WebKitGTK — the same engine the
# packaged app renders in — so there is a package list per distro family and no way around
# it. This script picks the list from /etc/os-release, prints the exact command, and asks
# before running anything as root.
#
#   ./scripts/linux-deps.sh          # show the command, ask, then run it
#   ./scripts/linux-deps.sh --yes    # run without asking (CI)
#   ./scripts/linux-deps.sh --print  # only print the command
#
# You do not need this to *run* Slotify from a .deb, .rpm, AppImage or the Arch package —
# those declare their own runtime dependencies. This is for building from source.

set -euo pipefail

ASSUME_YES=0
PRINT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -n|--print|--dry-run) PRINT_ONLY=1 ;;
    -h|--help) sed -n '3,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# --- which distro family are we on? ---------------------------------------------------

if [[ ! -r /etc/os-release ]]; then
  echo "no /etc/os-release — cannot tell which distro this is." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release

# ID_LIKE is what derivatives set: EndeavourOS says arch, Mint says ubuntu debian, Nobara
# says fedora. Checking it means the list below covers the derivatives for free.
family=""
for candidate in "${ID:-}" ${ID_LIKE:-}; do
  case "$candidate" in
    arch|archarm|manjaro)                     family=arch;    break ;;
    debian|ubuntu|linuxmint|pop|raspbian)     family=debian;  break ;;
    fedora|rhel|centos|almalinux|rocky)       family=fedora;  break ;;
    opensuse|opensuse-tumbleweed|opensuse-leap|suse|sles) family=suse; break ;;
    alpine)                                   family=alpine;  break ;;
    void)                                     family=void;    break ;;
    gentoo)                                   family=gentoo;  break ;;
    nixos)                                    family=nixos;   break ;;
  esac
done

sudo=""
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 && sudo="sudo " || sudo="doas "
fi

# --- the package list per family ------------------------------------------------------

case "$family" in
  arch)
    cmd="${sudo}pacman -S --needed base-devel curl wget file openssl webkit2gtk-4.1 \
librsvg libappindicator-gtk3 xdotool rust nodejs npm"
    ;;
  debian)
    cmd="${sudo}apt-get update && ${sudo}apt-get install -y build-essential curl wget file \
libssl-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev \
pkg-config"
    ;;
  fedora)
    cmd="${sudo}dnf install -y @development-tools curl wget file openssl-devel \
webkit2gtk4.1-devel librsvg2-devel libappindicator-gtk3-devel"
    ;;
  suse)
    cmd="${sudo}zypper install -y -t pattern devel_basis && ${sudo}zypper install -y curl wget file \
libopenssl-devel webkit2gtk3-devel librsvg-devel libappindicator3-1"
    ;;
  alpine)
    cmd="${sudo}apk add build-base curl wget file openssl-dev webkit2gtk-4.1-dev \
librsvg-dev libayatana-appindicator-dev"
    ;;
  void)
    cmd="${sudo}xbps-install -S base-devel curl wget file openssl-devel webkit2gtk-devel \
librsvg-devel libappindicator-devel pkg-config"
    ;;
  gentoo)
    cmd="${sudo}emerge --ask --noreplace net-libs/webkit-gtk:4.1 dev-libs/librsvg \
dev-libs/libappindicator net-misc/curl net-misc/wget sys-apps/file"
    ;;
  nixos)
    cat >&2 <<'EOF'
NixOS does not install build dependencies imperatively. Enter a shell with them instead:

  nix-shell -p pkg-config openssl webkitgtk_4_1 librsvg libayatana-appindicator \
            gtk3 cairo gdk-pixbuf glib dbus nodejs cargo rustc

then run `npm ci && npm run tauri build` inside it.
EOF
    exit 1
    ;;
  *)
    cat >&2 <<EOF
Unrecognised distro: ID=${ID:-?} ID_LIKE=${ID_LIKE:-?}

Slotify needs, by whatever name your distro gives them:
  - a C toolchain and pkg-config
  - WebKitGTK 4.1 (development headers)
  - GTK 3, librsvg, libappindicator, OpenSSL (development headers)
  - Rust (>= 1.77) and Node.js (>= 20)

Install those and \`npm ci && npm run tauri build\` will work.
EOF
    exit 1
    ;;
esac

# Collapse the line continuations so what we print is what we run.
cmd="$(echo "$cmd" | tr -d '\\' | tr -s ' ')"

echo "Detected: ${PRETTY_NAME:-$ID} (${family} family)"
echo
echo "  $cmd"
echo

if [[ $PRINT_ONLY -eq 1 ]]; then
  exit 0
fi

if [[ $ASSUME_YES -ne 1 ]]; then
  read -r -p "Run it? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "nothing installed."; exit 0; }
fi

eval "$cmd"

# --- the two toolchains the distro list does not always carry --------------------------

echo
missing=0
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust is not on PATH. Install it with:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  missing=1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not on PATH. Install Node 20+ from your package manager or https://nodejs.org"
  missing=1
fi
# An `&&` here would be the script's last command, and a false one under `set -e` exits 1
# — which would fail a CI step that had in fact installed everything it was asked to.
if [[ $missing -eq 0 ]]; then
  echo "Ready: run \`npm ci && npm run tauri build\`."
fi
