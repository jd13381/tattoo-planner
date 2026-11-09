// Padding for generative edits (ADR 0008, 2026-11-09): GPT Image answers in a few fixed sizes, so a
// photo of any other shape came back stretched or cropped and no longer lined up with the original
// (a projection draws the edit over the photo's frame). Before the request the image is padded to the
// closest supported aspect (centred, plain bars) and scaled down to that output size; the answer is
// cropped back to where the image sat, so it has the original's aspect again. Pure maths and RGBA
// pixel work; the dev server (server/editsApi.ts) decodes, encodes and sends.

/** Output sizes the edit endpoint takes besides "auto" (same as CREATE_SIZES). */
export const GPT_EDIT_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export type GptEditSize = (typeof GPT_EDIT_SIZES)[number];

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
/** RGBA pixels, row-major, 4 bytes each. */
export type Rgba = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

export function sizeOf(s: GptEditSize): Size {
  const [width, height] = s.split("x").map(Number) as [number, number];
  return { width, height };
}

/** The supported size whose aspect is closest to width / height (log ratio; ties: first listed). */
export function closestSize(
  width: number,
  height: number,
  sizes: readonly GptEditSize[] = GPT_EDIT_SIZES,
): GptEditSize {
  const aspect = Math.log(width / height);
  let best = sizes[0]!;
  let bestDist = Infinity;
  for (const s of sizes) {
    const { width: w, height: h } = sizeOf(s);
    const d = Math.abs(Math.log(w / h) - aspect);
    if (d < bestDist - 1e-12) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

export type PadPlan = {
  /** Sent as the request's `size`. */
  size: GptEditSize;
  /** The image as it is. */
  source: Size;
  /** The canvas after padding, in source pixels: the size's aspect, never smaller than the source. */
  padded: Size;
  /** Where the source sits in the padded canvas (centred). */
  offset: { x: number; y: number };
  /** What is sent: the padded canvas scaled down to fit the output size (never scaled up). */
  send: Size;
};

export function padPlan(width: number, height: number, sizes?: readonly GptEditSize[]): PadPlan {
  if (!(width > 0 && height > 0)) throw new Error("the image has no size");
  const size = closestSize(width, height, sizes);
  const out = sizeOf(size);
  const target = out.width / out.height;
  const padded =
    target > width / height
      ? { width: Math.max(width, Math.round(height * target)), height }
      : { width, height: Math.max(height, Math.round(width / target)) };
  const offset = {
    x: Math.floor((padded.width - width) / 2),
    y: Math.floor((padded.height - height) / 2),
  };
  const scale = Math.min(1, out.width / padded.width, out.height / padded.height);
  const send = {
    width: Math.max(1, Math.round(padded.width * scale)),
    height: Math.max(1, Math.round(padded.height * scale)),
  };
  return { size, source: { width, height }, padded, offset, send };
}

/** Whether padding adds bars (else the answer needs no crop). */
export function isPadded(plan: PadPlan): boolean {
  return plan.padded.width !== plan.source.width || plan.padded.height !== plan.source.height;
}

/** Whether the image sent differs from the source at all (bars or a smaller size). */
export function changesInput(plan: PadPlan): boolean {
  return isPadded(plan) || plan.send.width !== plan.padded.width || plan.send.height !== plan.padded.height;
}

/**
 * Where the source lies in an answer of size `result` (normally plan.send's aspect at the output
 * size): the padded canvas scaled to the answer, bars cut off. Rounded to whole pixels, inside the
 * answer, at least 1 × 1.
 */
export function contentRect(plan: PadPlan, result: Size): Rect {
  const sx = result.width / plan.padded.width;
  const sy = result.height / plan.padded.height;
  const clampX = (v: number) => Math.min(result.width, Math.max(0, Math.round(v)));
  const clampY = (v: number) => Math.min(result.height, Math.max(0, Math.round(v)));
  const x0 = Math.min(clampX(plan.offset.x * sx), result.width - 1);
  const y0 = Math.min(clampY(plan.offset.y * sy), result.height - 1);
  const x1 = Math.max(x0 + 1, clampX((plan.offset.x + plan.source.width) * sx));
  const y1 = Math.max(y0 + 1, clampY((plan.offset.y + plan.source.height) * sy));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export type PadFill = "transparent" | "grey";

/** Bars stay transparent for an image with transparency (a cut-out), else a plain mid grey. */
export function padFill(img: Rgba): PadFill {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! < 255) return "transparent";
  return "grey";
}

const FILL_RGBA: Record<PadFill, readonly [number, number, number, number]> = {
  transparent: [0, 0, 0, 0],
  grey: [128, 128, 128, 255],
};

/**
 * The image to send: `img` (plan.source) centred on the padded canvas with `fill` bars, scaled down
 * to plan.send by averaging each block of pixels (weighted by alpha, so cut-out edges get no halo).
 */
export function padRgba(img: Rgba, plan: PadPlan, fill: PadFill): Rgba {
  if (img.width !== plan.source.width || img.height !== plan.source.height)
    throw new Error("the pixels do not match the plan");
  const { width: W, height: H } = plan.padded;
  const { width: dw, height: dh } = plan.send;
  const [fr, fg, fb, fa] = FILL_RGBA[fill];
  const out = new Uint8Array(dw * dh * 4);
  const bounds = (d: number, n: number, D: number) => {
    const a = Math.floor((d * D) / n);
    return [a, Math.max(a + 1, Math.floor(((d + 1) * D) / n))] as const;
  };
  for (let dy = 0; dy < dh; dy++) {
    const [y0, y1] = bounds(dy, dh, H);
    for (let dx = 0; dx < dw; dx++) {
      const [x0, x1] = bounds(dx, dw, W);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        const sy = y - plan.offset.y;
        for (let x = x0; x < x1; x++) {
          const sx = x - plan.offset.x;
          n++;
          if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) {
            r += fr * fa;
            g += fg * fa;
            b += fb * fa;
            a += fa;
            continue;
          }
          const i = (sy * img.width + sx) * 4;
          const pa = img.data[i + 3]!;
          r += img.data[i]! * pa;
          g += img.data[i + 1]! * pa;
          b += img.data[i + 2]! * pa;
          a += pa;
        }
      }
      const o = (dy * dw + dx) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: dw, height: dh, data: out };
}

/** The pixels inside `rect`. */
export function cropRgba(img: Rgba, rect: Rect): Rgba {
  const out = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * img.width + rect.x) * 4;
    out.set(img.data.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return { width: rect.width, height: rect.height, data: out };
}

/** The prompt line that tells the model about the bars; null when nothing was padded. */
export function padPromptLine(plan: PadPlan, fill: PadFill): string | null {
  if (!isPadded(plan)) return null;
  const sides = plan.padded.width > plan.source.width ? "left and right" : "top and bottom";
  const bars = fill === "transparent" ? "transparent" : "plain grey";
  return `The image has ${bars} padding bars at the ${sides}. They are cut off afterwards: keep them ${bars}, and do not move the picture or extend it into them.`;
}

/**
 * Longest side of the PNG the studio page makes of a photo that is not a PNG before its first
 * generative edit (the server can only pad PNGs). Larger than any output size, so nothing is lost.
 */
export const PNG_SOURCE_MAX_SIDE = 2048;

/** Whether the page sends a PNG copy of this file before a generative edit (JPEG, WebP, …). */
export function needsPngSource(file: string): boolean {
  return !/\.png$/i.test(file);
}
