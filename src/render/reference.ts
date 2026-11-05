// Reference mode (PROJECT_BRIEF.md §10.1 F6, §11.3): the layout drawn with its reference images.
// Figures and existing tattoos show their cut-out image inside their box, multiplied onto the skin
// (white paper and pale skin vanish); fillers and bands are procedural patterns clipped exactly to
// their shape; red lines lie on top of everything (§4.3). Missing images show a labelled placeholder.
//
// Elements are drawn row by row: each texture row is as wide as the local circumference, so a box
// is copied one pixel row at a time to where that row puts it, and whatever crosses the inner seam
// re-enters on the other edge, exactly like the blockout classification.
import type { ArmProfile } from "../arm/profile.ts";
import type { AssetInfo } from "../assets/types.ts";
import {
  fitContain,
  imageSettings,
  isFigureLike,
  type ElementAspects,
  type ImageSettings,
} from "../layout/imageFit.ts";
import type { FigureLike, Layout } from "../layout/schema.ts";
import type { ProjectedPatch } from "../projection/patch.ts";
import { resolveElement, type ElementPatches, type ExistingSize, type Shape } from "../layout/shapes.ts";
import { BLOCKOUT_COLORS } from "./blockout.ts";
import { cpu2d, cpuCanvas } from "./cpuCanvas.ts";
import { OVERLAY_GRID_STYLE, paintGrid } from "./cmGrid.ts";
import { lineScreen, processPixels } from "./imageOps.ts";
import { getPattern, seedFromId } from "./patterns/index.ts";
import { rowRange, screenX, shapeMask, wrapStrip } from "./unwrapRows.ts";

export type AssetImage =
  | { status: "loading" }
  | { status: "ready"; image: CanvasImageSource; width: number; height: number; version: number }
  | { status: "error"; message: string };

export type ReferenceSources = {
  /** Manifest entries by id; null when no listing is available (no data folder). */
  assets: ReadonlyMap<string, AssetInfo> | null;
  /** Decoded images by asset id. */
  images: ReadonlyMap<string, AssetImage>;
  aspects: ElementAspects;
  /** Existing tattoos projected from several photos (docs/adr/0006), by element id. */
  patches?: ElementPatches;
};

export type ReferenceOptions = {
  pxPerCm: number;
  centerU: number;
  grid: boolean;
  existing?: ExistingSize;
  sources: ReferenceSources;
};

const INK = "#1d1b19";
const SLEEVE_RED = "rgb(198, 40, 40)";
const rgb = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** Why an element shows a placeholder instead of its image, or null when the image is ready. */
export function missingReason(el: FigureLike, sources: ReferenceSources): string | null {
  if (sources.patches?.has(el.id)) return null; // drawn from its projected photos
  if (!el.asset) return "no asset";
  if (!sources.assets) return "no data folder";
  const info = sources.assets.get(el.asset);
  if (!info) return `${el.asset}: not in manifest`;
  if (!info.exists) return `${el.asset}: file missing`;
  const img = sources.images.get(el.asset);
  if (!img || img.status === "loading") return "loading…";
  if (img.status === "error") return img.message;
  return null;
}

export function renderReference(
  ctx: CanvasRenderingContext2D,
  profile: ArmProfile,
  layout: Layout,
  opts: ReferenceOptions,
): void {
  const { pxPerCm: ppc, centerU, sources } = opts;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const L = profile.length;

  // Background and skin, one row at a time (the vase outline).
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = rgb(BLOCKOUT_COLORS.outside);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = rgb(BLOCKOUT_COLORS.open);
  for (let j = 0; j < H; j++) {
    const c = profile.circumferenceAt(L - (j + 0.5) / ppc) * ppc;
    ctx.fillRect(W / 2 - c / 2, j, c, 1);
  }

  const lines: Shape[] = [];
  const lineColors: string[] = [];
  for (const el of layout.elements) {
    const r = resolveElement(
      el,
      profile,
      opts.existing,
      sources.aspects.get(el.id),
      sources.patches?.get(el.id),
    );
    if (isFigureLike(el) && r.shape.kind === "patch") {
      drawPatch(ctx, profile, r.shape.patch, el.filter === "hatching", opts);
    } else if (isFigureLike(el) && r.shape.kind === "box") {
      drawFigure(ctx, profile, el, r.shape, opts);
    } else if (el.type === "filler" || el.type === "band") {
      drawPattern(
        ctx,
        profile,
        el.id,
        el.pattern,
        el.type === "filler" ? (el.density ?? 0.3) : 1,
        r.shape,
        opts,
      );
    } else if (el.type === "line") {
      lines.push(r.shape);
      lineColors.push(!el.color || el.color === "red" ? SLEEVE_RED : el.color);
    }
  }

  if (opts.grid && centerU === 0) paintGrid(ctx, profile, ppc, OVERLAY_GRID_STYLE, { background: false });

  // Red as the bracket (§4.3): lines on top of everything, whatever their layer.
  lines.forEach((shape, k) => fillMask(ctx, shapeMask(shape, profile, ppc, centerU), lineColors[k]!, 0.9));
}

