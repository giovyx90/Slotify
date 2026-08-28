// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One RCON command against one target. In the browser dev server the TCP socket lives
 * in the vite bridge; in the packaged app it will live in the Rust side. The password
 * travels per call and is never persisted by this layer.
 */

export interface RconTarget {
  host: string;
  port: number;
  password: string;
}

export async function rconExec(target: RconTarget, command: string): Promise<string> {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("rcon_exec", { ...target, command });
  }

  const response = await fetch("/__slotify/rcon", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...target, command }),
  });
  if (!response.ok) throw new Error(await response.text());
  const { response: body } = (await response.json()) as { response: string };
  return body;
}
