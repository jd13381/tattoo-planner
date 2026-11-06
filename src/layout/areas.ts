// Geometry of background layers (docs/adr/0019): which skin a layer covers. Framework-free.
// Area shapes are given in layout coordinates (u around, v along) with sizes in cm on the skin, like
// figures; the painted mask is a list of round-brush strokes, applied in order after the shapes
// (paint adds, erase removes). Hit tests take a skin point (u, y in cm from the region's start) and
// the local circumference c, like src/layout/shapes.ts.
import type { RegionProfile } from "../body/profile.ts";
import { screenSign, wrapU } from "../body/uv.ts";
import type { AreaShape, BackgroundLayer, Layout, MaskStroke } from "./schema.ts";

/** Signed shortest difference between two u values (as in shapes.ts, kept here to avoid an import cycle). */
const wrapDelta = (du: number) => wrapU(du + 0.5) - 0.5;

export type ResolvedArea =
  | {
      kind: "rect" | "ellipse";
      uc: number;
      cy: number;
      w: number;
      h: number;
      rot: number;
      sign: 1 | -1;
    }
  | { kind: "polygon"; points: { u: number; y: number }[] }
  | { kind: "span"; u0: number; u1: number; y0: number; y1: number };

export type ResolvedStroke = { erase: boolean; half: number; points: { u: number; y: number }[] };

export type ResolvedLayer = {
  layer: BackgroundLayer;
  /** null = the whole region. */
  shapes: ResolvedArea[] | null;
  strokes: ResolvedStroke[];
  /** Rows (cm from the start) the area can touch; the whole region for "region". */
  y0: number;
  y1: number;
};

export function resolveArea(shape: AreaShape, profile: RegionProfile): ResolvedArea {
  const L = profile.length;
  switch (shape.kind) {
    case "rect":
    case "ellipse":
      return {
        kind: shape.kind,
        uc: wrapU(shape.u),
        cy: shape.v * L,
        w: shape.w_cm,
        h: shape.h_cm,
        rot: ((shape.rotation_deg ?? 0) * Math.PI) / 180,
        sign: screenSign(profile),
      };
    case "polygon":
      return { kind: "polygon", points: shape.points.map((p) => ({ u: p.u, y: p.v * L })) };
    case "span":
      return { kind: "span", u0: shape.u[0], u1: shape.u[1], y0: shape.v[0] * L, y1: shape.v[1] * L };
  }
}

export function resolveStroke(s: MaskStroke, profile: RegionProfile): ResolvedStroke {
  return {
    erase: !!s.erase,
    half: s.radius_cm,
    points: s.points.map((p) => ({ u: p.u, y: p.v * profile.length })),
  };
}

/** The rows (cm from the region's start) a shape can touch. */
export function areaYRange(a: ResolvedArea): [number, number] {
  switch (a.kind) {
    case "rect":
    case "ellipse": {
      const r = Math.hypot(a.w, a.h) / 2;
      return [a.cy - r, a.cy + r];
    }
    case "polygon": {
      const ys = a.points.map((p) => p.y);
      return [Math.min(...ys), Math.max(...ys)];
    }
    case "span":
      return [a.y0, a.y1];
  }
}

export function strokeYRange(s: ResolvedStroke): [number, number] {
  const ys = s.points.map((p) => p.y);
  return [Math.min(...ys) - s.half, Math.max(...ys) + s.half];
}

/** Even-odd test of (x, y) against a polygon given by its vertices. */
export function insidePolygon(xs: readonly number[], ys: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const yi = ys[i]!;
    const yj = ys[j]!;
    if (yi > y !== yj > y) {
      const xc = xs[i]! + ((y - yi) / (yj - yi)) * (xs[j]! - xs[i]!);
      if (x < xc) inside = !inside;
    }
  }
  return inside;
}