type BoxShape = Extract<Shape, { kind: "box" }>;

function drawFigure(
  ctx: CanvasRenderingContext2D,
  profile: ArmProfile,
  el: FigureLike,
  box: BoxShape,
  opts: ReferenceOptions,
) {
  const reason = missingReason(el, opts.sources);
  const asset = el.asset ? opts.sources.assets?.get(el.asset) : undefined;
  const img = el.asset ? opts.sources.images.get(el.asset) : undefined;
  let upright: HTMLCanvasElement;
  let blend: GlobalCompositeOperation = "source-over";
  if (reason === null && img?.status === "ready") {
    const settings = imageSettings(el, profile, asset);
    upright = processedImage(el.asset!, img, settings, box, opts.pxPerCm);
    blend = "multiply";
  } else {
    upright = placeholder(el.id, reason ?? "", box, opts.pxPerCm);
  }
  const local = rotated(upright, box.rot);
  ctx.globalCompositeOperation = blend;
  blitRows(ctx, profile, local, box, opts);
  ctx.globalCompositeOperation = "source-over";
}

/** Copies a canvas centred on the box onto the unwrap, row by row, wrapping at the seam. */
function blitRows(
  ctx: CanvasRenderingContext2D,
  profile: ArmProfile,
  local: HTMLCanvasElement,
  box: BoxShape,
  opts: ReferenceOptions,
) {
  const ppc = opts.pxPerCm;
  const W = ctx.canvas.width;
  const L = profile.length;
  const top = (L - box.cy) * ppc - local.height / 2; // canvas y of the local canvas' top edge
  const j0 = Math.max(0, Math.floor(top));
  const j1 = Math.min(ctx.canvas.height - 1, Math.ceil(top + local.height));
  for (let j = j0; j <= j1; j++) {
    const ly = Math.floor(j + 0.5 - top);
    if (ly < 0 || ly >= local.height) continue;
    const c = profile.circumferenceAt(L - (j + 0.5) / ppc);
    const cx = screenX(box.uc, opts.centerU, c);
    const halfLocal = local.width / 2 / ppc;
    for (const piece of wrapStrip(cx, -halfLocal, halfLocal, c)) {
      const sx = (piece.from + halfLocal) * ppc;
      const sw = (piece.to - piece.from) * ppc;
      if (sw < 0.01) continue;
      ctx.drawImage(local, sx, ly, sw, 1, W / 2 + piece.at * ppc, j, sw, 1);
    }
  }
}

/** The patch as an RGBA canvas (grey ink, alpha where photos see the skin), cached per patch. */
const patchCanvases = new WeakMap<ProjectedPatch, Map<string, HTMLCanvasElement>>();

function patchCanvas(patch: ProjectedPatch, hatching: boolean): HTMLCanvasElement {
  let byLook = patchCanvases.get(patch);
  if (!byLook) patchCanvases.set(patch, (byLook = new Map()));
  const key = hatching ? "hatching" : "grayscale";
  const hit = byLook.get(key);
  if (hit) return hit;
  const out = canvas(patch.width, patch.height);
  const c = cpu2d(out);
  const img = c.createImageData(patch.width, patch.height);
  for (let k = 0; k < patch.gray.length; k++) {
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = patch.gray[k]!;
    img.data[k * 4 + 3] = patch.alpha[k]!;
  }
  if (hatching) lineScreen(img.data, patch.width, Math.max(3, patch.pxPerCm * 0.25));
  c.putImageData(img, 0, 0);
  byLook.set(key, out);
  return out;
}

/**
 * Draws a projected patch: its pixels are already in skin coordinates, so each unwrap row takes the
 * patch row at the same height and stretches it over that row's u range (wrapping at the seam).
 */
