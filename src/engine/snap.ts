// SPDX-License-Identifier: GPL-3.0-or-later
import type { Rect } from "./geometry";

/**
 * Edge snapping — what makes components "connect" while dragging. Within the
 * threshold, an edge of the moving box locks onto the nearest edge of any other box
 * (flush contact or exact alignment), each axis independently.
 */
export function snapToEdges(moving: Rect, others: readonly Rect[], threshold = 3): { x: number; y: number } {
  let bestDx: number | null = null;
  let bestDy: number | null = null;

  for (const other of others) {
    // Horizontal candidates: left/right against the other's left and right.
    for (const target of [other.x, other.x + other.w]) {
      for (const edge of [moving.x, moving.x + moving.w]) {
        const delta = target - edge;
        if (Math.abs(delta) <= threshold && (bestDx === null || Math.abs(delta) < Math.abs(bestDx))) {
          bestDx = delta;
        }
      }
    }
    for (const target of [other.y, other.y + other.h]) {
      for (const edge of [moving.y, moving.y + moving.h]) {
        const delta = target - edge;
        if (Math.abs(delta) <= threshold && (bestDy === null || Math.abs(delta) < Math.abs(bestDy))) {
          bestDy = delta;
        }
      }
    }
  }

  return { x: moving.x + (bestDx ?? 0), y: moving.y + (bestDy ?? 0) };
}
