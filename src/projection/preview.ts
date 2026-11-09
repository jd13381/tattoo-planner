// The preview of a projection on its own: the 3D texture (the patch alone in reference mode, centred on
// the u = 0 line as every 3D view is) and a 2D crop of the unwrap around the patch rows.
import type { AssetInfo } from "../assets/types.ts";
import type { RegionProfile } from "../body/profile.ts";
import type { Layout } from "../layout/schema.ts";
import type { AssetImage } from "../render/reference.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import type { ProjectedPatch } from "./patch.ts";

const PREVIEW_ID = "projection-preview";

export function previewCanvases(args: {
  name: string;
  patch: ProjectedPatch | null;
  profile: RegionProfile;
  assets: ReadonlyMap<string, AssetInfo> | null;
  images: ReadonlyMap<string, AssetImage>;
  /** Top of the 2D crop (v); a little skin above it stays in. */
  v1: number;
  /** u in the middle of the 2D crop. */
  centerU: number;
  pxPerCm: number;
}): {
  texture: HTMLCanvasElement;
  innerImage: HTMLCanvasElement;
  /** Rows of the full unwrap cut off above the crop, px (src/projection/unwrapDrag.ts UnwrapView). */
  top: number;
} {
  const { name, patch, profile, pxPerCm } = args;
  const layout: Layout = {
    name: "projection-preview",
    elements: [
      {
        type: "existing",
        id: PREVIEW_ID,
        projection: name,
        locked: true,
        position: { u: 0.5, v: 0.2 },
        size_cm: { h: null },
      },
    ],
  };
  const sources = {
    assets: args.assets,
    images: args.images,
    aspects: new Map<string, number>(),
    patches: new Map<string, ProjectedPatch>(patch ? [[PREVIEW_ID, patch]] : []),
  };
  const make = (centerU: number) => {
    const c = document.createElement("canvas");
    c.className = "projection-unwrap";
    renderUnwrap(c, profile, patch ? "reference" : "grid", layout, { pxPerCm, grid: true, centerU, sources });
    return c;
  };
  const full = make(args.centerU);
  const top = Math.max(0, Math.floor((1 - args.v1) * full.height) - 2 * pxPerCm);
  const crop = document.createElement("canvas");
  crop.className = "projection-unwrap";
  crop.width = full.width;
  crop.height = full.height - top;
  crop.getContext("2d")!.drawImage(full, 0, top, full.width, crop.height, 0, 0, full.width, crop.height);
  return { texture: make(0), innerImage: crop, top };
}
