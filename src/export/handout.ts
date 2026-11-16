// The content of the artist handout (docs/history/project-brief.md §10.1 F10) as plain data: element rows,
// coverage rows, open points, which elements face each view. No DOM, no PDF library: the PDF
// writer (pdf.ts) only lays this out. All wording comes from strings.ts.
import type { RegionProfile } from "../body/profile.ts";
import { wrapU } from "../body/uv.ts";
import { layerName, visibleLayers } from "../layout/areas.ts";
import { isFigureLike } from "../layout/imageFit.ts";
import type { Layout, LayoutElement } from "../layout/schema.ts";
import {
  PLACEHOLDER_HEIGHT_CM,
  wrapDelta,
  type ExistingSize,
  type ResolvedElement,
} from "../layout/shapes.ts";
import {
  CATEGORIES,
  ZONES_BY_KIND,
  zoneCoverage,
  type Coverage,
  type ZoneCoverage,
} from "../metrics/coverage.ts";
import { viewU, type ViewName } from "../viewer/views.ts";
import type { HandoutText } from "./strings.ts";

export type HandoutFacts = {
  layout: Layout;
  profile: RegionProfile;
  /** YYYY-MM-DD */
  date: string;
  /** resolveElement() of every element, same order as layout.elements. */
  resolved: ResolvedElement[];
  coverage: Coverage;
  /** Element id → why reference mode shows a placeholder instead of the image. */
  missingImages: ReadonlyMap<string, string>;
  /** Measurement keys still on generic placeholder values, and how many inputs there are. */
  placeholderMeasurements: string[];
  measurementCount: number;
  /** Size of the existing tattoo from measurements.yaml, used when the layout leaves it empty. */
  existing?: ExistingSize;
};

export type Handout = {
  layoutName: string;
  description: string | null;
  date: string;
  elementRows: string[][];
  coverageRows: string[][];
  layoutPoints: string[];
  facing: Record<ViewName, string[]>;
};

/** One decimal, without a trailing .0 ("12", "12.5"). */
export function cm(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const two = (x: number) => x.toFixed(2);

/**
 * The u of each centre line (src/body/uv.ts). The names are the arm's; other regions name the same
 * four slots their own way (strings.ts handoutText).
 */
export const SIDE_U = { outer: 0, lateral: 0.25, inner: 0.5, medial: 0.75 } as const;
type Side = keyof typeof SIDE_U;
const SIDE_ORDER: Side[] = ["outer", "lateral", "inner", "medial"];

/** "inner line" near a centre line (within 0.04 of the circumference), else "between X and Y". */
export function sideName(u: number, t: HandoutText): string {
  const w = wrapU(u);
  for (const s of SIDE_ORDER) if (Math.abs(wrapDelta(w - SIDE_U[s])) <= 0.04) return t.sides[s];
  const lower = SIDE_ORDER[Math.floor(w * 4) % 4]!;
  const upper = SIDE_ORDER[(Math.floor(w * 4) + 1) % 4]!;
  return t.sides.between(t.sideShort[lower], t.sideShort[upper]);
}

export function sizeText(
  r: ResolvedElement,
  profile: RegionProfile,
  t: HandoutText,
  existing?: ExistingSize,
): string {
  const el = r.element;
  const s = r.shape;
  switch (s.kind) {
    case "box": {
      const notes: string[] = [];
      if (r.flags.includes("height not set")) notes.push(t.cell.heightNotSet);
      const widthGiven =
        isFigureLike(el) && (el.size_cm.w != null || (el.type === "existing" && existing?.width != null));
      if (r.flags.includes("width assumed")) notes.push(t.cell.widthAssumed);
      else if (!widthGiven) notes.push(t.cell.widthFromImage);
      const box = t.cell.box(cm(s.h), cm(s.w));
      return notes.length ? `${box} (${notes.join(", ")})` : box;
    }
    case "region": {
      const span = wrapU(s.u1 - s.u0) || (s.u1 !== s.u0 ? 1 : 0);
      const width = span * profile.circumferenceAt((s.y0 + s.y1) / 2);
      return t.cell.region(cm(s.y1 - s.y0), cm(width));
    }
    case "band":
      return t.cell.band(cm(s.half * 2), cm(profile.circumferenceAt(s.y)));
    case "line": {
      let len = 0;
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1]!;
        const b = s.points[i]!;
        const c = profile.circumferenceAt((a.y + b.y) / 2);
        len += Math.hypot(wrapDelta(b.u - a.u) * c, b.y - a.y);
      }
      return t.cell.line(cm(s.half * 2), cm(len));
    }
    case "patch": {
      const width = wrapU(s.u1 - s.u0) * profile.circumferenceAt(s.cy);
      return `${t.cell.box(cm(s.y1 - s.y0), cm(width))} (${t.cell.fromPhotos})`;
    }
  }
}

