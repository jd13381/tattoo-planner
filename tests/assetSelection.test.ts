import { describe, expect, it } from "vitest";
import {
  focusAfterRemoval,
  moveFocus,
  NO_SELECTION,
  prune,
  selectAll,
  selectOnly,
  selectRange,
  startSelecting,
  stopSelecting,
  toggle,
} from "../src/assets/selection.ts";

const visible = ["a", "b", "c", "d", "e"];

describe("selection", () => {
  it("toggles and enters select mode", () => {
    const s = toggle(NO_SELECTION, "b");
    expect(s).toEqual({ active: true, ids: ["b"], anchor: "b" });
    expect(toggle(s, "b").ids).toEqual([]);
    expect(startSelecting(NO_SELECTION).active).toBe(true);
    expect(stopSelecting()).toEqual(NO_SELECTION);
  });

  it("selects a range from the anchor, in both directions, keeping earlier picks", () => {
    let s = toggle(NO_SELECTION, "e");
    s = toggle(s, "b");
    s = selectRange(s, visible, "d");
    expect(s.ids).toEqual(["e", "b", "c", "d"]);
    expect(selectRange(toggle(NO_SELECTION, "d"), visible, "a").ids).toEqual(["d", "a", "b", "c"]);
    // Anchor out of view: a plain toggle.
    expect(selectRange({ active: true, ids: [], anchor: "z" }, visible, "c").ids).toEqual(["c"]);
  });

  it("selects all visible, then none", () => {
    const all = selectAll(NO_SELECTION, visible);
    expect(all.ids).toEqual(visible);
    expect(selectAll(all, visible).ids).toEqual([]);
    expect(selectAll(NO_SELECTION, []).ids).toEqual([]);
  });

  it("prunes ids that are gone and keeps the object when nothing changed", () => {
    const s = selectOnly(["a", "c"]);
    expect(prune(s, visible)).toBe(s);
    expect(prune(s, ["a"])).toEqual({ active: true, ids: ["a"], anchor: null });
  });

  it("finds the card to focus after a delete", () => {
    expect(focusAfterRemoval(visible, ["b", "c"])).toBe("d");
    expect(focusAfterRemoval(visible, ["e"])).toBe("d");
    expect(focusAfterRemoval(["a"], ["a"])).toBeNull();
    expect(focusAfterRemoval(visible, ["x"])).toBeNull();
  });

  it("moves focus in a grid", () => {
    expect(moveFocus(0, 10, 4, "ArrowRight")).toBe(1);
    expect(moveFocus(0, 10, 4, "ArrowLeft")).toBe(0);
    expect(moveFocus(1, 10, 4, "ArrowDown")).toBe(5);
    expect(moveFocus(8, 10, 4, "ArrowDown")).toBe(8);
    expect(moveFocus(5, 10, 4, "ArrowUp")).toBe(1);
    expect(moveFocus(5, 10, 4, "End")).toBe(9);
    expect(moveFocus(5, 10, 4, "Home")).toBe(0);
    expect(moveFocus(0, 0, 4, "Home")).toBe(-1);
  });
});
