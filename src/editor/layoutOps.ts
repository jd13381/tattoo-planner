// Pure layout operations behind the Layout tab's commands (element list, element panel, shortcuts):
// each returns the new layout and the index to select afterwards, so the UI only stores them.
import type { Layout, LayoutElement } from "../layout/schema.ts";
import { reorder, uniqueId } from "./edit.ts";

export type LayoutEdit = { layout: Layout; selected: number | null };

const withElements = (layout: Layout, elements: LayoutElement[]): Layout => ({ ...layout, elements });

/** Removes the element at index; nothing stays selected. */
export function deleteAt(layout: Layout, index: number): LayoutEdit {
  if (index < 0 || index >= layout.elements.length) return { layout, selected: null };
  return {
    layout: withElements(
      layout,
      layout.elements.filter((_, i) => i !== index),
    ),
    selected: null,
  };
}

/** A copy of the element at index with a free id, on top of all others; the copy is selected. */
export function duplicateAt(layout: Layout, index: number): LayoutEdit {
  const el = layout.elements[index];
  if (!el) return { layout, selected: null };
  const copy = {
    ...el,
    id: uniqueId(
      el.id,
      layout.elements.map((e) => e.id),
    ),
  };
  return { layout: withElements(layout, [...layout.elements, copy]), selected: layout.elements.length };
}

/** One layer up (+1, drawn above the next element) or down (-1); the selection follows the element. */
export function moveLayer(layout: Layout, index: number, dir: 1 | -1): LayoutEdit {
  const j = index + dir;
  if (j < 0 || j >= layout.elements.length) return { layout, selected: index };
  return { layout: withElements(layout, reorder(layout.elements, index, dir)), selected: j };
}

/** Moves the element at `from` to layer index `to` (0 = bottom), shifting the ones between. */
export function moveLayerTo(layout: Layout, from: number, to: number): LayoutEdit {
  const n = layout.elements.length;
  if (from < 0 || from >= n) return { layout, selected: null };
  const target = Math.min(n - 1, Math.max(0, to));
  if (target === from) return { layout, selected: from };
  const next = [...layout.elements];
  const [el] = next.splice(from, 1);
  next.splice(target, 0, el!);
  return { layout: withElements(layout, next), selected: target };
}

/**
 * The final layer index (for moveLayerTo) of an element dragged from layer `from` and dropped on the
 * row of layer `over`, above that row (drawn over it) or below it. The list shows the top layer first.
 */
export function dropIndex(from: number, over: number, above: boolean): number {
  const k = over - (from < over ? 1 : 0);
  return above ? k + 1 : k;
}

/** A selection that still points at an element after the list changed (undo, redo), else null. */
export function clampSelection(selected: number | null, count: number): number | null {
  return selected !== null && selected >= 0 && selected < count ? selected : null;
}

/** Variant names the layouts endpoint accepts (src/data/server/layoutsApi.ts). */
export const VARIANT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type VariantNameCheck =
  | { status: "ok"; name: string }
  /** A valid name of an existing variant: saving overwrites it. */
  | { status: "exists"; name: string; message: string }
  | { status: "invalid"; name: string; message: string };

/**
 * Checks a typed variant name for Save as…: trimmed and lowercased, then the server's pattern.
 * `current` is the open variant (saving onto it is a plain Save).
 */
export function checkVariantName(
  raw: string,
  taken: Iterable<string>,
  current?: string | null,
): VariantNameCheck {
  const name = raw.trim().toLowerCase();
  if (name === "") return { status: "invalid", name, message: "Enter a name." };
  if (name.length > 64) return { status: "invalid", name, message: "At most 64 characters." };
  if (!/^[a-z0-9]/.test(name)) return { status: "invalid", name, message: "Start with a letter or a digit." };
  const bad = [...new Set(name.replace(/[a-z0-9-]/g, ""))];
  if (bad.length > 0)
    return {
      status: "invalid",
      name,
      message: `Not allowed: ${bad.map((c) => (c === " " ? "space" : `“${c}”`)).join(", ")}. Use a–z, 0–9 and dashes.`,
    };
  if (!VARIANT_NAME.test(name)) return { status: "invalid", name, message: "Use a–z, 0–9 and dashes." };
  if (name === current) return { status: "exists", name, message: "This is the open variant: same as Save." };
  for (const t of taken)
    if (t === name) return { status: "exists", name, message: `${name} exists and will be overwritten.` };
  return { status: "ok", name };
}

/**
 * What the element list flags with a warning dot: a figure without a set height (drawn 10 cm tall),
 * a figure without a reference image, an asset the manifest does not have, a projection that failed.
 * `assetIds` is null while no manifest is available (then assets are not checked).
 */
export function elementIssues(
  el: LayoutElement,
  flags: readonly string[],
  assetIds: ReadonlySet<string> | null,
  patchIssue?: string,
): string[] {
  const out: string[] = [];
  if (flags.includes("height not set")) out.push("height not set (drawn 10 cm tall)");
  if (el.type === "figure" && !el.asset) out.push("no reference image");
  if ((el.type === "figure" || el.type === "existing") && el.asset && assetIds && !assetIds.has(el.asset))
    out.push(`${el.asset} is not in the manifest`);
  if (patchIssue) out.push(patchIssue);
  return out;
}

/**
 * Groups rapid edits of one target (a field, a nudged element) into one undo step: the same target
 * within `windowMs` of its last edit keeps the burst's id, anything else starts a new burst.
 * Use `${burst.target}#${burst.id}` as the history coalesce key.
 */
export type Burst = { target: string; id: number; at: number };

export const BURST_WINDOW_MS = 1500;

export function nextBurst(
  prev: Burst | null,
  target: string,
  now: number,
  windowMs = BURST_WINDOW_MS,
): Burst {
  if (prev && prev.target === target && now - prev.at <= windowMs) return { ...prev, at: now };
  return { target, id: (prev?.id ?? 0) + 1, at: now };
}

export const burstKey = (b: Burst) => `${b.target}#${b.id}`;
