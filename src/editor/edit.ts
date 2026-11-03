// Pure editing operations on layout elements, used by the unwrap editor.
import { wrapU } from "../arm/uv.ts";
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
    case "filler": {
      const span = el.region.v[1] - el.region.v[0];
      const v0 = round(Math.min(1 - span, Math.max(0, el.region.v[0] + dv)));
      return {
        ...el,
        region: {
          u: [round(wrapU(el.region.u[0] + du)), round(wrapU(el.region.u[1] + du))],
          v: [v0, round(v0 + span)],
        },
      };
    }
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

/** Scales a figure's height (and width, when set) by a factor. */
export function scaleFigure(el: LayoutElement, factor: number): LayoutElement {
  if (el.type !== "figure" && el.type !== "existing") return el;
  const h = el.size_cm.h;
  if (h === null) return el;
  const w = el.size_cm.w;
  return {
    ...el,
    size_cm: {
      ...el.size_cm,
      h: round(Math.max(0.5, h * factor), 1),
      ...(w ? { w: round(Math.max(0.5, w * factor), 1) } : {}),
    },
  };
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const ids = new Set(taken);
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

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
      return { id, type, position: at, size_cm: { h: 10 } };
    case "existing":
      return { id, type, position: at, size_cm: { h: 10 }, locked: true };
    case "filler":
      return {
        id,
        type,
        pattern: "snake-scales",
        region: {
          u: [round(wrapU(u - 0.05)), round(wrapU(u + 0.05))],
          v: [round(Math.max(0, v - 0.1)), round(Math.min(1, v + 0.1))],
        },
        density: 0.3,
      };
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
