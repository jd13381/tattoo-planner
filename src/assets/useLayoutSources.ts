// Reference images and image proportions for one layout, shared by the Layout and Compare tabs.
import { useEffect, useMemo } from "react";
import { elementAspects, isFigureLike, type ElementAspects, type ImageDims } from "../layout/imageFit.ts";
import type { Layout } from "../layout/schema.ts";
import type { ReferenceSources } from "../render/reference.ts";
import type { AssetInfo } from "./types.ts";
import { requestImage, useAssetImages } from "./useAssets.ts";

export type LayoutSources = {
  /** Asset ids the layout's figures and existing tattoos use. */
  usedAssets: string[];
  aspects: ElementAspects;
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
): LayoutSources {
  const { images, version: imagesVersion } = useAssetImages();
  const usedAssets = useMemo(
    () => [
      ...new Set((layout?.elements ?? []).flatMap((e) => (isFigureLike(e) && e.asset ? [e.asset] : []))),
    ],
    [layout],
  );
  useEffect(() => {
    for (const id of usedAssets) if (assetMap?.get(id)?.exists) requestImage(id);
  }, [usedAssets, assetMap]);
  const aspects = useMemo(() => {
    void imagesVersion; // the image map is mutated in place; the version marks a change
    const dims = new Map<string, ImageDims>();
    for (const [id, img] of images) if (img.status === "ready") dims.set(id, img);
    return elementAspects(layout?.elements ?? [], assetMap ?? new Map(), dims);
  }, [layout, assetMap, images, imagesVersion]);
  const sources = useMemo<ReferenceSources>(() => {
    void imagesVersion;
    return { assets: assetMap, images, aspects };
  }, [assetMap, images, aspects, imagesVersion]);
  // An image the manifest lists but the cache has not started on yet counts as loading too.
  const loading =
    !listingLoaded ||
    usedAssets.some((id) => {
      const img = images.get(id);
      return img ? img.status === "loading" : !!assetMap?.get(id)?.exists;
    });
  return { usedAssets, aspects, sources, loading };
}
