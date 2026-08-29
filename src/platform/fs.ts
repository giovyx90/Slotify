// SPDX-License-Identifier: GPL-3.0-or-later

import { FileSystemAccessBackend } from "./fsAccess";

/**
 * The one filesystem surface the app uses, with three backends:
 *
 * - packaged: the Tauri fs plugin (scoped by capabilities);
 * - browser dev server: the `/__slotify/*` bridge vite.config.ts serves, which only
 *   exposes the roots listed in the developer's gitignored `slotify.dev.json`.
 *
 * Paths are always forward-slash joined; the backends cope with the OS.
 */

export interface DirEntry {
  name: string;
  dir: boolean;
}

export interface FsBackend {
  /** Named entry points the user may browse — never the machine at large. */
  roots(): Promise<Record<string, string>>;
  /**
   * Whether this surface can ask the user for a folder. The dev bridge cannot: its
   * roots come from a config file the developer wrote.
   */
  readonly canPickRoot?: boolean;
  /** Opens the platform's folder picker; returns the root paths will be built from. */
  pickRoot?(): Promise<string | null>;
  list(path: string): Promise<DirEntry[]>;
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Removes one file; a missing file is not an error. */
  delete(path: string): Promise<void>;
}

export function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((part) => part.length > 0)
    .join("/");
}

class DevHttpBackend implements FsBackend {
  async roots(): Promise<Record<string, string>> {
    return this.json("/__slotify/roots");
  }

  async list(path: string): Promise<DirEntry[]> {
    return this.json(`/__slotify/list?path=${encodeURIComponent(path)}`);
  }

  async read(path: string): Promise<Uint8Array> {
    const response = await fetch(`/__slotify/read?path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`read ${path}: ${response.status} ${await response.text()}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const response = await fetch(`/__slotify/write?path=${encodeURIComponent(path)}`, {
      method: "POST",
      body: bytes as BodyInit,
    });
    if (!response.ok) throw new Error(`write ${path}: ${response.status} ${await response.text()}`);
  }

  async delete(path: string): Promise<void> {
    const response = await fetch(`/__slotify/delete?path=${encodeURIComponent(path)}`, { method: "POST" });
    if (!response.ok) throw new Error(`delete ${path}: ${response.status} ${await response.text()}`);
  }

  private async json<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}

class TauriBackend implements FsBackend {
  readonly canPickRoot = true;

  async roots(): Promise<Record<string, string>> {
    // The packaged app starts from the folder the user opens via the dialog plugin;
    // there are no implicit roots.
    return {};
  }

  /**
   * The dialog plugin, not a webview picker: picking through it calls `allow_file` on
   * the fs scope, which is what makes the chosen folder readable at all.
   */
  async pickRoot(): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Choose your pack repository (the repo root)" });
    return typeof dir === "string" ? dir.replace(/\\/g, "/") : null;
  }

  async list(path: string): Promise<DirEntry[]> {
    const fs = await import("@tauri-apps/plugin-fs");
    const entries = await fs.readDir(path);
    return entries.map((entry) => ({ name: entry.name, dir: entry.isDirectory }));
  }

  async read(path: string): Promise<Uint8Array> {
    const fs = await import("@tauri-apps/plugin-fs");
    return fs.readFile(path);
  }

  async readText(path: string): Promise<string> {
    const fs = await import("@tauri-apps/plugin-fs");
    return fs.readTextFile(path);
  }

  /**
   * Writes, creating the parent chain first. The dev bridge has always done this
   * (`mkdirSync(..., { recursive: true })` in vite.config.ts); the fs plugin does not,
   * and `tools/slotify/components/` does not exist in a fresh pack checkout — which is
   * why importing a sprite failed in the packaged app and worked in the browser.
   */
  async write(path: string, bytes: Uint8Array): Promise<void> {
    const fs = await import("@tauri-apps/plugin-fs");
    const parent = path.replace(/\/+[^/]*$/, "");
    if (parent && parent !== path) {
      try {
        await fs.mkdir(parent, { recursive: true });
      } catch {
        // already there, or the scope refuses — let the write report the real problem
      }
    }
    await fs.writeFile(path, bytes);
  }

  async delete(path: string): Promise<void> {
    const fs = await import("@tauri-apps/plugin-fs");
    try {
      await fs.remove(path);
    } catch {
      // a missing file is not an error
    }
  }
}

/**
 * Which filesystem this copy of Slotify is talking to.
 *
 * The packaged app has the fs plugin. The dev server has the bridge vite.config.ts
 * serves. A build served from anywhere else — the hosted one — has the browser's own
 * File System Access API, which reaches a real pack checkout the user hands over.
 */
export function detectBackend(): FsBackend {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return new TauriBackend();
  if (import.meta.env.DEV) return new DevHttpBackend();
  return new FileSystemAccessBackend();
}
