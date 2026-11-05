// Browser glue for the built-in engine (ADR 0013): decode an image URL into RGBA pixels, optionally
// scaled down for a preview, and encode pixels as PNG for the upload. Thin by design; the operations
// themselves are framework-free in src/render/builtinOps.ts.
import type { Pixels } from "../render/builtinOps.ts";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${src}`));
    img.src = src;
  });
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("this browser cannot draw into a canvas");
  return [c, ctx];
}

/** Decoded pixels of an image, scaled down so its longer side is at most `maxSide`; also the full size. */
export async function loadPixels(
  src: string,
  maxSide = Infinity,
): Promise<{ pixels: Pixels; fullWidth: number; fullHeight: number; scale: number }> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const [, ctx] = canvas2d(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return {
    pixels: ctx.getImageData(0, 0, w, h),
    fullWidth: img.naturalWidth,
    fullHeight: img.naturalHeight,
    scale: w / Math.max(1, img.naturalWidth),
  };
}

export function drawPixels(target: HTMLCanvasElement, px: Pixels): void {
  target.width = px.width;
  target.height = px.height;
  target
    .getContext("2d")
    ?.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
}

/** PNG bytes of the pixels. */
export function encodePng(px: Pixels): Promise<Blob> {
  const [c] = canvas2d(px.width, px.height);
  drawPixels(c, px);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the PNG"))), "image/png"),
  );
}
