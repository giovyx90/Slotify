// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

/**
 * Dev-only filesystem bridge.
 *
 * In the packaged app the Tauri fs plugin reads the pack; in the browser dev server this
 * tiny middleware stands in for it. It only serves paths under the roots the developer
 * listed in `slotify.dev.json` (gitignored — see slotify.dev.example.json), so the dev
 * server never exposes the machine at large.
 *
 *   GET /__slotify/roots            -> { "<name>": "<absolute path>", ... }
 *   GET /__slotify/list?path=...    -> [ { "name": "...", "dir": true|false }, ... ]
 *   GET /__slotify/read?path=...    -> raw bytes
 */
function devFsBridge(): Plugin {
  const configPath = resolve(__dirname, "slotify.dev.json");
  const roots: Record<string, string> = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf-8")).roots ?? {}
    : {};

  const allowed = (path: string): boolean => {
    const real = resolve(path);
    return Object.values(roots).some((root) => {
      const base = resolve(root);
      return real === base || real.startsWith(base + sep);
    });
  };

  return {
    name: "slotify-dev-fs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/__slotify/")) return next();

        const fail = (code: number, message: string) => {
          res.statusCode = code;
          res.end(message);
        };

        try {
          if (url.pathname === "/__slotify/roots") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(roots));
            return;
          }

          const path = url.searchParams.get("path");
          if (!path || !allowed(path)) return fail(403, "path outside configured roots");

          if (url.pathname === "/__slotify/list") {
            const entries = readdirSync(path).map((name) => ({
              name,
              dir: statSync(join(path, name)).isDirectory(),
            }));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(entries));
            return;
          }

          if (url.pathname === "/__slotify/read") {
            res.setHeader("content-type", "application/octet-stream");
            res.end(readFileSync(path));
            return;
          }

          fail(404, "unknown endpoint");
        } catch (error) {
          fail(500, String(error));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), devFsBridge()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
