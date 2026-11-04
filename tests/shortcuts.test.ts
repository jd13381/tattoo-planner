import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  formatKeys,
  isEditableTarget,
  shortcutAction,
  SHORTCUTS,
  type KeyInput,
} from "../src/editor/shortcuts.ts";

const press = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  isEditableTarget: false,
  ...mods,
});

describe("shortcutAction", () => {
  it("maps Mod chords per platform", () => {
    expect(shortcutAction(press("s", { metaKey: true }), "mac")).toEqual({ type: "save" });
    expect(shortcutAction(press("s", { ctrlKey: true }), "other")).toEqual({ type: "save" });
    expect(shortcutAction(press("s", { ctrlKey: true }), "mac")).toBeNull();
    expect(shortcutAction(press("s", { metaKey: true }), "other")).toBeNull();
    expect(shortcutAction(press("z", { metaKey: true }), "mac")).toEqual({ type: "undo" });
    expect(shortcutAction(press("d", { metaKey: true }), "mac")).toEqual({ type: "duplicate" });
  });

  it("maps both redo chords, also with an upper-case key", () => {
    expect(shortcutAction(press("Z", { metaKey: true, shiftKey: true }), "mac")).toEqual({ type: "redo" });
    expect(shortcutAction(press("z", { ctrlKey: true, shiftKey: true }), "other")).toEqual({ type: "redo" });
    expect(shortcutAction(press("y", { ctrlKey: true }), "other")).toEqual({ type: "redo" });
  });

  it("keeps only Save while typing", () => {
    const typing = { isEditableTarget: true };
    expect(shortcutAction(press("s", { metaKey: true, ...typing }), "mac")).toEqual({ type: "save" });
    for (const k of ["z", "y", "d"])
      expect(shortcutAction(press(k, { metaKey: true, ...typing }), "mac")).toBeNull();
    for (const k of ["Delete", "Backspace", "Escape", "ArrowLeft", "[", "]", "?"])
      expect(shortcutAction(press(k, typing), "mac")).toBeNull();
  });

  it("maps plain keys", () => {
    expect(shortcutAction(press("Delete"), "mac")).toEqual({ type: "delete" });
    expect(shortcutAction(press("Backspace"), "other")).toEqual({ type: "delete" });
    expect(shortcutAction(press("Escape"), "mac")).toEqual({ type: "deselect" });
    expect(shortcutAction(press("]"), "mac")).toEqual({ type: "layerUp" });
    expect(shortcutAction(press("["), "mac")).toEqual({ type: "layerDown" });
    expect(shortcutAction(press("?", { shiftKey: true }), "mac")).toEqual({ type: "help" });
  });

  it("accepts [ and ] typed with Option/AltGr", () => {
    expect(shortcutAction(press("[", { altKey: true }), "mac")).toEqual({ type: "layerDown" });
  });

  it("maps arrows to nudges, Shift for a big step", () => {
    expect(shortcutAction(press("ArrowRight"), "mac")).toEqual({ type: "nudge", dx: 1, dy: 0, big: false });
    expect(shortcutAction(press("ArrowUp", { shiftKey: true }), "mac")).toEqual({
      type: "nudge",
      dx: 0,
      dy: 1,
      big: true,
    });
    expect(shortcutAction(press("ArrowDown"), "other")).toMatchObject({ dy: -1 });
    expect(shortcutAction(press("ArrowLeft"), "other")).toMatchObject({ dx: -1 });
  });

  it("ignores other keys and Alt chords", () => {
    expect(shortcutAction(press("a"), "mac")).toBeNull();
    expect(shortcutAction(press("x", { metaKey: true }), "mac")).toBeNull();
    expect(shortcutAction(press("s", { metaKey: true, altKey: true }), "mac")).toBeNull();
    expect(shortcutAction(press("ArrowLeft", { altKey: true }), "mac")).toBeNull();
    expect(shortcutAction(press("ArrowLeft", { metaKey: true }), "mac")).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("detects text fields", () => {
    expect(isEditableTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isEditableTarget({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isEditableTarget({ tagName: "input" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("leaves buttons, checkboxes and the rest alone", () => {
    expect(isEditableTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "svg", isContentEditable: false })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(windowLike())).toBe(false);
  });
});

function windowLike() {
  return { addEventListener: () => undefined };
}

describe("platform and labels", () => {
  it("detects a Mac", () => {
    expect(detectPlatform("MacIntel")).toBe("mac");
    expect(detectPlatform("macOS")).toBe("mac");
    expect(detectPlatform("Win32")).toBe("other");
    expect(detectPlatform(undefined)).toBe("other");
  });

  it("formats key labels", () => {
    expect(formatKeys("Shift+Mod+Z", "mac")).toBe("⇧⌘Z");
    expect(formatKeys("Shift+Mod+Z", "other")).toBe("Shift+Ctrl+Z");
    expect(formatKeys("Delete", "mac")).toBe("Delete");
  });

  it("lists every action in the help", () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(10);
    for (const s of SHORTCUTS) expect(s.description).toMatch(/^[A-Z]/);
  });
});
