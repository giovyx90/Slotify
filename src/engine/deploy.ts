// SPDX-License-Identifier: GPL-3.0-or-later
import { encodePng } from "./png";
import type { Project } from "./project";
import type { Raster } from "./raster";
import { spliceProviders, type ProviderEntry, type SpliceResult } from "./spliceGuiJson";

/**
 * A deploy is a plan first and an action second: the exact files that would be written
 * under the target pack root, plus the reload command — shown to the user before
 * anything touches a disk or a socket. Targets are explicit; there is no default, and
 * writing to a production pack path is a target nobody should ever configure.
 */

export interface DeployFile {
  /** Relative to the pack root (`plugins/Nexo/pack` on a NEXT server). */
  path: string;
  bytes: Uint8Array;
}

export interface DeployPlan {
  files: DeployFile[];
  splice: SpliceResult;
  reloadCommand: string;
}

export function buildDeployPlan(
  project: Project,
  sheet: Raster,
  provider: ProviderEntry,
  targetGuiJsonRaw: string,
  reloadCommand = "nexo reload pack",
): DeployPlan {
  const splice = spliceProviders(targetGuiJsonRaw, [provider]);

  const files: DeployFile[] = [
    {
      path: `assets/minecraft/textures/${project.textureFile}`,
      bytes: encodePng(sheet),
    },
  ];

  // Only ship the font file when the splice actually changed it — an unchanged
  // gui.json rewritten anyway is diff noise on the server side.
  if (splice.added.length > 0 || splice.corrected.length > 0) {
    files.push({
      path: "assets/minecraft/font/gui.json",
      bytes: new TextEncoder().encode(splice.text),
    });
  }

  return { files, splice, reloadCommand };
}
