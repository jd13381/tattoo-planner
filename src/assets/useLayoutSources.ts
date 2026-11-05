// Reference images and image proportions for one layout, shared by the Layout and Compare tabs.
import { useEffect, useMemo } from "react";
import type { RegionProfile } from "../body/profile.ts";
import type { ElementPatches } from "../layout/shapes.ts";
import type { ProjectedPatch } from "../projection/patch.ts";
import { patchFor, photoAssets, useProjections } from "../projection/useProjections.ts";
import { elementAspects, isFigureLike, type ElementAspects, type ImageDims } from "../layout/imageFit.ts";
import type { Layout } from "../layout/schema.ts";
import type { ReferenceSources } from "../render/reference.ts";
import type { AssetInfo } from "./types.ts";
import { requestImage, useAssetImages } from "./useAssets.ts";

export type LayoutSources = {
  /** Asset ids the layout's figures and existing tattoos use. */
  usedAssets: string[];
  aspects: ElementAspects;
  /** Existing tattoos built from their photos (docs/adr/0006), by element id. */
  patches: ElementPatches;
  /** Why an element with a projection falls back to its single photo, by element id. */
  patchIssues: ReadonlyMap<string, string>;
  sources: ReferenceSources;
  /** True while the listing or any used image is still on its way. */
  loading: boolean;
};

/**
 * Starts loading every image the layout uses and derives the element proportions from them. Images
 * load in every mode, because a figure without a width takes its image's proportions (imageFit.ts).
 * `assetMap` is null until the manifest listing has arrived (or when it failed).
 */
export function useLayoutSources(
  layout: Layout | null,
  assetMap: ReadonlyMap<string, AssetInfo> | null,
  listingLoaded: boolean,
  profile: RegionProfile,
): LayoutSources {
  const { images, version: imagesVersion } = useAssetImages();
  const { calibrations, files: projectionFiles } = useProjections();
  const usedAssets = useMemo(() => {
    const ids = new Set<string>();
    for (const e of layout?.elements ?? []) {
      if (!isFigureLike(e)) continue;
      if (e.asset) ids.add(e.asset);
      const cal = e.type === "existing" && e.projection ? calibrations.get(e.projection) : undefined;
      if (cal) for (const a of photoAssets(cal, assetMap)) if (a) ids.add(a.id);
    }
    return [...ids];
  }, [layout, calibrations, assetMap]);
  useEffect(() => {
    for (const id of usedAssets) if (assetMap?.get(id)?.exists) requestImage(id);
  }, [usedAssets, assetMap]);
  const aspects = useMemo(() => {
    void imagesVersion; // the image map is mutated in place; the version marks a change
    const dims = new Map<string, ImageDims>();
    for (const [id, img] of images) if (img.status === "ready") dims.set(id, img);
    return elementAspects(layout?.elements ?? [], assetMap ?? new Map(), dims);
  }, [layout, assetMap, images, imagesVersion]);
  const { patches, patchIssues, patchesLoading } = useMemo(() => {
    void imagesVersion;
    const patches = new Map<string, ProjectedPatch>();
    const patchIssues = new Map<string, string>();
    let patchesLoading = false;
    for (const e of layout?.elements ?? []) {
      if (e.type !== "existing" || !e.projection) continue;
      const cal = calibrations.get(e.projection);
      if (!cal) {
        if (projectionFiles === null) patchesLoading = true;
        else patchIssues.set(e.id, `projection ${e.projection} not found in config/projections/`);
        continue;
      }
      // Photo projection (docs/adr/0006) models the left forearm only.
      if (profile.kind !== "arm" || profile.mirrored) {
        patchIssues.set(e.id, "photo projection works on the left arm only");
        continue;
      }
      const r = patchFor(cal, profile, assetMap, images);
      if (r.status === "ready") {
        patches.set(e.id, r.patch);
        if (r.missing.length) patchIssues.set(e.id, `built without ${r.missing.join("; ")}`);
      } else if (r.status === "loading") patchesLoading = true;
      else patchIssues.set(e.id, r.reason);
    }
    return { patches, patchIssues, patchesLoading };
  }, [layout, calibrations, projectionFiles, profile, assetMap, images, imagesVersion]);
  const sources = useMemo<ReferenceSources>(() => {
    void imagesVersion;
    return { assets: assetMap, images, aspects, patches };
  }, [assetMap, images, aspects, patches, imagesVersion]);
  // An image the manifest lists but the cache has not started on yet counts as loading too.
  const loading =
    !listingLoaded ||
    (patchesLoading && !!assetMap) ||
    usedAssets.some((id) => {
      const img = images.get(id);
      return img ? img.status === "loading" : !!assetMap?.get(id)?.exists;
    });
  return { usedAssets, aspects, patches, patchIssues, sources, loading };
}
