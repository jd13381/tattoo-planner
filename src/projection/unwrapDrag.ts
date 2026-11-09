// Direct correction on the unwrap (docs/adr/0024-projection-workspace.md, "Correction on the unwrap"):
// the projection workspace's unwrap crop maps to skin points and back, and dragging there corrects the
// current photo's calibration instead of its points on the photo. Dragging sideways turns which side
// faces the camera, up and down shifts the marks' distances, the top and bottom handles stretch them;
// the arrow keys nudge by 0.1 cm (Shift: 1 cm). Pure maths, no DOM.
import type { RegionProfile } from "../body/profile.ts";
import { screenSign, wrapU } from "../body/uv.ts";
import type { DraftPhoto } from "./draft.ts";

/** How the unwrap crop is drawn: as renderUnwrap draws it, minus `top` rows cut off above. */
export type UnwrapView = {
  profile: Pick<RegionProfile, "length" | "maxCircumference" | "circumferenceAt" | "mirrored">;
  pxPerCm: number;
  /** u in the middle of the crop. */
  centerU: number;
  /** Rows cut off above (the crop starts lower than the region's end), px. */
  top: number;
};

/** u - c wrapped into -0.5 … 0.5. */
export const wrapDelta = (d: number) => wrapU(d + 0.5) - 0.5;

/** Crop pixel of a skin point (u, s cm from the region's start). */
export function skinToUnwrap(view: UnwrapView, u: number, s: number): { x: number; y: number } {
  const { profile, pxPerCm: ppc } = view;
  const W = Math.ceil(profile.maxCircumference * ppc);
  const c = profile.circumferenceAt(Math.min(profile.length, Math.max(0, s)));
  return {
    x: W / 2 + screenSign(profile) * wrapDelta(u - view.centerU) * c * ppc,
    y: (profile.length - s) * ppc - view.top,
  };
}

/** Skin point (u not wrapped, s cm) of a crop pixel. */
export function unwrapToSkin(view: UnwrapView, x: number, y: number): { u: number; s: number } {
  const { profile, pxPerCm: ppc } = view;
  const W = Math.ceil(profile.maxCircumference * ppc);
  const s = profile.length - (y + view.top) / ppc;
  const c = profile.circumferenceAt(Math.min(profile.length, Math.max(0, s)));
  return { u: view.centerU + (screenSign(profile) * (x - W / 2)) / (c * ppc), s };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The photo seen from a side turned by `du` (both facings, so a twist stays). */
export function turnFacing(photo: DraftPhoto, du: number): DraftPhoto {
  if (du === 0) return photo;
  return {
    ...photo,
    facing: round4(wrapU(photo.facing + du)),
    facingFar: round4(wrapU(photo.facingFar + du)),
    facingSet: true,
  };
}

/** Both marks `dcm` further along the region; stops where the lower one would go below the start. */
export function shiftAlong(photo: DraftPhoto, dcm: number): DraftPhoto {
  const low = Math.min(photo.marks[0].cm, photo.marks[1].cm);
  const d = Math.max(dcm, -low);
  if (d === 0) return photo;
  return {
    ...photo,
    marks: [
      { ...photo.marks[0], cm: round2(photo.marks[0].cm + d) },
      { ...photo.marks[1], cm: round2(photo.marks[1].cm + d) },
    ],
  };
}

/**
 * The marks' distances stretched by `k` around `anchor` cm (the tattoo gets longer for k > 1). The
 * marks stay at least 1 cm apart and not below the start.
 */
export function scaleAlong(photo: DraftPhoto, anchor: number, k: number): DraftPhoto {
  const [a, b] = photo.marks;
  const gap = Math.abs(b.cm - a.cm);
  const kk = Math.max(k, gap > 0 ? 1 / gap : 1, 0.05);
  let ca = anchor + (a.cm - anchor) * kk;
  let cb = anchor + (b.cm - anchor) * kk;
  const low = Math.min(ca, cb);
  if (low < 0) {
    ca -= low;
    cb -= low;
  }
  return { ...photo, marks: [{ ...a, cm: round2(ca) }, { ...b, cm: round2(cb) }] };
}

export type DragMode = "move" | "top" | "bottom";

/**
 * The photo after dragging on the unwrap from skin point `from` to `to` (u, s): "move" turns and
 * shifts it, "top" / "bottom" stretch it with the other end of `span` (its stretch along the region,
 * cm) fixed.
 */
export function dragPhoto(
  photo: DraftPhoto,
  mode: DragMode,
  from: { u: number; s: number },
  to: { u: number; s: number },
  span: [number, number],
): DraftPhoto {
  const ds = to.s - from.s;
  if (mode === "move") return shiftAlong(turnFacing(photo, round4(wrapDelta(to.u - from.u))), round2(ds));
  const [s0, s1] = span;
  const len = s1 - s0;
  if (!(len > 0)) return photo;
  return mode === "top"
    ? scaleAlong(photo, s0, Math.max(0.05, (len + ds) / len))
    : scaleAlong(photo, s1, Math.max(0.05, (len - ds) / len));
}

/**
 * Arrow keys on the unwrap: up/down shift the marks 0.1 cm (Shift: 1 cm), left/right turn the photo by
 * as much skin at `atS` cm. `sign` is the unwrap's screen direction of growing u (uv.ts screenSign).
 */
export function nudgePhoto(
  photo: DraftPhoto,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  big: boolean,
  circumference: number,
  sign: 1 | -1,
): DraftPhoto {
  const cm = big ? 1 : 0.1;
  switch (key) {
    case "ArrowUp":
      return shiftAlong(photo, cm);
    case "ArrowDown":
      return shiftAlong(photo, -cm);
    case "ArrowLeft":
      return turnFacing(photo, round4((-sign * cm) / circumference));
    case "ArrowRight":
      return turnFacing(photo, round4((sign * cm) / circumference));
  }
}

/**
 * The outline of a skin area (u range, s range in cm) on the unwrap, as polylines in crop pixels:
 * split where it crosses the seam, so nothing is drawn across the whole picture.
 */
export function areaOutline(
  view: UnwrapView,
  u: [number, number],
  s: [number, number],
  steps = 48,
): { x: number; y: number }[][] {
  const pts: { u: number; s: number }[] = [];
  const along = (a: number, b: number, f: (t: number) => { u: number; s: number }) => {
    for (let k = 0; k < steps; k++) pts.push(f(a + ((b - a) * k) / steps));
  };
  along(0, 1, (t) => ({ u: u[0] + t * (u[1] - u[0]), s: s[0] }));
  along(0, 1, (t) => ({ u: u[1], s: s[0] + t * (s[1] - s[0]) }));
  along(0, 1, (t) => ({ u: u[1] - t * (u[1] - u[0]), s: s[1] }));
  along(0, 1, (t) => ({ u: u[0], s: s[1] - t * (s[1] - s[0]) }));
  pts.push(pts[0]!);
  const W = Math.ceil(view.profile.maxCircumference * view.pxPerCm);
  const lines: { x: number; y: number }[][] = [[]];
  let prev: { x: number; y: number } | null = null;
  for (const p of pts) {
    const q = skinToUnwrap(view, p.u, p.s);
    if (prev && Math.abs(q.x - prev.x) > W / 2) lines.push([]);
    lines.at(-1)!.push(q);
    prev = q;
  }
  return lines.filter((l) => l.length > 1);
}
