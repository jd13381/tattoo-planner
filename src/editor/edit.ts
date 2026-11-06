// Pure editing operations on layout elements, used by the unwrap editor.
import { wrapU } from "../body/uv.ts";
import type { ElementType, LayoutElement } from "../layout/schema.ts";

const round = (n: number, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Moves an element by du (around) and dv (along). u wraps around the arm, v stays on the arm. */
export function moveElement(el: LayoutElement, du: number, dv: number): LayoutElement {
  switch (el.type) {
    case "figure":
    case "existing":
      return {
        ...el,
        position: { u: round(wrapU(el.position.u + du)), v: round(clamp01(el.position.v + dv)) },
      };
    case "band":
      return { ...el, v: round(clamp01(el.v + dv)) };
    case "line":
      return {
        ...el,
        points: el.points.map((p) => ({ u: round(wrapU(p.u + du)), v: round(clamp01(p.v + dv)) })),
      };
  }
}

export function movePoint(el: LayoutElement, index: number, u: number, v: number): LayoutElement {
  if (el.type !== "line") return el;
  return {
    ...el,
    points: el.points.map((p, i) => (i === index ? { u: round(wrapU(u)), v: round(clamp01(v)) } : p)),
  };
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const ids = new Set(taken);
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Size of a new figure or existing tattoo, in cm. */
export const NEW_FIGURE_SIZE_CM = { h: 10, w: 6 } as const;

/** A new element of the given type at (u, v), with neutral starting values to be edited. */
export function newElement(
  type: ElementType,
  u: number,
  v: number,
  takenIds: Iterable<string>,
): LayoutElement {
  const id = uniqueId(`new-${type}`, takenIds);
  const at = { u: round(wrapU(u)), v: round(v) };
  switch (type) {
    case "figure":
    case "existing":
      return { id, type, position: at, size_cm: { ...NEW_FIGURE_SIZE_CM } };
    case "band":
      return { id, type, pattern: "meander", v: at.v, width_cm: 2 };
    case "line":
      return {
        id,
        type,
        color: "red",
        points: [
          { u: at.u, v: round(Math.max(0, v - 0.15)) },
          { u: at.u, v: round(Math.min(1, v + 0.15)) },
        ],
        width_cm: 1,
      };
  }
}

/** Moves the element at index one layer up (+1) or down (-1). */
export function reorder<T>(items: T[], index: number, dir: 1 | -1): T[] {
  const j = index + dir;
  if (j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[index], next[j]] = [next[j]!, next[index]!];
  return next;
}

/** A free name for a copy of variant `base`: v1-baseline → v1-baseline-2, try-3 → try-4. */
export function suggestVariantName(base: string, taken: Iterable<string>): string {
  const ids = new Set(taken);
  const m = /^(.*?)-(\d+)$/.exec(base);
  const stem = m ? m[1]! : base;
  let n = m ? Number(m[2]) + 1 : 2;
  while (ids.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/** Step between new elements added at the same spot: u around the arm, v along it. */
export const NEW_ELEMENT_STEP = { u: 0.04, v: -0.04 } as const;

/**
 * Where to add a new element near (u, v): the spot itself, or the first spot along a diagonal
 * (NEW_ELEMENT_STEP) that no existing element is anchored at, so new elements do not stack.
 */
export function freeSpot(
  anchors: readonly { u: number; v: number }[],
  u: number,
  v: number,
  maxSteps = 12,
): { u: number; v: number } {
  const near = (a: { u: number; v: number }, b: { u: number; v: number }) =>
    Math.abs(wrapU(a.u - b.u + 0.5) - 0.5) < 0.015 && Math.abs(a.v - b.v) < 0.015;
  for (let k = 0; k <= maxSteps; k++) {
    const p = { u: round(wrapU(u + k * NEW_ELEMENT_STEP.u)), v: round(clamp01(v + k * NEW_ELEMENT_STEP.v)) };
    if (!anchors.some((a) => near(a, p))) return p;
  }
  return { u: round(wrapU(u)), v: round(clamp01(v)) };
}

/** The colour a line is drawn in when it names none or "red" (render/reference.ts SLEEVE_RED). */
export const LINE_RED_HEX = "#c62828";

/** Swatches next to the line colour picker; "red" is stored by name, as in the brief. */
export const LINE_SWATCHES = [
  { value: "red", label: "Red" },
  { value: "#1d1b19", label: "Black" },
  { value: "#6e6a66", label: "Grey" },
  { value: "#2f5fb3", label: "Blue" },
] as const;

/** A line colour as #rrggbb for <input type="color">: red and unknown names become the sleeve red. */
export function colorToHex(color: string | undefined): string {
  if (!color || color === "red") return LINE_RED_HEX;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (color === "black") return "#000000";
  return LINE_RED_HEX;
}