function drawPatch(
  ctx: CanvasRenderingContext2D,
  profile: ArmProfile,
  patch: ProjectedPatch,
  hatching: boolean,
  opts: ReferenceOptions,
) {
  const src = patchCanvas(patch, hatching);
  const ppc = opts.pxPerCm;
  const W = ctx.canvas.width;
  const L = profile.length;
  const [first, last] = rowRange(profile, ppc, patch.v0 * L, patch.v1 * L);
  const uc = (patch.u0 + patch.u1) / 2;
  ctx.globalCompositeOperation = "multiply";
  for (let j = first; j <= last; j++) {
    const v = (L - (j + 0.5) / ppc) / L;
    const r = Math.floor(((patch.v1 - v) / (patch.v1 - patch.v0)) * patch.height);
    if (r < 0 || r >= patch.height) continue;
    const c = profile.circumferenceAt(v * L);
    const half = ((patch.u1 - patch.u0) / 2) * c;
    // Screen x grows towards smaller u, as the patch columns do.
    for (const piece of wrapStrip(screenX(uc, opts.centerU, c), -half, half, c)) {
      const sx = ((piece.from + half) / (2 * half)) * patch.width;
      const sw = ((piece.to - piece.from) / (2 * half)) * patch.width;
      if (sw < 0.01) continue;
      ctx.drawImage(src, sx, r, sw, 1, W / 2 + piece.at * ppc, j, (piece.to - piece.from) * ppc, 1);
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

// Processed images are cached: switching modes or moving an element re-uses them; only a change of
// size, cut-out or look re-processes the pixels. Small LRU, since scaling creates a new size per frame.
const CACHE_LIMIT = 48;
const processedCache = new Map<string, HTMLCanvasElement>();

function cached(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = processedCache.get(key);
  if (hit) {
    processedCache.delete(key);
    processedCache.set(key, hit);
    return hit;
  }
  const made = make();
  processedCache.set(key, made);
  if (processedCache.size > CACHE_LIMIT) processedCache.delete(processedCache.keys().next().value!);
  return made;
}

// Every intermediate canvas lives in main memory (./cpuCanvas.ts): they are drawn row by row.
const canvas = cpuCanvas;

/** The upright, filtered, feathered cut-out at its final pixel size (fitted into the box). */
function processedImage(
  assetId: string,
  img: Extract<AssetImage, { status: "ready" }>,
  s: ImageSettings,
  box: BoxShape,
  ppc: number,
): HTMLCanvasElement {
  const quarter = s.rotation === 90 || s.rotation === 270;
  const cropW = s.crop.w * img.width;
  const cropH = s.crop.h * img.height;
  const aspect = quarter ? cropH / cropW : cropW / cropH;
  const fit = fitContain(box.w, box.h, aspect);
  const tw = Math.max(1, Math.round(fit.w * ppc));
  const th = Math.max(1, Math.round(fit.h * ppc));
  const featherPx = Math.round(s.featherCm * ppc * 10) / 10;
  const key = [assetId, img.version, s.crop.x, s.crop.y, s.crop.w, s.crop.h, s.rotation, s.flip, s.filter]
    .concat([featherPx, tw, th, ppc])
    .join("|");
  return cached(key, () => {
    const out = canvas(tw, th);
    const c = cpu2d(out);
    c.imageSmoothingQuality = "high";
    c.translate(tw / 2, th / 2);
    if (s.flip) c.scale(-1, 1);
    c.rotate((s.rotation * Math.PI) / 180);
    const [dw, dh] = quarter ? [th, tw] : [tw, th];
    c.drawImage(
      img.image,
      s.crop.x * img.width,
      s.crop.y * img.height,
      cropW,
      cropH,
      -dw / 2,
      -dh / 2,
      dw,
      dh,
    );
    c.setTransform(1, 0, 0, 1, 0, 0);
    const data = c.getImageData(0, 0, tw, th);
    processPixels(data.data, tw, th, {
      filter: s.filter,
      featherPx,
      // About 4 lines per cm, never finer than 3 px so the screen stays readable.
      hatchPeriodPx: Math.max(3, ppc * 0.25),
    });
    c.putImageData(data, 0, 0);
    return out;
  });
}

function placeholder(id: string, reason: string, box: BoxShape, ppc: number): HTMLCanvasElement {
  const key = ["placeholder", id, reason, box.w, box.h, ppc].join("|");
  return cached(key, () => {
    const out = canvas(box.w * ppc, box.h * ppc);
    const c = cpu2d(out);
    const w = out.width;
    const h = out.height;
    c.fillStyle = "rgba(120, 112, 105, 0.35)";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(40, 30, 25, 0.8)";
    c.lineWidth = Math.max(1, ppc / 8);
    c.setLineDash([ppc * 0.4, ppc * 0.3]);
    c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(w, h);
    c.moveTo(w, 0);
    c.lineTo(0, h);
    c.setLineDash([]);
    c.lineWidth = Math.max(1, ppc / 16);
    c.stroke();
    c.fillStyle = "rgba(29, 27, 25, 0.95)";
    c.textAlign = "center";
    c.textBaseline = "middle";
    const size = Math.max(8, Math.min(ppc * 0.9, (w / Math.max(id.length, reason.length, 4)) * 1.6));
    c.font = `600 ${size}px system-ui, sans-serif`;
    c.fillText(id, w / 2, h / 2 - size * 0.6, w * 0.95);
    c.font = `${size * 0.8}px system-ui, sans-serif`;
    c.fillText(reason, w / 2, h / 2 + size * 0.6, w * 0.95);
    return out;
  });
}

/** The upright canvas turned by the element's rotation (counter-clockwise as seen), on a bounding canvas. */
function rotated(src: HTMLCanvasElement, rot: number): HTMLCanvasElement {
  if (Math.abs(rot) < 1e-6) return src;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const out = canvas(src.width * cos + src.height * sin, src.width * sin + src.height * cos);
  const c = cpu2d(out);
  c.translate(out.width / 2, out.height / 2);
  c.rotate(-rot);
  c.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

let scratch: HTMLCanvasElement | null = null;
let maskCanvas: HTMLCanvasElement | null = null;

function scratchCanvas(w: number, h: number): HTMLCanvasElement {
  scratch ??= cpuCanvas(w, h);
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  } else cpu2d(scratch).clearRect(0, 0, w, h);
  return scratch;
}

function maskImage(mask: ReturnType<typeof shapeMask>): HTMLCanvasElement {
  maskCanvas ??= cpuCanvas(1, 1);
  maskCanvas.width = mask.width;
  maskCanvas.height = Math.max(1, mask.rows);
  const c = cpu2d(maskCanvas);
  const img = c.createImageData(mask.width, Math.max(1, mask.rows));
  for (let i = 0; i < mask.alpha.length; i++) img.data[i * 4 + 3] = mask.alpha[i]!;
  c.putImageData(img, 0, 0);
  return maskCanvas;
}

/** Paints a pattern over the shape's rows, then keeps only the pixels inside the shape. */
function drawPattern(
  ctx: CanvasRenderingContext2D,
  profile: ArmProfile,
  id: string,
  pattern: string,
  density: number,
  shape: Shape,
  opts: ReferenceOptions,
) {
  const ppc = opts.pxPerCm;
  const mask = shapeMask(shape, profile, ppc, opts.centerU);
  if (mask.rows === 0) return;
  const W = ctx.canvas.width;
  const layer = scratchCanvas(W, ctx.canvas.height);
  const lc = cpu2d(layer);
  let x = 0;
  let w = W;
  let ringCm: number | undefined;
  if (shape.kind === "band") {
    // Exactly one ring wide, starting at the image edge (the seam in the outer-centred texture), so the
    // painter's whole number of repeats meets itself there.
    ringCm = profile.circumferenceAt(shape.y);
    x = W / 2 - (ringCm * ppc) / 2;
    w = ringCm * ppc;
  }
  lc.save();
  getPattern(pattern)({
    ctx: lc,
    x,
    y: mask.rowStart,
    w,
    h: mask.rows,
    pxPerCm: ppc,
    density,
    seed: seedFromId(id),
    ink: INK,
    ringCm,
  });
  lc.restore();
  lc.globalCompositeOperation = "destination-in";
  lc.drawImage(maskImage(mask), 0, mask.rowStart);
  lc.globalCompositeOperation = "source-over";
  ctx.drawImage(layer, 0, 0);
}

function fillMask(
  ctx: CanvasRenderingContext2D,
  mask: ReturnType<typeof shapeMask>,
  color: string,
  alpha: number,
) {
  if (mask.rows === 0) return;
  const layer = scratchCanvas(ctx.canvas.width, ctx.canvas.height);
  const lc = cpu2d(layer);
  lc.fillStyle = color;
  lc.fillRect(0, mask.rowStart, mask.width, mask.rows);
  lc.globalCompositeOperation = "destination-in";
  lc.drawImage(maskImage(mask), 0, mask.rowStart);
  lc.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
}