/** Whether a skin point (u, y in cm, local circumference c) lies inside the shape. */
export function areaHits(a: ResolvedArea, u: number, y: number, c: number): boolean {
  switch (a.kind) {
    case "rect":
    case "ellipse": {
      const sx = a.sign * wrapDelta(u - a.uc) * c;
      const sy = y - a.cy;
      const cos = Math.cos(a.rot);
      const sin = Math.sin(a.rot);
      const lx = (sx * cos + sy * sin) / (a.w / 2);
      const ly = (-sx * sin + sy * cos) / (a.h / 2);
      return a.kind === "rect" ? Math.abs(lx) <= 1 && Math.abs(ly) <= 1 : lx * lx + ly * ly <= 1;
    }
    case "polygon": {
      // Vertices unwrapped from the first one (each edge the short way round), relative to the point;
      // the point is also tried one circumference either side, for polygons that pass the seam.
      const pts = a.points;
      const xs: number[] = [wrapDelta(pts[0]!.u - u) * c];
      for (let k = 1; k < pts.length; k++) xs.push(xs[k - 1]! + wrapDelta(pts[k]!.u - pts[k - 1]!.u) * c);
      const ys = pts.map((p) => p.y);
      return insidePolygon(xs, ys, 0, y) || insidePolygon(xs, ys, c, y) || insidePolygon(xs, ys, -c, y);
    }
    case "span": {
      // As a former filler's region: u0 to u1 towards higher u; [0, 1] is the whole way round.
      if (y < a.y0 || y > a.y1) return false;
      const span = wrapU(a.u1 - a.u0) || (a.u1 !== a.u0 ? 1 : 0);
      return wrapU(u - a.u0) <= span;
    }
  }
}

/** Whether a skin point lies under the brush of a stroke. */
export function strokeHits(s: ResolvedStroke, u: number, y: number, c: number): boolean {
  const pts = s.points;
  const r2 = s.half * s.half;
  if (pts.length === 1) {
    const dx = wrapDelta(pts[0]!.u - u) * c;
    const dy = pts[0]!.y - y;
    return dx * dx + dy * dy <= r2;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = wrapDelta(pts[i]!.u - u) * c;
    const ay = pts[i]!.y - y;
    const bx = ax + wrapDelta(pts[i + 1]!.u - pts[i]!.u) * c;
    const by = pts[i + 1]!.y - y;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    if (px * px + py * py <= r2) return true;
  }
  return false;
}

export function resolveLayer(layer: BackgroundLayer, profile: RegionProfile): ResolvedLayer {
  if ((layer.cover ?? "region") === "region")
    return { layer, shapes: null, strokes: [], y0: 0, y1: profile.length };
  const shapes = (layer.shapes ?? []).map((s) => resolveArea(s, profile));
  const strokes = (layer.mask ?? []).map((s) => resolveStroke(s, profile));
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of [...shapes.map(areaYRange), ...strokes.filter((s) => !s.erase).map(strokeYRange)]) {
    y0 = Math.min(y0, r[0]);
    y1 = Math.max(y1, r[1]);
  }
  return { layer, shapes, strokes, y0, y1 };
}

/** Whether a resolved layer covers a skin point (hard edge: the feather is left out). */
export function layerCovers(r: ResolvedLayer, u: number, y: number, c: number): boolean {
  if (r.shapes === null) return true;
  if (y < r.y0 || y > r.y1) return false;
  let on = false;
  for (const s of r.shapes) if (areaHits(s, u, y, c)) on = true;
  for (const s of r.strokes) if (on === s.erase && strokeHits(s, u, y, c)) on = !s.erase;
  return on;
}

/** The layers that are drawn: visible ones, bottom first. */
export function visibleLayers(layout: Pick<Layout, "backgrounds">): BackgroundLayer[] {
  return (layout.backgrounds ?? []).filter((b) => !b.hidden);
}

/** Display name of a layer. */
export function layerName(layer: BackgroundLayer): string {
  return layer.name?.trim() || layer.id;
}
