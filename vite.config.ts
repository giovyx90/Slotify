// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { Socket } from "node:net";
import type { IncomingMessage } from "node:http";

/**
 * Dev-only filesystem bridge.
 *
 * In the packaged app the Tauri fs plugin reads the pack; in the browser dev server this
 * tiny middleware stands in for it. It only serves paths under the roots the developer
 * listed in `slotify.dev.json` (gitignored — see slotify.dev.example.json), so the dev
 * server never exposes the machine at large.
 *
 *   GET  /__slotify/roots           -> { "<name>": "<absolute path>", ... }
 *   GET  /__slotify/list?path=...   -> [ { "name": "...", "dir": true|false }, ... ]
 *   GET  /__slotify/read?path=...   -> raw bytes
 *   POST /__slotify/write?path=...  -> writes the raw request body (creates parents)
 *   POST /__slotify/delete?path=... -> removes one file (missing = ok)
 *   POST /__slotify/rcon            -> { host, port, password, command } -> { response }
 *
 * Writes are root-restricted like reads. The RCON endpoint exists because a browser
 * cannot open a TCP socket; it is localhost-only dev plumbing, and the password comes
 * from the request each time — nothing is stored here.
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

  const readBody = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolveBody, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolveBody(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  /** Auth then exec, one command; resolves with the server's textual response. */
  const rconExec = (host: string, port: number, password: string, command: string): Promise<string> =>
    new Promise((resolveRcon, reject) => {
      const socket = new Socket();
      let buffer = Buffer.alloc(0);
      let authed = false;

      const packet = (id: number, type: number, body: string): Buffer => {
        const bytes = Buffer.from(body, "utf8");
        const out = Buffer.alloc(4 + 4 + 4 + bytes.length + 2);
        out.writeInt32LE(4 + 4 + bytes.length + 2, 0);
        out.writeInt32LE(id, 4);
        out.writeInt32LE(type, 8);
        bytes.copy(out, 12);
        return out;
      };

      const finish = (error: Error | null, response?: string) => {
        socket.destroy();
        clearTimeout(timer);
        if (error) reject(error);
        else resolveRcon(response ?? "");
      };

      const timer = setTimeout(() => finish(new Error("RCON timeout after 10s")), 10_000);

      socket.connect(port, host, () => socket.write(packet(1, 3, password)));
      socket.on("error", (error) => finish(error));
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const length = buffer.readInt32LE(0);
          if (buffer.length < 4 + length) break;
          const id = buffer.readInt32LE(4);
          const body = buffer.subarray(12, 4 + length - 2).toString("utf8");
          buffer = buffer.subarray(4 + length);

          if (!authed) {
            if (id === -1) return finish(new Error("RCON authentication refused"));
            authed = true;
            socket.write(packet(2, 2, command));
          } else if (id === 2) {
            return finish(null, body);
          }
        }
      });
    });

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

        if (url.pathname === "/__slotify/write" && req.method === "POST") {
          const path = url.searchParams.get("path");
          if (!path || !allowed(path)) return fail(403, "path outside configured roots");
          readBody(req)
            .then((body) => {
              mkdirSync(dirname(path), { recursive: true });
              writeFileSync(path, body);
              res.end("ok");
            })
            .catch((error) => fail(500, String(error)));
          return;
        }

        if (url.pathname === "/__slotify/delete" && req.method === "POST") {
          const path = url.searchParams.get("path");
          if (!path || !allowed(path)) return fail(403, "path outside configured roots");
          try {
            rmSync(path, { force: true });
            res.end("ok");
          } catch (error) {
            fail(500, String(error));
          }
          return;
        }

        if (url.pathname === "/__slotify/rcon" && req.method === "POST") {
          readBody(req)
            .then((body) => {
              const { host, port, password, command } = JSON.parse(body.toString("utf8"));
              return rconExec(String(host), Number(port), String(password), String(command));
            })
            .then((response) => {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ response }));
            })
            .catch((error) => fail(500, String(error)));
          return;
        }

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
