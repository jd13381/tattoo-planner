// Renders the unwrap texture for one mode. The same canvas feeds the 2D editor and the 3D arm.
import type { ArmProfile } from "../arm/profile.ts";
import type { Layout } from "../layout/schema.ts";
import { classify, type Classification, type ExistingSize } from "../layout/shapes.ts";
import { blockoutPixels } from "./blockout.ts";
import { OVERLAY_GRID_STYLE, paintGrid } from "./cmGrid.ts";

export type RenderMode = "grid" | "blockout";

export type UnwrapRender = { canvas: HTMLCanvasElement; classification: Classification | null };

export function renderUnwrap(
  canvas: HTMLCanvasElement,
  profile: ArmProfile,
  mode: RenderMode,
  layout: Layout | null,
  opts: { pxPerCm: number; grid: boolean; selected?: number; existing?: ExistingSize; centerU?: number },
): Classification | null {
  canvas.width = Math.ceil(profile.maxCircumference * opts.pxPerCm);
  canvas.height = Math.ceil(profile.length * opts.pxPerCm);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (mode === "grid" || !layout) {
    paintGrid(ctx, profile, opts.pxPerCm);
    return null;
  }
  const cls = classify(layout, profile, opts.pxPerCm, opts.existing, opts.centerU ?? 0);
  ctx.putImageData(new ImageData(blockoutPixels(cls, opts.selected), cls.width, cls.height), 0, 0);
  // The grid's centre lines are labelled for the outer-centred texture; skip it for the inner view.
  if (opts.grid && (opts.centerU ?? 0) === 0)
    paintGrid(ctx, profile, opts.pxPerCm, OVERLAY_GRID_STYLE, { background: false });
  return cls;
}
