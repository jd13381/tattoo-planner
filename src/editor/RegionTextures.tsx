// Textures of the regions that are not open in the editor, for the full-body view: each region's
// displayed layout, painted in the editor's mode with its own reference images. One component per
// region, so each can load its images with the usual hook.
import { useEffect, useMemo } from "react";
import type { AssetInfo } from "../assets/types.ts";
import { useLayoutSources } from "../assets/useLayoutSources.ts";
import type { RegionProfile } from "../body/profile.ts";
import type { RegionId } from "../body/regions.ts";
import type { Layout } from "../layout/schema.ts";
import type { ExistingSize } from "../layout/shapes.ts";
import { renderUnwrap, type RenderMode } from "../render/unwrapCanvas.ts";
import type { RegionTexture } from "../viewer/BodyViewer.tsx";

/** The full-body view shows the regions small: 8 px per cm is plenty. */
const BODY_PX_PER_CM = 8;

export function RegionTextureSource(props: {
  id: RegionId;
  layout: Layout;
  profile: RegionProfile;
  mode: RenderMode;
  grid: boolean;
  existing: ExistingSize;
  assetMap: ReadonlyMap<string, AssetInfo> | null;
  listingLoaded: boolean;
  onTexture: (id: RegionId, t: RegionTexture | null) => void;
}) {
  const { id, layout, profile, mode, grid, existing, assetMap, listingLoaded, onTexture } = props;
  const { aspects, sources } = useLayoutSources(layout, assetMap, listingLoaded, profile);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    renderUnwrap(canvas, profile, mode, layout, {
      pxPerCm: BODY_PX_PER_CM,
      grid,
      existing,
      aspects,
      sources,
    });
    return { canvas, version: 0 };
  }, [profile, mode, layout, grid, existing, aspects, sources]);
  useEffect(() => {
    onTexture(id, texture);
    return () => onTexture(id, null);
  }, [id, texture, onTexture]);
  return null;
}