export function positionText(r: ResolvedElement, profile: RegionProfile, t: HandoutText): string {
  const el = r.element;
  const L = profile.length;
  switch (el.type) {
    case "figure":
    case "existing": {
      // A projected tattoo sits where its photos put it, not at `position`.
      const s = r.shape;
      const [u, v] = s.kind === "patch" ? [s.uc, s.cy / L] : [el.position.u, el.position.v];
      return `${t.cell.centre(sideName(u, t), cm(v * L))} ${t.cell.coords(two(u), two(v))}`;
    }
    case "band":
      return t.cell.around(cm(el.v * L));
    case "line": {
      const a = el.points[0]!;
      const b = el.points[el.points.length - 1]!;
      return t.cell.path(sideName(a.u, t), sideName(b.u, t), cm(a.v * L), cm(b.v * L));
    }
  }
}

export function styleText(el: LayoutElement, t: HandoutText): string {
  const parts: string[] = [];
  switch (el.type) {
    case "figure":
    case "existing":
      if (el.style) parts.push(el.style);
      if (el.red_accents) parts.push(t.cell.redAccents);
      break;
    case "band":
      parts.push(t.cell.pattern(el.pattern));
      break;
    case "line":
      parts.push(t.cell.colour(el.color ?? "red"));
      break;
  }
  return parts.join(", ") || t.cell.none;
}

/** Rows for the background layers (docs/adr/0019), bottom layer first; they lie under every element. */
export function backgroundRows(layout: Layout, profile: RegionProfile, t: HandoutText): string[][] {
  const L = profile.length;
  return visibleLayers(layout).map((b) => {
    const src = b.source;
    const name = "pattern" in src ? src.pattern : "standard" in src ? src.standard : src.image;
    const style: string[] = [t.cell.pattern(name)];
    if ("density" in src && src.density !== undefined) style.push(t.cell.density(String(src.density)));
    const area = (b.cover ?? "region") === "region";
    const only = !area && b.shapes?.length === 1 && !b.mask?.length ? b.shapes[0] : undefined;
    const position =
      only?.kind === "span"
        ? t.cell.span(sideName(only.u[0], t), sideName(only.u[1], t), cm(only.v[0] * L), cm(only.v[1] * L))
        : area
          ? t.background.whole
          : t.background.area((b.shapes?.length ?? 0) + (b.mask?.length ? 1 : 0));
    return [
      layerName(b),
      t.background.type,
      "image" in src ? src.image : t.cell.none,
      t.cell.none,
      position,
      style.join(", "),
      b.notes?.trim() || t.cell.none,
    ];
  });
}

export function elementRows(facts: HandoutFacts, t: HandoutText): string[][] {
  return [...backgroundRows(facts.layout, facts.profile, t), ...elementOnlyRows(facts, t)];
}

function elementOnlyRows(facts: HandoutFacts, t: HandoutText): string[][] {
  return facts.resolved.map((r) => {
    const el = r.element;
    let asset: string = t.cell.none;
    if (isFigureLike(el) && el.asset)
      asset = facts.missingImages.has(el.id) ? `${el.asset} (${t.cell.missing})` : el.asset;
    return [
      el.id,
      t.type[el.type],
      asset,
      sizeText(r, facts.profile, t, facts.existing),
      positionText(r, facts.profile, t),
      styleText(el, t),
      el.notes?.trim() || t.cell.none,
    ];
  });
}

const pct = (z: ZoneCoverage, k: number) => `${z.area > 0 ? Math.round((100 * k) / z.area) : 0} %`;

