// SPDX-License-Identifier: GPL-3.0-or-later
import type { DirEntry, FsBackend } from "./fs";

/**
 * The browser build's filesystem: the File System Access API.
 *
 * Slotify edits a pack checkout, so a web build that could not reach one would be a
 * demo. `showDirectoryPicker` gives real read and write access to exactly the folder the
 * user hands over and nothing else — the same bargain as the desktop app's dialog, minus
 * the install.
 *
 * Two things it cannot do, and both are the browser's rules rather than an omission
 * here: it exists only in Chromium (Chrome, Edge, Opera), and no page may open a TCP
 * socket, so the RCON push stays a desktop feature.
 *
 * Paths arrive as `<rootName>/a/b/c` — whatever `joinPath` built from the root this
 * backend handed back — and are walked as handles from there.
 */

interface FileSystemPermissionOptions {
  mode?: "read" | "readwrite";
}

interface DirectoryHandle {
  name: string;
  kind: "directory";
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, DirectoryHandle | FileHandle]>;
  queryPermission?(options?: FileSystemPermissionOptions): Promise<PermissionState>;
  requestPermission?(options?: FileSystemPermissionOptions): Promise<PermissionState>;
}

interface FileHandle {
  name: string;
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>;
}

type PickerWindow = Window & {
  showDirectoryPicker?(options?: { mode?: "read" | "readwrite" }): Promise<DirectoryHandle>;
};

export function fileSystemAccessAvailable(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

export class FileSystemAccessBackend implements FsBackend {
  #root: DirectoryHandle | null = null;

  async roots(): Promise<Record<string, string>> {
    // Nothing is reachable until the user hands over a folder.
    return {};
  }

  get canPickRoot(): boolean {
    return fileSystemAccessAvailable();
  }

  /** Opens the browser's directory picker and returns the name paths will start with. */
  async pickRoot(): Promise<string | null> {
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) {
      throw new Error(
        "This browser cannot open a folder. The web build needs Chrome, Edge or another " +
          "Chromium browser; everywhere else, use the desktop app.",
      );
    }
    const handle = await picker.call(window, { mode: "readwrite" }).catch(() => null);
    if (!handle) return null;
    this.#root = handle;
    return handle.name;
  }

  /**
   * Walks a path to its parent directory. The first segment is the root's own name — the
   * handle is already that folder — so it is dropped rather than looked up inside itself.
   */
  async #parent(path: string, create: boolean): Promise<{ dir: DirectoryHandle; name: string }> {
    if (!this.#root) throw new Error("no folder open — choose the pack checkout first");
    const segments = path.split("/").filter((segment) => segment.length > 0);
    if (segments[0] === this.#root.name) segments.shift();

    const name = segments.pop();
    if (name == null) throw new Error(`not a file path: ${path}`);

    let dir = this.#root;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return { dir, name };
  }

  async list(path: string): Promise<DirEntry[]> {
    if (!this.#root) throw new Error("no folder open");
    const segments = path.split("/").filter((segment) => segment.length > 0);
    if (segments[0] === this.#root.name) segments.shift();

    let dir = this.#root;
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment);

    const entries: DirEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      entries.push({ name, dir: handle.kind === "directory" });
    }
    return entries;
  }

  async read(path: string): Promise<Uint8Array> {
    const { dir, name } = await this.#parent(path, false);
    const file = await (await dir.getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }

  /** Creates the parent chain, like the dev bridge and the packaged app both do. */
  async write(path: string, bytes: Uint8Array): Promise<void> {
    const { dir, name } = await this.#parent(path, true);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async delete(path: string): Promise<void> {
    try {
      const { dir, name } = await this.#parent(path, false);
      await dir.removeEntry(name);
    } catch {
      // a missing file is not an error
    }
  }
}
