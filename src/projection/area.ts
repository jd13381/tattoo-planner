// The skin area a projection covers (`patch.u`, `patch.v`; docs/adr/0024-projection-workspace.md,
// "Covered area"). By default it follows what the photos show: along the region from the lowest to the
// highest of each photo's outline ends and marks, around it a quarter turn either side of every facing
// direction. "Hold area" fixes it; an existing projection whose saved area is smaller than what its
// photos show opens on the automatic area. Pure functions, no DOM.
import type { RegionProfile } from "../body/profile.ts";
import { wrapU } from "../body/uv.ts";
import { alongArm, photoFrame, twistReach } from "./model.ts";
import type { PhotoCalibration } from "./schema.ts";

export type SkinArea = { u: [number, number]; v: [number, number] };

/** Margin along the region beyond the outermost outline end or mark, cm. */
export const AREA_MARGIN_CM = 1;
/** Half the u range a photo shows around its facing direction (a quarter turn). */
const VIEW_HALF = 0.25;

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/**
 * The stretch of the region (cm from its start) a calibrated photo shows: from the lowest to the
 * highest of its outline ends and marks, or null when its marks give no frame. `size` is the turned
 * photo in pixels (the points are normalised); unknown, a square is assumed.
 */
export function photoSpan(
  photo: PhotoCalibration,
  size: { width: number; height: number } | null,
  profile: RegionProfile,
): [number, number] | null {
  const { width, height } = size ?? { width: 1, height: 1 };
  const frame = photoFrame(photo, width, height, twistReach(profile));
  if (!frame) return null;
  const pts = [...photo.edges.left, ...photo.edges.right].map((p) =>
    alongArm(frame, { x: p.x * width, y: p.y * height }),
  );
  const all = [...pts, ...photo.along.map((m) => m.cm)].filter(Number.isFinite);
  if (all.length === 0) return null;
  return [Math.min(...all), Math.max(...all)];
}

/** The u directions a photo faces: at the start and, when twisted, at the twist reference. */
export function photoFacings(photo: PhotoCalibration): number[] {
  const { wrist, elbow } = photo.u_view;
  return Math.abs(elbow - wrist) > 1e-6 ? [wrist, elbow] : [wrist];
}

/**
 * The automatic area: what the photos show, with a margin of `AREA_MARGIN_CM` along the region.
 * Null when no photo has a usable frame yet.
 */
export function autoArea(
  photos: readonly { photo: PhotoCalibration; size: { width: number; height: number } | null }[],
  profile: RegionProfile,
): SkinArea | null {
  let lo = Infinity;
  let hi = -Infinity;
  const facings: number[] = [];
  for (const { photo, size } of photos) {
    const span = photoSpan(photo, size, profile);
    if (!span) continue;
    lo = Math.min(lo, span[0]);
    hi = Math.max(hi, span[1]);
    facings.push(...photoFacings(photo));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const L = profile.length;
  const s0 = Math.min(L - 1, Math.max(0, lo - AREA_MARGIN_CM));
  const s1 = Math.min(L, Math.max(s0 + 1, hi + AREA_MARGIN_CM));
  return { u: coveringArc(facings, VIEW_HALF), v: [round4(s0 / L), round4(s1 / L)] };
}

/**
 * Whether `outer` covers `inner` (within `eps`, in u and v units). u ranges may cross u = 0 and are
 * compared once around.
 */
export function areaContains(outer: SkinArea, inner: SkinArea, eps = 2e-3): boolean {
  if (outer.v[0] > inner.v[0] + eps || outer.v[1] < inner.v[1] - eps) return false;
  const ow = outer.u[1] - outer.u[0];
  const iw = inner.u[1] - inner.u[0];
  if (ow >= 1 - eps) return true;
  if (iw > ow + eps) return false;
  let d = wrapU(inner.u[0] - outer.u[0]);
  if (d > 1 - eps) d -= 1;
  return d >= -eps && d + iw <= ow + eps;
}

/**
 * How an existing projection opens: on the automatic area (null) when its saved area does not cover
 * what the photos show (the tattoo would be cut off), else held at the saved area (it may have been
 * widened in Advanced on purpose).
 */
export function openingArea(saved: SkinArea, auto: SkinArea | null): SkinArea | null {
  if (!auto) return saved;
  return areaContains(saved, auto) ? saved : null;
}

/**
 * The shortest u range (u0 < u1, at most once around) covering ±half around every centre. Found as the
 * complement of the largest gap between the covered arcs; u0 may be negative (a range across u = 0).
 */
export function coveringArc(centres: readonly number[], half: number): [number, number] {
  const N = 720;
  const covered = new Uint8Array(N);
  for (const c of centres.length ? centres : [0.5])
    for (let k = 0; k < N; k++) {
      const u = k / N;
      if (Math.abs(wrapU(u - c + 0.5) - 0.5) <= half + 1e-9) covered[k] = 1;
    }
  // Largest run of uncovered samples, wrapping round.
  let bestLen = 0;
  let bestStart = -1;
  for (let k = 0; k < N; k++) {
    if (covered[k] || covered[(k - 1 + N) % N] === 0) continue;
    let len = 0;
    while (len < N && !covered[(k + len) % N]) len++;
    if (len > bestLen) {
      bestLen = len;
      bestStart = k;
    }
  }
  if (bestStart < 0) {
    const c = wrapU(centres[0] ?? 0.5);
    return [round4(c - 0.5), round4(c + 0.5)];
  }
  // Covered from the end of the gap round to its start.
  const u0 = (bestStart + bestLen) / N;
  const end = (bestStart - 1 + N) % N; // the last covered sample
  const u1 = end / N + (end / N < u0 ? 1 : 0);
  // Keep u0 in -0.5…0.5 so ranges read naturally (0.1…0.78, or -0.2…0.3 across the u = 0 line).
  const shift = u0 > 0.5 ? -1 : 0;
  return [round4(u0 + shift), round4(u1 + shift)];
}
