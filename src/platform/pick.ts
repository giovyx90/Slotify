// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Choosing a file to import, on both surfaces.
 *
 * The editor used to do this with a hidden `<input type="file">`. That is the browser
 * answer and it stays the browser answer, but in the packaged app the webview's own
 * picker is the wrong door: whatever it hands back has never passed through the fs
 * scope, so nothing downstream may touch the path. The dialog plugin is the right one —
 * picking a file through it calls `allow_file` on the scope (tauri-plugin-dialog
 * `commands.rs:195`), so the file becomes readable precisely because the user chose it.
 */

export interface PickedFile {
  /** File name without the directory, extension included. */
  name: string;
  bytes: Uint8Array;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface PickFilter {
  name: string;
  extensions: string[];
}

export const PNG_FILTER: PickFilter = { name: "PNG image", extensions: ["png"] };

/**
 * A Minecraft client jar, which is a zip. Slotify reads the container textures out of it
 * to measure them, and keeps none of them.
 */
export const JAR_FILTER: PickFilter = { name: "Minecraft client jar", extensions: ["jar", "zip"] };

/** Opens the platform's file picker and reads the chosen file. Null when cancelled. */
export async function pickFile(filter: PickFilter = PNG_FILTER): Promise<PickedFile | null> {
  return isTauri() ? pickViaDialog(filter) : pickViaInput(filter);
}

async function pickViaDialog(filter: PickFilter): Promise<PickedFile | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({
    multiple: false,
    directory: false,
    title: `Choose a ${filter.name}`,
    filters: [filter],
  });
  if (typeof chosen !== "string") return null;

  const fs = await import("@tauri-apps/plugin-fs");
  const bytes = await fs.readFile(chosen);
  const cut = Math.max(chosen.lastIndexOf("/"), chosen.lastIndexOf("\\"));
  const name = chosen.slice(cut + 1) || "imported";
  return { name, bytes };
}

function pickViaInput(filter: PickFilter): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filter.extensions.map((extension) => `.${extension}`).join(",");
    input.style.display = "none";
    document.body.appendChild(input);

    const done = (result: PickedFile | null) => {
      input.remove();
      resolve(result);
    };

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      done({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    };
    // Chromium fires `cancel` on dismissal; without it the promise would hang forever.
    input.oncancel = () => done(null);
    input.click();
  });
}
