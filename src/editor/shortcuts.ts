// Keyboard shortcuts of the Layout tab as a pure mapping from a key press to an editor action.
// The UI owns the window listener; it calls `shortcutAction` and, for a non-null result,
// calls preventDefault and runs the action.
//
// While focus is in a text field only Save works; everything else (including undo/redo) stays
// native to the field, so Cmd+Z undoes typing rather than the layout.

export type Platform = "mac" | "other";

/** Nudge direction on screen: dx > 0 = right, dy > 0 = up (towards the shoulder). */
export type ShortcutAction =
  | { type: "save" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "duplicate" }
  | { type: "delete" }
  | { type: "deselect" }
  | { type: "nudge"; dx: -1 | 0 | 1; dy: -1 | 0 | 1; big: boolean }
  | { type: "layerUp" }
  | { type: "layerDown" }
  | { type: "help" };

export type KeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Whether the event target is a text field (see isEditableTarget). */
  isEditableTarget: boolean;
};

/** Mac by the browser's platform hints (navigator.userAgentData?.platform ?? navigator.platform). */
export function detectPlatform(platformHint: string | undefined | null): Platform {
  return /mac|iphone|ipad|ipod/i.test(platformHint ?? "") ? "mac" : "other";
}

const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
]);

/** Whether an event target takes typing: text inputs, textarea, select, contenteditable. */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = typeof el.type === "string" ? el.type.toLowerCase() : "text";
    return !NON_TEXT_INPUTS.has(type);
  }
  return false;
}

const ARROWS: Record<string, { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: 1 },
  ArrowDown: { dx: 0, dy: -1 },
};

export function shortcutAction(e: KeyInput, platform: Platform): ShortcutAction | null {
  const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
  // The platform's other modifier (Ctrl on a Mac, the Windows key elsewhere) means a different chord.
  const otherMod = platform === "mac" ? e.ctrlKey : e.metaKey;
  if (otherMod) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod) {
    if (e.altKey) return null;
    if (key === "s" && !e.shiftKey) return { type: "save" };
    if (e.isEditableTarget) return null;
    if (key === "z") return e.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "y" && !e.shiftKey) return { type: "redo" };
    if (key === "d" && !e.shiftKey) return { type: "duplicate" };
    return null;
  }

  if (e.isEditableTarget) return null;

  // On German and other layouts [ and ] need Option/AltGr, so Alt is allowed here.
  if (key === "]") return { type: "layerUp" };
  if (key === "[") return { type: "layerDown" };
  if (key === "?") return { type: "help" };

  if (e.altKey) return null;
  if ((key === "Delete" || key === "Backspace") && !e.shiftKey) return { type: "delete" };
  if (key === "Escape" && !e.shiftKey) return { type: "deselect" };
  const arrow = ARROWS[key];
  if (arrow) return { type: "nudge", ...arrow, big: e.shiftKey };
  return null;
}

/** Entries for the "?" help popover. "Mod" in keys stands for Cmd on a Mac and Ctrl elsewhere. */
export const SHORTCUTS: readonly { keys: readonly string[]; description: string }[] = [
  { keys: ["Mod+S"], description: "Save the variant (also while typing)" },
  { keys: ["Mod+Z"], description: "Undo" },
  { keys: ["Shift+Mod+Z", "Mod+Y"], description: "Redo" },
  { keys: ["Mod+D"], description: "Duplicate the selected element" },
  { keys: ["Delete", "Backspace"], description: "Delete the selected element (unless locked)" },
  { keys: ["Esc"], description: "Deselect" },
  { keys: ["←", "→", "↑", "↓"], description: "Nudge the selected element by 0.5 cm" },
  { keys: ["Shift+Arrow"], description: "Nudge by 2 cm" },
  { keys: ["]"], description: "Bring forward one layer" },
  { keys: ["["], description: "Send back one layer" },
  { keys: ["?"], description: "Show these shortcuts" },
];

/** A key label for display: Mod → ⌘ / Ctrl, Shift → ⇧ on a Mac. */
export function formatKeys(keys: string, platform: Platform): string {
  return keys
    .split("+")
    .map((k) => {
      if (k === "Mod") return platform === "mac" ? "⌘" : "Ctrl";
      if (k === "Shift" && platform === "mac") return "⇧";
      return k;
    })
    .join(platform === "mac" ? "" : "+");
}
