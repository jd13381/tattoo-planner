// Nudging elements by centimetres on the skin, and reading their position back in cm.
// u is a fraction of the local circumference, so 1 cm around is a different du at the wrist
// than at the shoulder; v is a fraction of the arm length (src/body/uv.ts).
//
// Directions are those of the unwrap editor (UnwrapEditor.tsx): seen from outside the skin,
// screen x = screenSign * du * circumference (on the left arm -du: right is medial), whichever side is
// centred; up is towards the region's end (the shoulder on arms).
import type { RegionProfile } from "../body/profile.ts";
import { REGIONS, type CentreLines } from "../body/regions.ts";
import { screenSign, uToCm, wrapU } from "../body/uv.ts";
import type { LayoutElement } from "../layout/schema.ts";
import { moveElement } from "./edit.ts";

/** Arrow-key step in cm. */
export const NUDGE_CM = 0.5;
/** Shift+arrow step in cm. */
export const NUDGE_BIG_CM = 2;

export type UV = { u: number; v: number };

/** The (du, dv) that moves a point at row v by dxCm right and dyCm up on the unwrap. */
export function cmToDelta(
  profile: RegionProfile,
  v: number,
  dxCm: number,
  dyCm: number,
): { du: number; dv: number } {
  const c = profile.circumferenceAt(Math.min(1, Math.max(0, v)) * profile.length);
  return {
    du: c > 0 ? (screenSign(profile) * dxCm) / c : 0,
    dv: profile.length > 0 ? dyCm / profile.length : 0,
  };
}

/** A point moved by dxCm right and dyCm up; u wraps, v stays on the arm. Unrounded. */
export function nudgeUV(profile: RegionProfile, p: UV, dxCm: number, dyCm: number): UV {
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
  profile: RegionProfile,
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

export function positionCm(profile: RegionProfile, p: UV): PositionCm {
  const around = uToCm(profile, p.u, p.v);
  const aroundCm = Math.round(Math.abs(around) * 10) / 10;
  return {
    aroundCm,
    side: aroundCm === 0 ? "outer" : around > 0 ? "lateral" : "medial",
    fromWristCm: Math.round(p.v * profile.length * 10) / 10,
  };
}

/** How a region names its centre lines and its start, for the readouts (src/body/regions.ts). */
export type RegionNames = { lines: CentreLines; start: string };
const ARM_NAMES: RegionNames = { lines: REGIONS["arm-left"].lines, start: REGIONS["arm-left"].ends[0] };

/** "lateral" on arms (the line names are directions there), "towards front" elsewhere. */
function sideWord(side: PositionCm["side"], names: RegionNames): string {
  const line = side === "lateral" ? names.lines[1] : names.lines[3];
  return names.lines[1] === "lateral" ? line : `towards ${line}`;
}

/**
 * A read-only label for the element panel, e.g. "≈ 3.2 cm lateral of the outer line · 12.4 cm from the wrist".
 * Bands only get the distance from the wrist, since they run all the way round.
 */
export function formatPositionCm(profile: RegionProfile, el: LayoutElement, names = ARM_NAMES): string {
  const pos = positionCm(profile, elementAnchor(el));
  const along = `${pos.fromWristCm.toFixed(1)} cm from the ${names.start}`;
  if (el.type === "band") return `≈ ${along}`;
  const around =
    pos.side === "outer"
      ? `on the ${names.lines[0]} line`
      : `${pos.aroundCm.toFixed(1)} cm ${sideWord(pos.side, names)} of the ${names.lines[0]} line`;
  return `≈ ${around} · ${along}`;
}

/** A compact cursor readout for the status bar, e.g. "3.6 cm lateral · 53.3 cm from wrist". */
export function formatPointCm(profile: RegionProfile, p: UV, names = ARM_NAMES): string {
  const pos = positionCm(profile, p);
  const around =
    pos.side === "outer"
      ? `on the ${names.lines[0]} line`
      : `${pos.aroundCm.toFixed(1)} cm ${sideWord(pos.side, names)}`;
  return `${around} · ${pos.fromWristCm.toFixed(1)} cm from ${names.start}`;
}

/** The readout names of a region. */
export function regionNames(id: keyof typeof REGIONS): RegionNames {
  const r = REGIONS[id];
  return id === "arm-left" ? ARM_NAMES : { lines: r.lines, start: r.ends[0] };
}
