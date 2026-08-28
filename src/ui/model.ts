// SPDX-License-Identifier: GPL-3.0-or-later
import { parseComponent, serializeComponent, type LibraryComponent } from "../engine/components";
import { cropToOpaque } from "../engine/ninepatch";
import { parseFont, type ParsedBitmap, type ParsedFont } from "../engine/fontJson";
import { decodePng } from "../engine/png";
import { loadBitmapFont, type BitmapFont } from "../engine/textFont";
import {
  advanceOf,
  impliedAscent,
  rightmostOpaqueColumn,
  stripIsolated,
  type Raster,
} from "../engine/raster";
import { buildRegistry, collisions, type Collision, type Registry } from "../engine/registry";
import { joinPath, type FsBackend } from "../platform/fs";

/**
 * The v0 read-only model: open a pack checkout, parse every font file, build the
 * registry, and hand the viewer a browsable list of painted screens.
 */

export interface Profile {
  version: number;
  name: string;
  paths: {
    fontDir: string;
    guiFont: string;
    /** Candidate pack categories, tried in order when resolving a texture. */
    textureRoots: string[];
    /** The project's real infobox art (repo-relative); rendered as a ninepatch. */
    infoboxSkin?: string;
    infoboxSkinBorder?: number;
    /** The project's panel / title-box art (NEXT: boxtitolo.png). */
    panelSkin?: string;
    panelSkinBorder?: number;
  };
  codepointRanges?: { module: string; range: [string, string] }[];
}

export interface ScreenEntry {
  codepoint: number;
  textureFile: string;
  ascent: number;
  height: number;
  fontFile: string;
  /** `custom_ui/<folder>/name.png` -> folder, for grouping. */
  folder: string;
  name: string;
}

export interface LoadedPack {
  root: string;
  profile: Profile;
  fonts: ParsedFont[];
  registry: Registry;
  collisions: Collision[];
  screens: ScreenEntry[];
}

export async function loadPack(backend: FsBackend, root: string, profilePath: string): Promise<LoadedPack> {
  const profile = JSON.parse(await backend.readText(joinPath(root, profilePath))) as Profile;

  const fontDir = joinPath(root, profile.paths.fontDir);
  const names = (await backend.list(fontDir))
    .filter((entry) => !entry.dir && entry.name.endsWith(".json") && !entry.name.includes(".bak"))
    .map((entry) => entry.name);

  const fonts: ParsedFont[] = [];
  for (const name of names) {
    try {
      fonts.push(parseFont(name, await backend.readText(joinPath(fontDir, name))));
    } catch (error) {
      console.warn(`skipping unparseable font ${name}:`, error);
    }
  }

  const registry = buildRegistry(fonts);

  const screens: ScreenEntry[] = [];
  for (const [codepoint, owners] of registry.glyphs) {
    for (const owner of owners) {
      const match = /^custom_ui\/([^/]+)\/(.+)\.png$/.exec(owner.textureFile);
      if (!match || owner.height < 64) continue; // sheets, not 8px status icons
      screens.push({
        codepoint,
        textureFile: owner.textureFile,
        ascent: owner.ascent,
        height: owner.height,
        fontFile: owner.fontFile,
        folder: match[1]!,
        name: match[2]!,
      });
    }
  }
  screens.sort((a, b) => a.folder.localeCompare(b.folder) || a.codepoint - b.codepoint);

  return { root, profile, fonts, registry, collisions: collisions(registry), screens };
}

/**
 * Resolve a provider's `custom_ui/<cat>/name.png` to a real file under the pack
 * checkout, trying each configured texture root. The one naming exception in the NEXT
 * pack (`company` category serving `custom_ui/companies/`) falls out of listing every
 * root rather than assuming the folder name matches the category.
 */
export async function resolveTexture(
  backend: FsBackend,
  pack: LoadedPack,
  textureFile: string,
): Promise<string | null> {
  const folder = textureFile.split("/")[1] ?? "";
  const candidates: string[] = [];

  for (const textureRoot of pack.profile.paths.textureRoots) {
    // The straightforward category, the company/companies exception, then _shared.
    candidates.push(joinPath(pack.root, textureRoot, folder, "assets/minecraft/textures", textureFile));
    candidates.push(joinPath(pack.root, textureRoot, "company", "assets/minecraft/textures", textureFile));
    candidates.push(joinPath(pack.root, textureRoot, "_shared", "assets/minecraft/textures", textureFile));
  }

  for (const candidate of candidates) {
    try {
      await backend.read(candidate);
      return candidate;
    } catch {
      // try the next root
    }
  }

  return null;
}

