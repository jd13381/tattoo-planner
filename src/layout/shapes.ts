// Turns layout elements into shapes on the unwrap and tests which element covers a point of skin.
// Unwrap cm: x from the outer centre line (lateral positive, as src/arm/uv.ts), y from the wrist crease.
import type { ArmProfile } from "../arm/profile.ts";
import { uToCm, wrapU } from "../arm/uv.ts";
import type { ElementAspects } from "./imageFit.ts";
import type { Layout, LayoutElement } from "./schema.ts";

/** Sizes used when a figure has no size yet; the UI lists every element that uses one. */
export const PLACEHOLDER_HEIGHT_CM = 10;
/** Figures without an explicit width get this width-to-height ratio (a tall, narrow figure). */
export const DEFAULT_ASPECT = 0.55;

export type ExistingSize = { height: number | null; width: number | null };

export type Shape =
  | { kind: "box"; uc: number; cx: number; cy: number; w: number; h: number; rot: number }
  | { kind: "region"; u0: number; u1: number; y0: number; y1: number }
  | { kind: "band"; y: number; half: number }
  | { kind: "line"; points: { u: number; y: number }[]; half: number };

export type ResolvedElement = { element: LayoutElement; shape: Shape; flags: string[] };

/** Signed shortest difference between two u values, in -0.5…0.5. */
export function wrapDelta(du: number): number {
  return wrapU(du + 0.5) - 0.5;
}

export function resolveElement(
  el: LayoutElement,
  profile: ArmProfile,
  existing?: ExistingSize,
  /** Width / height of the element's upright image cut-out, when known (src/layout/imageFit.ts). */
  imageAspect?: number,
): ResolvedElement {
  const L = profile.length;
  const flags: string[] = [];
  switch (el.type) {
    case "figure":
    case "existing": {
      let h = el.size_cm.h;
      let w = el.size_cm.w ?? null;
      if (el.type === "existing") {
        h ??= existing?.height ?? null;
        w ??= existing?.width ?? null;
      }
      if (h === null) {
        h = PLACEHOLDER_HEIGHT_CM;
        flags.push("height not set");
      }
      // Without a width the box takes the image's proportions, in every mode, so the blockout,
      // the metrics and the reference picture all use the same box.
      if (w === null && imageAspect !== undefined && imageAspect > 0) w = h * imageAspect;
      if (w === null) {
        w = h * DEFAULT_ASPECT;
        flags.push("width assumed");
      }
      const cy = el.position.v * L;
      return {
        element: el,
        shape: {
          kind: "box",
          uc: el.position.u,
          cx: uToCm(profile, el.position.u, el.position.v),
          cy,
          w,
          h,
          rot: ((el.rotation_deg ?? 0) * Math.PI) / 180,
        },
        flags,
      };
    }
    case "filler":
      return {
        element: el,
        shape: {
          kind: "region",
          u0: el.region.u[0],
          u1: el.region.u[1],
          y0: el.region.v[0] * L,
          y1: el.region.v[1] * L,
        },
        flags,
      };
    case "band":
      return { element: el, shape: { kind: "band", y: el.v * L, half: el.width_cm / 2 }, flags };
    case "line":
      return {
        element: el,
        shape: {
          kind: "line",
          points: el.points.map((p) => ({ u: p.u, y: p.v * L })),
          half: el.width_cm / 2,
        },
        flags,
      };
  }
}

/** Whether a skin point (u, y in cm, local circumference c) lies inside the shape. */
export function hits(shape: Shape, u: number, y: number, c: number): boolean {
  switch (shape.kind) {
    case "box": {
      // Screen frame of the unwrap seen from outside: right = medial, so screen x = -cm x.
      const sx = -wrapDelta(u - shape.uc) * c;
      const sy = y - shape.cy;
      const cos = Math.cos(shape.rot);
      const sin = Math.sin(shape.rot);
      const lx = Math.abs(sx * cos + sy * sin);
      const ly = Math.abs(-sx * sin + sy * cos);
      const hw = shape.w / 2;
      const hh = shape.h / 2;
      if (lx > hw || ly > hh) return false;
      // Rounded corners make the blockout read as a figure rather than a card.
      const r = Math.min(hw, hh) * 0.5;
      const qx = lx - (hw - r);
      const qy = ly - (hh - r);
      return qx <= 0 || qy <= 0 || qx * qx + qy * qy <= r * r;
    }
    case "region": {
      if (y < shape.y0 || y > shape.y1) return false;
      const span = wrapU(shape.u1 - shape.u0) || (shape.u1 !== shape.u0 ? 1 : 0);
      return wrapU(u - shape.u0) <= span;
    }
    case "band":
      return Math.abs(y - shape.y) <= shape.half;
    case "line": {
      const pts = shape.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = wrapDelta(pts[i]!.u - u) * c;
        const ay = pts[i]!.y - y;
        // Unwrap the segment from its first point, so it never jumps across the seam.
        const bx = ax + wrapDelta(pts[i + 1]!.u - pts[i]!.u) * c;
        const by = pts[i + 1]!.y - y;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
        const px = ax + t * dx;
        const py = ay + t * dy;
        if (px * px + py * py <= shape.half * shape.half) return true;
      }
      return false;
    }
  }
}

export const OUTSIDE = 255;

export type Classification = {
  pxPerCm: number;
  centerU: number;
  width: number;
  height: number;
  /** Per pixel, row 0 = shoulder: 0 = open skin, i + 1 = topmost element i, OUTSIDE = not skin. */
  cells: Uint8Array;
  resolved: ResolvedElement[];
};

/**
 * Rasterises the layout on the unwrap: which element is on top at every pixel of skin.
 * `centerU` is the line in the middle of the image: 0 (outer, the texture) or 0.5 (inner, for editing
 * pieces that sit on the seam).
 */
export function classify(
  layout: Layout,
  profile: ArmProfile,
  pxPerCm: number,
  existing?: ExistingSize,
  centerU = 0,
  aspects?: ElementAspects,
): Classification {
  const resolved = layout.elements.map((el) => resolveElement(el, profile, existing, aspects?.get(el.id)));
  const width = Math.ceil(profile.maxCircumference * pxPerCm);
  const height = Math.ceil(profile.length * pxPerCm);
  const cells = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const y = profile.length - (j + 0.5) / pxPerCm;
    const c = profile.circumferenceAt(y);
    for (let i = 0; i < width; i++) {
      const sx = (i + 0.5) / pxPerCm - profile.maxCircumference / 2;
      const x = -sx; // lateral positive
      let value = OUTSIDE;
      if (Math.abs(x) <= c / 2) {
        value = 0;
        const u = wrapU(centerU + x / c);
        for (let k = resolved.length - 1; k >= 0; k--) {
          if (hits(resolved[k]!.shape, u, y, c)) {
            value = Math.min(k + 1, OUTSIDE - 1);
            break;
          }
        }
      }
      cells[j * width + i] = value;
    }
  }
  return { pxPerCm, centerU, width, height, cells, resolved };
}
