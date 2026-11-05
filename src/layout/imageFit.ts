// How a figure's reference image is cut, turned and fitted into its box (reference mode, F6).
//
// 1. Cut-out: the element's `crop`, else the asset's default `crop`, else the whole image.
//    Normalised to the image as stored (0..1 from its left/top edge), before any turn.
// 2. Turn: `image_rotation_deg` (0/90/180/270, clockwise), then `flip` mirrors left-right.
// 3. Size: the box is the element's size_cm. When the width is not set, it follows the upright
//    cut-out's aspect ratio (so editor handles, metrics and picture agree). When both are set, the
//    image is fitted inside the box without distortion and centred ("contain").
// 4. Look: `filter`, default grayscale on the forearm (§4.2), none elsewhere; `feather_cm` softens
//    the cut-out's edges (default 1 cm).
// Plain TypeScript, no DOM: the canvas side lives in src/render/reference.ts.
import type { Asset, NormRect } from "../assets/manifest.ts";
import type { ArmProfile } from "../body/profile.ts";
import type { FigureLike, ImageFilter, LayoutElement } from "./schema.ts";

export const DEFAULT_FEATHER_CM = 1;
export const FULL_IMAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };

export type ImageDims = { width: number; height: number };
export type QuarterTurn = 0 | 90 | 180 | 270;

export type ImageSettings = {
  crop: NormRect;
  rotation: QuarterTurn;
  flip: boolean;
  featherCm: number;
  filter: ImageFilter;
};

export function isFigureLike(el: LayoutElement): el is FigureLike {
  return el.type === "figure" || el.type === "existing";
}

export function effectiveCrop(el: FigureLike, asset?: Pick<Asset, "crop">): NormRect {
  return el.crop ?? asset?.crop ?? FULL_IMAGE;
}

/** Forearm pieces default to grayscale (the illustrative end of the style gradient), the rest to colour. */
export function defaultFilter(el: FigureLike, profile: ArmProfile): ImageFilter {
  return el.position.v * profile.length < profile.elbowAt ? "grayscale" : "none";
}

export function imageSettings(
  el: FigureLike,
  profile: ArmProfile,
  asset?: Pick<Asset, "crop">,
): ImageSettings {
  return {
    crop: effectiveCrop(el, asset),
    rotation: el.image_rotation_deg ?? 0,
    flip: !!el.flip,
    featherCm: el.feather_cm ?? DEFAULT_FEATHER_CM,
    filter: el.filter ?? defaultFilter(el, profile),
  };
}

/** Width / height of the upright cut-out, in image pixels. */
export function croppedAspect(dims: ImageDims, crop: NormRect, rotation: QuarterTurn): number {
  const w = crop.w * dims.width;
  const h = crop.h * dims.height;
  if (w <= 0 || h <= 0) return 1;
  return rotation === 90 || rotation === 270 ? h / w : w / h;
}

/** Largest rectangle of the given aspect (w / h) inside the box, centred. */
export function fitContain(boxW: number, boxH: number, aspect: number): { w: number; h: number } {
  if (!(aspect > 0)) return { w: boxW, h: boxH };
  return boxW / boxH > aspect ? { w: boxH * aspect, h: boxH } : { w: boxW, h: boxW / aspect };
}

/** Element id → aspect of its upright cut-out, for the elements whose image size is known. */
export type ElementAspects = ReadonlyMap<string, number>;

export function elementAspects(
  elements: readonly LayoutElement[],
  assets: ReadonlyMap<string, Pick<Asset, "crop">>,
  dims: ReadonlyMap<string, ImageDims>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const el of elements) {
    if (!isFigureLike(el) || !el.asset) continue;
    const d = dims.get(el.asset);
    if (!d) continue;
    out.set(el.id, croppedAspect(d, effectiveCrop(el, assets.get(el.asset)), el.image_rotation_deg ?? 0));
  }
  return out;
}

/**
 * Where a point of the upright cut-out (0..1 from its left/top) lies in the stored image (0..1).
 * The inverse of turning the cut-out clockwise by `rotation` and then mirroring it.
 */
export function uprightToSource(
  px: number,
  py: number,
  crop: NormRect,
  rotation: QuarterTurn,
  flip: boolean,
): { x: number; y: number } {
  const fx = flip ? 1 - px : px;
  let sx: number;
  let sy: number;
  switch (rotation) {
    case 0:
      [sx, sy] = [fx, py];
      break;
    case 90: // clockwise: the source's left edge became the top
      [sx, sy] = [py, 1 - fx];
      break;
    case 180:
      [sx, sy] = [1 - fx, 1 - py];
      break;
    case 270:
      [sx, sy] = [1 - py, fx];
      break;
  }
  return { x: crop.x + sx * crop.w, y: crop.y + sy * crop.h };
}
