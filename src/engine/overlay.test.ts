// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { renderScreen } from "./chestRenderer";
import { bakeScreen, drawnSheet, freeOverlayId, overlayConstant, overlayProject } from "./overlay";
import { newProject, parseProject, serializeProject, type Overlay, type Project } from "./project";
import { advanceOf } from "./raster";

function screen(): Project {
  const project = newProject("shop", "till", "U+E8F0");
  project.elements.push({ id: "b", kind: "button", x: 20, y: 30, w: 40, h: 18, color: "#C6C6C6" });
  return project;
}

function state(overrides: Partial<Overlay> = {}): Overlay {
  return {
    id: "low-stock",
    name: "Low stock",
    codepoint: "U+E8F1",
    textureFile: "custom_ui/shop/till-low-stock.png",
    elements: [{ id: "w", kind: "button", x: 100, y: 30, w: 20, h: 18, color: "#D92632" }],
    hotspots: [],
    ...overrides,
  };
}

describe("overlayProject", () => {
  it("never lets an overlay bake the window it is supposed to sit on", () => {
    const project = { ...screen(), bakeWindow: true };
    expect(overlayProject(project, state()).bakeWindow).toBe(false);
  });

  it("takes the base's ascent, because both are authored in window coordinates", () => {
    const project = { ...screen(), ascent: 31 };
    expect(overlayProject(project, state()).ascent).toBe(31);
  });

  it("lets an overlay insist on its own ascent", () => {
    expect(overlayProject(screen(), state({ ascent: 44 })).ascent).toBe(44);
  });

  it("carries the overlay's codepoint and texture, not the base's", () => {
    const derived = overlayProject(screen(), state());
    expect(derived.codepoint).toBe("U+E8F1");
    expect(derived.textureFile).toBe("custom_ui/shop/till-low-stock.png");
  });

  it("drops the imported background, which belongs to the base alone", () => {
    const project = { ...screen(), background: { textureFile: "custom_ui/shop/till.png" } };
    expect(overlayProject(project, state()).background).toBeUndefined();
  });

  it("draws only its own elements", () => {
    expect(overlayProject(screen(), state()).elements).toHaveLength(1);
  });
});

describe("bakeScreen", () => {
  const project = { ...screen(), overlays: [state()] };

  it("bakes one sheet per state, plus the base", () => {
    const baked = bakeScreen(project);
    expect(baked.overlays).toHaveLength(1);
    expect(baked.overlays[0]!.overlay.id).toBe("low-stock");
  });

  it("gives each sheet its own measured advance", () => {
    const baked = bakeScreen(project);
    expect(baked.base.advance).toBe(advanceOf(baked.base.sheet));
    expect(baked.overlays[0]!.bake.advance).toBe(advanceOf(baked.overlays[0]!.bake.sheet));
    expect(baked.overlays[0]!.bake.advance).not.toBe(baked.base.advance);
  });

  it("leaves the overlay's sheet transparent where the base shows through", () => {
    const sheet = bakeScreen(project).overlays[0]!.bake.sheet;
    // The base's button is at (20,30); the overlay must not have painted there.
    const index = ((30 + 5) * sheet.width + (20 + 5)) * 4;
    expect(sheet.data[index + 3]).toBe(0);
  });

  it("declares the overlay's own provider, ready for the same splice", () => {
    const provider = bakeScreen(project).overlays[0]!.bake.provider;
    expect(provider.codepoint).toBe(0xe8f1);
    expect(provider.file).toBe("custom_ui/shop/till-low-stock.png");
  });
});

describe("the composed preview", () => {
  it("lands the overlay on the base's own origin", () => {
    const project = { ...screen(), overlays: [state()] };
    const baked = bakeScreen(project);
    const composed = renderScreen({
      rows: project.rows,
      shift: project.shift,
      base: drawnSheet(baked.base, project.ascent),
      overlays: [drawnSheet(baked.overlays[0]!.bake, project.ascent)],
      bare: true,
      pad: 0,
    });

    // The overlay's red button is at window (100,30); if the backtrack were wrong it
    // would be pushed right by the base's advance and this pixel would be empty.
    const index = ((30 + 5) * composed.width + (100 + 5)) * 4;
    expect(composed.data[index]).toBe(217);
    expect(composed.data[index + 3]).toBe(255);
  });
});

describe("ids", () => {
  it("never reuses an id, because it names both a constant and a file", () => {
    const project = { ...screen(), overlays: [state()] };
    expect(freeOverlayId("Low stock", project)).toBe("low-stock-2");
  });

  it("makes a usable id out of anything", () => {
    expect(freeOverlayId("Fuori  servizio!", screen())).toBe("fuori-servizio");
    expect(freeOverlayId("***", screen())).toBe("state");
  });

  it("turns an id into the Java constant the scaffold emits", () => {
    expect(overlayConstant("low-stock")).toBe("LOW_STOCK");
  });
});

describe("the project file", () => {
  it("round-trips its states", () => {
    const project = { ...screen(), overlays: [state()] };
    expect(parseProject(serializeProject(project)).overlays).toHaveLength(1);
  });

  it("still reads a project written before states existed", () => {
    const legacy = JSON.parse(serializeProject(screen())) as Record<string, unknown>;
    delete legacy.overlays;
    expect(parseProject(JSON.stringify(legacy)).overlays).toEqual([]);
  });
});