export function coverageRows(cov: Coverage, t: HandoutText): string[][] {
  const row = (label: string, z: ZoneCoverage) => [label, ...CATEGORIES.map((c) => pct(z, z.byCategory[c]))];
  return [
    ...ZONES_BY_KIND[cov.kind].map((z) => row(t.zones[z.id], zoneCoverage(cov, z.id))),
    row(t.wholeArm, cov.total),
  ];
}

/** Things the layout leaves open: unset sizes, missing images, placeholder measurements. */
export function layoutPoints(facts: HandoutFacts, t: HandoutText): string[] {
  const out: string[] = [];
  for (const r of facts.resolved) {
    if (r.flags.includes("height not set"))
      out.push(t.point.heightNotSet(r.element.id, PLACEHOLDER_HEIGHT_CM));
    if (r.flags.includes("width assumed") && !facts.missingImages.has(r.element.id))
      out.push(t.point.widthAssumed(r.element.id));
  }
  for (const [id, reason] of facts.missingImages) out.push(t.point.missingImage(id, reason));
  if (facts.placeholderMeasurements.length > 0)
    out.push(
      t.point.measurements(
        facts.placeholderMeasurements.length,
        facts.measurementCount,
        facts.placeholderMeasurements.join(", "),
      ),
    );
  for (const w of facts.profile.warnings) out.push(t.point.profile(w));
  return out;
}

/** How far from a view's centre line (fraction of the circumference) an element must reach to count as facing it. */
export const FACING_HALF_WIDTH = 0.2;

/**
 * Whether the element reaches the part of the arm that faces the view: within FACING_HALF_WIDTH of
 * the view's centre line, so pieces that only graze the silhouette are left out. Bands go all
 * around, so they face every view.
 */
export function facesView(r: ResolvedElement, view: ViewName, profile: RegionProfile): boolean {
  const vu = viewU(profile)[view];
  const k = FACING_HALF_WIDTH;
  const s = r.shape;
  switch (s.kind) {
    case "box": {
      const halfU = s.w / 2 / profile.circumferenceAt(s.cy);
      return Math.abs(wrapDelta(s.uc - vu)) < k + Math.min(halfU, 0.5);
    }
    case "region":
    case "patch": {
      const span = wrapU(s.u1 - s.u0) || (s.u1 !== s.u0 ? 1 : 0);
      const d = wrapU(vu - s.u0);
      // [vu - k, vu + k] overlaps [u0, u0 + span].
      return span >= 1 - 2 * k || d <= span + k || d >= 1 - k;
    }
    case "band":
      return true;
    case "line": {
      for (let i = 0; i < s.points.length; i++) {
        if (Math.abs(wrapDelta(s.points[i]!.u - vu)) < k) return true;
        if (i === 0) continue;
        // A segment that crosses the facing strip between two points.
        const a = wrapDelta(s.points[i - 1]!.u - vu);
        const b = a + wrapDelta(s.points[i]!.u - s.points[i - 1]!.u);
        if (Math.min(a, b) < k && Math.max(a, b) > -k) return true;
      }
      return false;
    }
  }
}

/** Element ids facing each view, from the shoulder down (the order a viewer reads the picture). */
export function facingElements(facts: HandoutFacts): Record<ViewName, string[]> {
  const topY = (r: ResolvedElement) => {
    const s = r.shape;
    if (s.kind === "box") return s.cy + s.h / 2;
    if (s.kind === "region" || s.kind === "patch") return s.y1;
    if (s.kind === "band") return s.y + s.half;
    return Math.max(...s.points.map((p) => p.y));
  };
  const sorted = [...facts.resolved].sort((a, b) => topY(b) - topY(a));
  const views: ViewName[] = ["front", "back", "medial", "lateral"];
  return Object.fromEntries(
    views.map((v) => [v, sorted.filter((r) => facesView(r, v, facts.profile)).map((r) => r.element.id)]),
  ) as Record<ViewName, string[]>;
}

export function buildHandout(facts: HandoutFacts, t: HandoutText): Handout {
  return {
    layoutName: facts.layout.name,
    description: facts.layout.description?.trim() || null,
    date: facts.date,
    elementRows: elementRows(facts, t),
    coverageRows: coverageRows(facts.coverage, t),
    layoutPoints: layoutPoints(facts, t),
    facing: facingElements(facts),
  };
}