export interface Measurements {
  advance: number;
  rightmostColumn: number;
  strays: number;
  impliedAscents: (number | null)[];
  is256: boolean;
}

/** What the status bar shows for a sheet — measured from the bytes, never trusted. */
export function measureSheet(raster: Raster): Measurements {
  const copy: Raster = {
    width: raster.width,
    height: raster.height,
    data: new Uint8Array(raster.data),
  };
  // stripIsolated mutates; measure on the copy so the preview shows the file as-is.
  const strays = stripIsolated(copy);

  return {
    advance: advanceOf(raster),
    rightmostColumn: rightmostOpaqueColumn(raster),
    strays,
    impliedAscents: [0, 1, 2].map((row) => impliedAscent(raster, row)),
    is256: raster.width === 256 && raster.height === 256,
  };
}

export function decodeTexture(bytes: Uint8Array): Raster {
  return decodePng(bytes);
}

/**
 * The pack's own text font: the `ascii.png` override in default.json (the same texture
 * the tooltips and gui_text_* fonts reuse), loaded once and shared by button labels,
 * infoboxes and the tag generator.
 */
export async function loadGameFont(backend: FsBackend, pack: LoadedPack): Promise<BitmapFont | null> {
  const defaultFont = pack.fonts.find((font) => font.name === "default.json");
  if (!defaultFont) return null;

  const provider = defaultFont.providers.find(
    (candidate): candidate is ParsedBitmap =>
      candidate.kind === "bitmap" && candidate.file.replace(/^minecraft:/, "").includes("font/ascii"),
  );
  if (!provider) return null;

  const file = provider.file.replace(/^minecraft:/, "");
  for (const textureRoot of pack.profile.paths.textureRoots) {
    for (const category of ["_shared"]) {
      try {
        const bytes = await backend.read(
          joinPath(pack.root, textureRoot, category, "assets/minecraft/textures", file),
        );
        return loadBitmapFont(provider, decodePng(bytes));
      } catch {
        // try the next location
      }
    }
  }
  return null;
}

export interface Skin {
  raster: Raster;
  border: number;
}

/**
 * A profile-referenced ninepatch skin, cropped to its opaque box — so the editor's
 * infobox and panel are the artist's art, not imitations of it.
 */
export async function loadSkin(
  backend: FsBackend,
  pack: LoadedPack,
  path: string | undefined,
  border: number,
): Promise<Skin | null> {
  if (!path) return null;
  try {
    const raster = cropToOpaque(decodePng(await backend.read(joinPath(pack.root, path))));
    return { raster, border };
  } catch (error) {
    console.warn(`skin ${path} failed to load:`, error);
    return null;
  }
}

export async function loadInfoboxSkin(backend: FsBackend, pack: LoadedPack): Promise<Skin | null> {
  return loadSkin(backend, pack, pack.profile.paths.infoboxSkin, pack.profile.paths.infoboxSkinBorder ?? 4);
}

export async function loadPanelSkin(backend: FsBackend, pack: LoadedPack): Promise<Skin | null> {
  return loadSkin(backend, pack, pack.profile.paths.panelSkin, pack.profile.paths.panelSkinBorder ?? 3);
}

const COMPONENTS_DIR = "tools/slotify/components";

export async function listComponents(backend: FsBackend, root: string): Promise<LibraryComponent[]> {
  try {
    const entries = await backend.list(joinPath(root, COMPONENTS_DIR));
    const components: LibraryComponent[] = [];
    for (const entry of entries) {
      if (entry.dir || !entry.name.endsWith(".json")) continue;
      try {
        components.push(parseComponent(await backend.readText(joinPath(root, COMPONENTS_DIR, entry.name))));
      } catch (error) {
        console.warn(`skipping unparseable component ${entry.name}:`, error);
      }
    }
    return components.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveComponent(
  backend: FsBackend,
  root: string,
  component: LibraryComponent,
  spritePng?: Uint8Array,
): Promise<void> {
  await backend.write(
    joinPath(root, COMPONENTS_DIR, `${component.id}.json`),
    new TextEncoder().encode(serializeComponent(component)),
  );
  if (spritePng) {
    await backend.write(joinPath(root, COMPONENTS_DIR, `${component.id}.png`), spritePng);
  }
}

export async function loadSpriteRaster(
  backend: FsBackend,
  root: string,
  componentId: string,
): Promise<Raster | null> {
  try {
    return decodePng(await backend.read(joinPath(root, COMPONENTS_DIR, `${componentId}.png`)));
  } catch {
    return null;
  }
}
