// SPDX-License-Identifier: GPL-3.0-or-later
// Rasterises art/app-icon.svg to 1024px and hands it to `tauri icon`, which generates
// every platform size under src-tauri/icons/. Run: npm run icons
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "art", "app-icon.svg"), "utf-8");

const rendered = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render();
const pngPath = join(root, "art", "app-icon-1024.png");
mkdirSync(dirname(pngPath), { recursive: true });
writeFileSync(pngPath, rendered.asPng());
console.log(`wrote ${pngPath} (${rendered.width}x${rendered.height})`);

execFileSync("npx", ["tauri", "icon", pngPath], { cwd: root, stdio: "inherit", shell: true });
