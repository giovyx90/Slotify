// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, createStack, redo, undo } from "./history";

describe("history", () => {
  it("refuses a snapshot equal to the present", () => {
    const stack = createStack("a");
    expect(commit(stack, "a")).toBe(false);
    expect(stack.past).toEqual([]);
  });

  it("walks back and forward through the states", () => {
    const stack = createStack("a");
    commit(stack, "b");
    commit(stack, "c");
    expect(undo(stack)).toBe("b");
    expect(undo(stack)).toBe("a");
    expect(canUndo(stack)).toBe(false);
    expect(undo(stack)).toBeNull();
    expect(redo(stack)).toBe("b");
    expect(redo(stack)).toBe("c");
    expect(canRedo(stack)).toBe(false);
  });

  it("drops the future when a new change lands after an undo", () => {
    const stack = createStack("a");
    commit(stack, "b");
    undo(stack);
    commit(stack, "c");
    expect(canRedo(stack)).toBe(false);
    expect(undo(stack)).toBe("a");
  });

  it("forgets the oldest states past the limit", () => {
    const stack = createStack("0", 3);
    for (const step of ["1", "2", "3", "4", "5"]) commit(stack, step);
    expect(stack.past).toEqual(["2", "3", "4"]);
  });
});
