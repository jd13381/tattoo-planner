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
import { resolveElement, type ExistingSize, type Shape } from "../layout/shapes.ts";
import { BLOCKOUT_COLORS } from "./blockout.ts";
import { OVERLAY_GRID_STYLE, paintGrid } from "./cmGrid.ts";
import { processPixels } from "./imageOps.ts";
import { getPattern, seedFromId } from "./patterns/index.ts";
import { screenX, shapeMask, wrapStrip } from "./unwrapRows.ts";

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
    const r = resolveElement(el, profile, opts.existing, sources.aspects.get(el.id));
    if (isFigureLike(el) && r.shape.kind === "box") {
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

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

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
    const c = out.getContext("2d", { willReadFrequently: true })!;
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
    const c = out.getContext("2d")!;
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
  const c = out.getContext("2d")!;
  c.translate(out.width / 2, out.height / 2);
  c.rotate(-rot);
  c.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

let scratch: HTMLCanvasElement | null = null;
let maskCanvas: HTMLCanvasElement | null = null;

function scratchCanvas(w: number, h: number): HTMLCanvasElement {
  scratch ??= document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  } else scratch.getContext("2d")!.clearRect(0, 0, w, h);
  return scratch;
}

function maskImage(mask: ReturnType<typeof shapeMask>): HTMLCanvasElement {
  maskCanvas ??= document.createElement("canvas");
  maskCanvas.width = mask.width;
  maskCanvas.height = Math.max(1, mask.rows);
  const c = maskCanvas.getContext("2d")!;
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
  const lc = layer.getContext("2d")!;
  let x = 0;
  let w = W;
  let ringCm: number | undefined;
  if (shape.kind === "band") {
    // Bands start at the seam so a whole number of repeats can meet itself there.
    ringCm = profile.circumferenceAt(shape.y);
    let widest = ringCm;
    for (const y of [shape.y - shape.half, shape.y + shape.half])
      widest = Math.max(widest, profile.circumferenceAt(Math.min(profile.length, Math.max(0, y))));
    x = W / 2 - (widest * ppc) / 2;
    w = widest * ppc;
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
  const lc = layer.getContext("2d")!;
  lc.fillStyle = color;
  lc.fillRect(0, mask.rowStart, mask.width, mask.rows);
  lc.globalCompositeOperation = "destination-in";
  lc.drawImage(maskImage(mask), 0, mask.rowStart);
  lc.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
}
