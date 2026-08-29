// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Undo, as a plain data structure so it can be tested without a browser.
 *
 * The editor mutates the project in place all over the place — `bind:value` on a number
 * field writes `selected.x` directly, and there is no single door to hook. So the stack
 * does not store commands, it stores whole snapshots (serialised projects), and the
 * editor hands it one whenever the project has settled. Equal snapshots are refused, so
 * a change that changes nothing costs nothing.
 */

export interface UndoStack<T> {
  past: T[];
  future: T[];
  present: T;
  /** How many steps back the stack keeps. The oldest fall off the bottom. */
  limit: number;
}

export function createStack<T>(present: T, limit = 80): UndoStack<T> {
  return { past: [], future: [], present, limit };
}

/**
 * Records a new state. Returns false — and touches nothing — when it equals the
 * present, which is what keeps a redraw or a no-op keystroke out of the history.
 */
export function commit<T>(
  stack: UndoStack<T>,
  next: T,
  equals: (a: T, b: T) => boolean = Object.is,
): boolean {
  if (equals(stack.present, next)) return false;
  stack.past.push(stack.present);
  while (stack.past.length > stack.limit) stack.past.shift();
  stack.future.length = 0;
  stack.present = next;
  return true;
}

export function canUndo<T>(stack: UndoStack<T>): boolean {
  return stack.past.length > 0;
}

export function canRedo<T>(stack: UndoStack<T>): boolean {
  return stack.future.length > 0;
}

/** Steps back one state and returns it, or null when there is nothing to undo. */
export function undo<T>(stack: UndoStack<T>): T | null {
  const previous = stack.past.pop();
  if (previous === undefined) return null;
  stack.future.push(stack.present);
  stack.present = previous;
  return previous;
}

/** Steps forward again after an undo. Null when the future is empty. */
export function redo<T>(stack: UndoStack<T>): T | null {
  const next = stack.future.pop();
  if (next === undefined) return null;
  stack.past.push(stack.present);
  stack.present = next;
  return next;
}
