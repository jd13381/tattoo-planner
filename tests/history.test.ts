import { describe, expect, it } from "vitest";
import { canRedo, canUndo, createHistory, push, redo, reset, seal, undo } from "../src/editor/history.ts";

describe("history", () => {
  it("starts empty", () => {
    const h = createHistory("a");
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("undoes and redoes in order", () => {
    let h = createHistory(1);
    h = push(h, 2);
    h = push(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it("does not mutate its input", () => {
    const h0 = createHistory([1]);
    const h1 = push(h0, [2]);
    const h2 = undo(h1);
    expect(h0.past).toEqual([]);
    expect(h1.present).toEqual([2]);
    expect(h2.present).toEqual([1]);
  });

  it("clears the redo stack on a new push", () => {
    let h = push(push(createHistory(1), 2), 3);
    h = undo(h);
    h = push(h, 4);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(2);
  });

  it("ignores a push of the identical value", () => {
    const h = push(createHistory("a"), "b");
    expect(push(h, "b")).toBe(h);
  });

  it("coalesces pushes with the same key into one step", () => {
    let h = createHistory(0);
    for (let x = 1; x <= 5; x++) h = push(h, x, { coalesceKey: "drag-1" });
    expect(h.present).toBe(5);
    expect(h.past).toEqual([0]);
    expect(undo(h).present).toBe(0);
  });

  it("starts a new step for a different key, no key, or after seal", () => {
    let h = push(createHistory(0), 1, { coalesceKey: "a" });
    h = push(h, 2, { coalesceKey: "b" });
    expect(h.past).toEqual([0, 1]);
    h = push(h, 3);
    h = push(h, 4);
    expect(h.past).toEqual([0, 1, 2, 3]);
    h = push(h, 5, { coalesceKey: "c" });
    h = seal(h);
    h = push(h, 6, { coalesceKey: "c" });
    expect(h.past).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("does not coalesce into a snapshot reached by undo", () => {
    let h = push(createHistory(0), 1, { coalesceKey: "a" });
    h = undo(h);
    h = push(h, 2, { coalesceKey: "a" });
    expect(h.past).toEqual([0]);
  });

  it("keeps at most cap undo steps", () => {
    let h = createHistory(0, 3);
    for (let x = 1; x <= 10; x++) h = push(h, x);
    expect(h.past).toEqual([7, 8, 9]);
    expect(h.present).toBe(10);
  });

  it("reset drops both stacks and keeps the cap", () => {
    let h = createHistory(0, 5);
    h = undo(push(push(h, 1), 2));
    h = reset(h, 42);
    expect(h.present).toBe(42);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(h.cap).toBe(5);
  });
});
