// Contract between the dev-server asset middleware (Node) and the browser UI.
import type { Asset } from "./manifest.ts";

/** GET: the parsed manifest plus a check of which files exist. */
export const ASSETS_ENDPOINT = "/api/assets";
/** GET `${ASSET_IMAGE_ENDPOINT}/<asset id>`: the image bytes of one manifest asset (local dev server only). */
export const ASSET_IMAGE_ENDPOINT = "/api/assets/image";

export type AssetInfo = Asset & {
  /** False when the manifest names a file that is not in the data folder. */
  exists: boolean;
};

export type AssetListing =
  | { status: "ok"; assets: AssetInfo[]; manifestFound: boolean; warnings: string[] }
  | { status: "unset" }
  | { status: "error"; message: string };

export function assetImageUrl(id: string): string {
  return `${ASSET_IMAGE_ENDPOINT}/${encodeURIComponent(id)}`;
}
