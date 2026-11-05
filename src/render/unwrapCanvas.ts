// Renders the unwrap texture for one mode. The same canvas feeds the 2D editor and the 3D arm.
import type { ArmProfile } from "../body/profile.ts";
import type { ElementAspects } from "../layout/imageFit.ts";
import type { Layout } from "../layout/schema.ts";
import { classify, type Classification, type ExistingSize } from "../layout/shapes.ts";
import { blockoutPixels } from "./blockout.ts";
import { OVERLAY_GRID_STYLE, paintGrid } from "./cmGrid.ts";
import { renderReference, type ReferenceSources } from "./reference.ts";

export type RenderMode = "grid" | "blockout" | "reference";

/** Milliseconds a render call takes (shown in the UI to keep mode switching honest). */
export function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

export type UnwrapRender = { canvas: HTMLCanvasElement; classification: Classification | null };

export function renderUnwrap(
  canvas: HTMLCanvasElement,
  profile: ArmProfile,
  mode: RenderMode,
  layout: Layout | null,
  opts: {
    pxPerCm: number;
    grid: boolean;
    selected?: number;
    existing?: ExistingSize;
    centerU?: number;
    /** Image proportions per element id, so every mode uses the same boxes. */
    aspects?: ElementAspects;
    /** Reference mode only: manifest entries and decoded images. */
    sources?: ReferenceSources;
  },
): Classification | null {
  canvas.width = Math.ceil(profile.maxCircumference * opts.pxPerCm);
  canvas.height = Math.ceil(profile.length * opts.pxPerCm);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (mode === "grid" || !layout) {
    paintGrid(ctx, profile, opts.pxPerCm);
    return null;
  }
  if (mode === "reference") {
    renderReference(ctx, profile, layout, {
      pxPerCm: opts.pxPerCm,
      centerU: opts.centerU ?? 0,
      grid: opts.grid,
      existing: opts.existing,
      sources: opts.sources ?? { assets: null, images: new Map(), aspects: opts.aspects ?? new Map() },
    });
    return null;
  }
  const cls = classify(
    layout,
    profile,
    opts.pxPerCm,
    opts.existing,
    opts.centerU ?? 0,
    opts.aspects,
    opts.sources?.patches,
  );
  ctx.putImageData(new ImageData(blockoutPixels(cls, opts.selected), cls.width, cls.height), 0, 0);
  // The grid's centre lines are labelled for the outer-centred texture; skip it for the inner view.
  if (opts.grid && (opts.centerU ?? 0) === 0)
    paintGrid(ctx, profile, opts.pxPerCm, OVERLAY_GRID_STYLE, { background: false });
  return cls;
}
