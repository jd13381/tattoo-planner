// Pure operations behind the Layers panel and the Background view (docs/adr/0019): add, change,
// reorder and remove background layers, draw area shapes and paint the mask. Each returns the new
// layout (and what to select), so the UI only stores it.
import type { RegionProfile } from "../body/profile.ts";
import { wrapU } from "../body/uv.ts";
import type { AreaShape, BackgroundLayer, BackgroundSource, Layout, MaskStroke } from "../layout/schema.ts";
import { svgToSkin } from "./resize.ts";
import { uniqueId } from "./edit.ts";

const round = (n: number, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export type LayerEdit = { layout: Layout; selected: number | null };

const layersOf = (l: Layout) => l.backgrounds ?? [];
const withLayers = (l: Layout, backgrounds: BackgroundLayer[]): Layout => ({ ...l, backgrounds });

/** Every id in the layout (elements and layers share one namespace). */
export function takenIds(l: Layout): string[] {
  return [...l.elements.map((e) => e.id), ...layersOf(l).map((b) => b.id)];
}

/** A slug for a layer id from a source name ("snake-scales" → "bg-snake-scales"). */
export function layerIdFor(source: BackgroundSource): string {
  const name = "pattern" in source ? source.pattern : "standard" in source ? source.standard : source.image;
  return `bg-${name}`.replace(/[^a-z0-9-]+/g, "-").slice(0, 40);
}

/** Skin left free around the motifs on new layers, in cm (0.3 cm reads as "embedded"). */
export const NEW_LAYER_GAP_CM = 0.3;

/** A new layer on top of the others, covering the whole region; it is selected. */
export function addLayer(
  l: Layout,
  source: BackgroundSource,
  cover: "region" | "area" = "region",
): LayerEdit {
  const layers = layersOf(l);
  const layer: BackgroundLayer = {
    id: uniqueId(layerIdFor(source), takenIds(l)),
    source,
    ...(cover === "area" ? { cover, shapes: [] } : {}),
    gap_cm: NEW_LAYER_GAP_CM,
  };
  return { layout: withLayers(l, [...layers, layer]), selected: layers.length };
}

export function setLayer(l: Layout, index: number, layer: BackgroundLayer): Layout {
  return withLayers(
    l,
    layersOf(l).map((b, i) => (i === index ? layer : b)),
  );
}

export function deleteLayer(l: Layout, index: number): LayerEdit {
  const layers = layersOf(l);
  if (index < 0 || index >= layers.length) return { layout: l, selected: null };
  const next = layers.filter((_, i) => i !== index);
  return { layout: withLayers(l, next), selected: next.length ? Math.min(index, next.length - 1) : null };
}

export function duplicateLayer(l: Layout, index: number): LayerEdit {
  const layers = layersOf(l);
  const b = layers[index];
  if (!b) return { layout: l, selected: null };
  const copy = { ...b, id: uniqueId(b.id, takenIds(l)) };
  const next = [...layers];
  next.splice(index + 1, 0, copy);
  return { layout: withLayers(l, next), selected: index + 1 };
}

/** Moves the layer at `from` to index `to` (0 = bottom); the selection follows it. */
export function moveLayerTo(l: Layout, from: number, to: number): LayerEdit {
  const layers = layersOf(l);
  if (from < 0 || from >= layers.length) return { layout: l, selected: null };
  const target = Math.min(layers.length - 1, Math.max(0, to));
  const next = [...layers];
  const [b] = next.splice(from, 1);
  next.splice(target, 0, b!);
  return { layout: withLayers(l, next), selected: target };
}

/** Switches between the whole region and an area, keeping the area's shapes and mask either way. */
export function setCover(layer: BackgroundLayer, cover: "region" | "area"): BackgroundLayer {
  if (cover === "region") {
    const { cover: _c, ...rest } = layer;
    void _c;
    return rest;
  }
  return { ...layer, cover, shapes: layer.shapes ?? [] };
}

/** Adds a shape to the layer's area (the layer becomes an area layer). */
export function addShape(layer: BackgroundLayer, shape: AreaShape): BackgroundLayer {
  return { ...setCover(layer, "area"), shapes: [...(layer.shapes ?? []), shape] };
}

export function removeShape(layer: BackgroundLayer, index: number): BackgroundLayer {
  const shapes = (layer.shapes ?? []).filter((_, i) => i !== index);
  return { ...layer, shapes };
}

/** Moves a shape by du around and dv along (u wraps, v stays on the region). */
export function moveShape(shape: AreaShape, du: number, dv: number): AreaShape {
  const p = (q: { u: number; v: number }) => ({ u: round(wrapU(q.u + du)), v: round(clamp01(q.v + dv)) });
  switch (shape.kind) {
    case "rect":
    case "ellipse": {
      const q = p(shape);
      return { ...shape, u: q.u, v: q.v };
    }
    case "polygon":
      return { ...shape, points: shape.points.map(p) };
    case "span": {
      const span = shape.v[1] - shape.v[0];
      const v0 = round(Math.min(1 - span, Math.max(0, shape.v[0] + dv)));
      return {
        ...shape,
        u: [round(wrapU(shape.u[0] + du)), round(wrapU(shape.u[1] + du))],
        v: [v0, round(v0 + span)],
      };
    }
  }
}

/** The point a shape is moved by (its centre). */
export function shapeAnchor(shape: AreaShape): { u: number; v: number } {
  switch (shape.kind) {
    case "rect":
    case "ellipse":
      return { u: shape.u, v: shape.v };
    case "polygon": {
      // Mean of the points, unwrapped from the first one.
      const u0 = shape.points[0]!.u;
      let du = 0;
      let v = 0;
      for (const q of shape.points) {
        du += wrapU(q.u - u0 + 0.5) - 0.5;
        v += q.v;
      }
      return { u: wrapU(u0 + du / shape.points.length), v: v / shape.points.length };
    }
    case "span": {
      const span = wrapU(shape.u[1] - shape.u[0]) || (shape.u[1] !== shape.u[0] ? 1 : 0);
      return { u: wrapU(shape.u[0] + span / 2), v: (shape.v[0] + shape.v[1]) / 2 };
    }
  }
}

/** Smallest rect or ellipse the editor makes from a drag, in cm. */
export const MIN_SHAPE_CM = 0.5;

/**
 * A rect or ellipse from two corners of a drag in the editor's SVG frame (cm, x right, y down from
 * the region's end), upright on screen. Null when the drag is too small to mean a shape.
 */
export function shapeFromDrag(
  kind: "rect" | "ellipse",
  profile: RegionProfile,
  centerU: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): AreaShape | null {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (w < MIN_SHAPE_CM || h < MIN_SHAPE_CM) return null;
  const c = svgToSkin(profile, centerU, (a.x + b.x) / 2, (a.y + b.y) / 2);
  return { kind, u: round(c.u), v: round(c.v), w_cm: round(w, 1), h_cm: round(h, 1) };
}

/** Distance in cm below which a stroke point is dropped (keeps painted strokes small in the YAML). */
export const STROKE_STEP_CM = 0.25;

/**
 * Thins a brush path given in editor SVG cm with its skin points: keeps a point only once it lies
 * `step` cm from the last kept one (the last point is always kept), so a stroke stores a few points
 * per cm instead of one per pointer event.
 */
export function thinStroke(
  svg: readonly { x: number; y: number }[],
  skin: readonly { u: number; v: number }[],
  step = STROKE_STEP_CM,
): { u: number; v: number }[] {
  const out: { u: number; v: number }[] = [];
  let last: { x: number; y: number } | null = null;
  svg.forEach((p, i) => {
    const keep = !last || Math.hypot(p.x - last.x, p.y - last.y) >= step || i === svg.length - 1;
    if (!keep) return;
    if (last && i === svg.length - 1 && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) return;
    last = p;
    out.push({ u: round(skin[i]!.u), v: round(skin[i]!.v) });
  });
  return out;
}

export function addStroke(layer: BackgroundLayer, stroke: MaskStroke): BackgroundLayer {
  return { ...setCover(layer, "area"), mask: [...(layer.mask ?? []), stroke] };
}

/** A short description of where a layer lies ("whole region", "2 shapes, 3 strokes"). */
export function coverSummary(layer: BackgroundLayer): string {
  if ((layer.cover ?? "region") === "region") return "whole region";
  const n = layer.shapes?.length ?? 0;
  const m = layer.mask?.length ?? 0;
  if (n === 0 && m === 0) return "area (empty: draw a shape)";
  const parts = [];
  if (n) parts.push(`${n} shape${n === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} stroke${m === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** The source's label in the Layers panel. */
export function sourceLabel(source: BackgroundSource, labelOf: (name: string) => string | undefined): string {
  if ("pattern" in source) return labelOf(source.pattern) ?? source.pattern;
  if ("standard" in source) return labelOf(source.standard) ?? source.standard;
  return `image ${source.image}`;
}
