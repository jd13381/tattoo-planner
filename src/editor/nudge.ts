// Nudging elements by centimetres on the skin, and reading their position back in cm.
// u is a fraction of the local circumference, so 1 cm around is a different du at the wrist
// than at the shoulder; v is a fraction of the arm length (src/arm/uv.ts).
//
// Directions are those of the unwrap editor (UnwrapEditor.tsx): seen from outside the arm,
// screen right is screen x = -du * circumference, whichever side is centred; up is towards the shoulder.
import type { ArmProfile } from "../arm/profile.ts";
import { uToCm, wrapU } from "../arm/uv.ts";
import type { LayoutElement } from "../layout/schema.ts";
import { moveElement } from "./edit.ts";

/** Arrow-key step in cm. */
export const NUDGE_CM = 0.5;
/** Shift+arrow step in cm. */
export const NUDGE_BIG_CM = 2;

export type UV = { u: number; v: number };

/** The (du, dv) that moves a point at row v by dxCm right and dyCm up on the unwrap. */
export function cmToDelta(
  profile: ArmProfile,
  v: number,
  dxCm: number,
  dyCm: number,
): { du: number; dv: number } {
  const c = profile.circumferenceAt(Math.min(1, Math.max(0, v)) * profile.length);
  return { du: c > 0 ? -dxCm / c : 0, dv: profile.length > 0 ? dyCm / profile.length : 0 };
}

/** A point moved by dxCm right and dyCm up; u wraps, v stays on the arm. Unrounded. */
export function nudgeUV(profile: ArmProfile, p: UV, dxCm: number, dyCm: number): UV {
  const { du, dv } = cmToDelta(profile, p.v, dxCm, dyCm);
  return { u: wrapU(p.u + du), v: Math.min(1, Math.max(0, p.v + dv)) };
}

/**
 * The point an element is measured from: a figure's position, a filler region's centre,
 * a band's line (u = 0), a line's first point u with its mean v.
 */
export function elementAnchor(el: LayoutElement): UV {
  switch (el.type) {
    case "figure":
    case "existing":
      return el.position;
    case "filler": {
      const span = wrapU(el.region.u[1] - el.region.u[0]);
      return { u: wrapU(el.region.u[0] + span / 2), v: (el.region.v[0] + el.region.v[1]) / 2 };
    }
    case "band":
      return { u: 0, v: el.v };
    case "line": {
      const pts = el.points;
      const v = pts.reduce((s, p) => s + p.v, 0) / Math.max(1, pts.length);
      return { u: pts[0]?.u ?? 0, v };
    }
  }
}

/**
 * The element moved by dxCm right and dyCm up on the unwrap, with the cm-to-u scale taken at its
 * anchor row. Goes through moveElement, so it wraps, clamps and rounds the same way as a drag
 * (3 decimals: a 0.5 cm step along the arm can land a few mm short on a long arm).
 */
export function nudgeElement(
  el: LayoutElement,
  profile: ArmProfile,
  dxCm: number,
  dyCm: number,
): LayoutElement {
  const { du, dv } = cmToDelta(profile, elementAnchor(el).v, dxCm, dyCm);
  return moveElement(el, du, dv);
}

/** Arrow direction (dx right, dy up, as in shortcuts.ts) and Shift to a cm offset. */
export function nudgeStepCm(dx: number, dy: number, big: boolean): { dxCm: number; dyCm: number } {
  const step = big ? NUDGE_BIG_CM : NUDGE_CM;
  return { dxCm: dx * step, dyCm: dy * step };
}

export type PositionCm = {
  /** Distance around the arm from the outer centre line, cm (always ≥ 0). */
  aroundCm: number;
  /** Which way from the outer line; "outer" when on it. */
  side: "lateral" | "medial" | "outer";
  /** Distance along the arm axis from the wrist crease, cm. */
  fromWristCm: number;
};

export function positionCm(profile: ArmProfile, p: UV): PositionCm {
  const around = uToCm(profile, p.u, p.v);
  const aroundCm = Math.round(Math.abs(around) * 10) / 10;
  return {
    aroundCm,
    side: aroundCm === 0 ? "outer" : around > 0 ? "lateral" : "medial",
    fromWristCm: Math.round(p.v * profile.length * 10) / 10,
  };
}

/**
 * A read-only label for the element panel, e.g. "≈ 3.2 cm lateral of the outer line · 12.4 cm from the wrist".
 * Bands only get the distance from the wrist, since they run all the way round.
 */
export function formatPositionCm(profile: ArmProfile, el: LayoutElement): string {
  const pos = positionCm(profile, elementAnchor(el));
  const along = `${pos.fromWristCm.toFixed(1)} cm from the wrist`;
  if (el.type === "band") return `≈ ${along}`;
  const around =
    pos.side === "outer"
      ? "on the outer line"
      : `${pos.aroundCm.toFixed(1)} cm ${pos.side} of the outer line`;
  return `≈ ${around} · ${along}`;
}
