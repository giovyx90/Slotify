// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { buildDeployPlan } from "./deploy";
import { GRID_X, GRID_Y, SHEET_TO_WINDOW_Y } from "./geometry";
import { advanceTable, glyphsJava, glyphsTestJava, layoutJava, scaffoldFiles } from "./javaScaffold";
import { decodePng } from "./png";
import { newProject, parseProject, serializeProject } from "./project";
import { alphaAt, impliedAscent } from "./raster";
import { bakeSheet, renderSheet } from "./renderProject";
import { decodePacket, encodePacket, RCON_AUTH } from "./rcon";
import { visualsYmlBlock, configYmlBlock } from "./visualsYml";

const cp = (codepoint: number): string => String.fromCodePoint(codepoint);

describe("project model", () => {
  it("round-trips through serialize/parse", () => {
    const project = newProject("mymod", "kiosk", "U+E8F0");
    project.elements.push({ id: "a", kind: "slot", x: GRID_X, y: GRID_Y, w: 16, h: 16 });
    project.hotspots.push({ id: "select", role: "action", slots: [10, 11, 12] });
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("rejects a raw-character codepoint", () => {
    const project = newProject("mymod", "kiosk", "U+E8F0");
    expect(() => parseProject(serializeProject(project).replace("U+E8F0", cp(0xe8f0)))).toThrow();
  });
});

describe("renderSheet / bakeSheet", () => {
  it("bakes window coordinates to sheet rows through the ascent", () => {
    // A slot drawn at the canonical grid origin, baked at three different ascents,
    // must always imply its own ascent back — the round-trip that makes the editor's
    // window-coordinate model safe.
    for (const ascent of [13, 26, 30]) {
      const project = newProject("mymod", "kiosk", "U+E8F0");
      project.ascent = ascent;
      project.elements.push({ id: "s", kind: "slot", x: GRID_X, y: GRID_Y, w: 16, h: 16 });
      expect(impliedAscent(renderSheet(project), 0)).toBe(ascent);
    }
  });

  it("measures the advance from the baked pixels", () => {
    const project = newProject("mymod", "kiosk", "U+E8F0");
    project.elements.push({ id: "p", kind: "panel", x: 0, y: 0, w: 176, h: 20 });
    const baked = bakeSheet(project);
    // Panel ends at window column 175 -> sheet column 175 -> advance 177.
    expect(baked.advance).toBe(177);
    expect(baked.straysRemoved).toBe(0);
    expect(baked.provider).toEqual({ codepoint: 0xe8f0, file: "custom_ui/mymod/kiosk.png", ascent: 13 });
  });

  it("draws a pressed button differently from a raised one", () => {
    const raised = newProject("m", "k", "U+E8F0");
    raised.elements.push({ id: "b", kind: "button", x: 30, y: 40, w: 40, h: 18 });
    const pressed = structuredClone(raised);
    pressed.elements[0]!.pressed = true;
    expect(renderSheet(raised).data).not.toEqual(renderSheet(pressed).data);
  });
});

describe("yml snippets", () => {
  it("writes the hospital-visuals shape with U+ codepoints", () => {
    const block = visualsYmlBlock([
      { key: "kiosk", codepoint: 0xe8f0, titleShift: -8, fallbackTitle: "Kiosk" },
    ]);
    expect(block).toBe(
      'gui:\n  kiosk:\n    glyph: "U+E8F0"\n    title-shift: -8\n    fallback-title: "Kiosk"\n',
    );
  });

  it("writes the config.yml shape", () => {
    expect(configYmlBlock("mymod.gui", [
      { key: "kiosk", codepoint: 0xe8f0, titleShift: -8, fallbackTitle: "Kiosk" },
    ])).toBe("mymod.gui.kiosk-title-shift: -8\n");
  });
});

describe("java scaffold", () => {
  const input = {
    packageName: "it.meridian.mymod.gui",
    className: "Kiosk",
    base: { constant: "MAIN", codepoint: 0xe8f0, advance: 177 },
    overlays: [{ constant: "CONFIRM_LIT", codepoint: 0xe8f1, advance: 96 }],
    hotspots: [{ constant: "SELECT_SLOTS", slots: [29, 30, 31, 32, 33] }],
    shiftConfigKey: "mymod.gui.kiosk-title-shift",
  };

  it("emits codepoints as hex ints, never literal characters", () => {
    const java = glyphsJava(input);
    expect(java).toContain("new Sheet(0xE8F0, 177)");
    expect(java).toContain("new Sheet(0xE8F1, 96)");
    expect(java.includes(cp(0xe8f0))).toBe(false);
  });

  it("keeps the un-clamped spacer loop and the per-sheet backtrack", () => {
    const java = glyphsJava(input);
    expect(java).toContain("for (int index = 6; index >= 0 && remaining > 0; index--)");
    expect(java).toContain("drawn = overlay.advance();");
    expect(java).not.toContain("Math.min(127");
  });

  it("emits the hotspot constants and the cursor-simulator test", () => {
    expect(layoutJava(input)).toContain("public static final int[] SELECT_SLOTS = {29, 30, 31, 32, 33};");
    const test = glyphsTestJava(input);
    expect(test).toContain("overlaysAllLandOnTheBaseOrigin");
    expect(test).toContain("KioskGlyphs.CONFIRM_LIT");
  });

  it("lays the three files out under src/{main,test}/java", () => {
    expect(Object.keys(scaffoldFiles(input))).toEqual([
      "src/main/java/it/meridian/mymod/gui/KioskGlyphs.java",
      "src/main/java/it/meridian/mymod/gui/KioskLayout.java",
      "src/test/java/it/meridian/mymod/gui/KioskGlyphsTest.java",
    ]);
    expect(advanceTable(input)).toContain("U+E8F0  advance 177");
  });
});

describe("rcon codec", () => {
  it("round-trips a packet", () => {
    const encoded = encodePacket({ id: 7, type: RCON_AUTH, body: "hunter2" });
    const decoded = decodePacket(encoded);
    expect(decoded?.packet).toEqual({ id: 7, type: RCON_AUTH, body: "hunter2" });
    expect(decoded?.consumed).toBe(encoded.length);
  });

  it("waits for more bytes on a partial frame", () => {
    const encoded = encodePacket({ id: 1, type: 2, body: "nexo reload pack" });
    expect(decodePacket(encoded.subarray(0, 10))).toBeNull();
  });
});

describe("deploy plan", () => {
  it("ships the texture and the spliced gui.json, and is a no-op the second time", () => {
    const project = newProject("mymod", "kiosk", "U+E8F0");
    project.elements.push({ id: "p", kind: "panel", x: 0, y: 0, w: 176, h: 20 });
    const baked = bakeSheet(project);

    const guiJson = `{"providers": [{"type": "space", "advances": {"${cp(0xe8d0)}": -1}}]}`;
    const plan = buildDeployPlan(project, baked.sheet, baked.provider, guiJson);

    expect(plan.files.map((file) => file.path)).toEqual([
      "assets/minecraft/textures/custom_ui/mymod/kiosk.png",
      "assets/minecraft/font/gui.json",
    ]);
    expect(plan.reloadCommand).toBe("nexo reload pack");

    // The shipped PNG decodes back to the baked pixels.
    const decoded = decodePng(plan.files[0]!.bytes);
    expect(alphaAt(decoded, 175, 13)).toBeGreaterThan(0);

    // Re-planning against the already-spliced font ships only the texture.
    const again = buildDeployPlan(project, baked.sheet, baked.provider, plan.splice.text);
    expect(again.files.map((file) => file.path)).toEqual([
      "assets/minecraft/textures/custom_ui/mymod/kiosk.png",
    ]);
  });
});
