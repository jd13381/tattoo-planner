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

/** POST: catalogue new images in the data folder (the same as `npm run assets:scan`) → ScanReport. */
export const ASSETS_SCAN_ENDPOINT = "/api/assets/scan";

export type ScanReport = {
  /** Images in the scanned folders (cards/, refs/, existing/, arm-photos/). */
  found: number;
  /** Ids of the entries this scan added. */
  added: string[];
  /** Images in a format the browser cannot show (HEIC, TIFF …): not catalogued. */
  unsupported: string[];
  /** Images outside the scanned folders: not catalogued. */
  outside: string[];
  /** The data folder has more files than one listing covers; some may be missed. */
  truncated: boolean;
};

/** One line for the UI about what a scan did. */
export function scanSummary(r: ScanReport): string {
  const parts = [
    r.added.length === 0
      ? "No new images"
      : `${r.added.length} new image${r.added.length === 1 ? "" : "s"} added`,
  ];
  if (r.unsupported.length > 0)
    parts.push(
      `${r.unsupported.length} skipped (HEIC/TIFF; export as JPEG or PNG): ${r.unsupported.slice(0, 3).join(", ")}`,
    );
  if (r.outside.length > 0)
    parts.push(
      `${r.outside.length} outside cards/, refs/, existing/, arm-photos/: ${r.outside.slice(0, 3).join(", ")}${r.outside.length > 3 ? " …" : ""}`,
    );
  if (r.truncated) parts.push("the data folder is large; some files may be missed");
  return parts.join(" · ");
}

export function assetImageUrl(id: string): string {
  return `${ASSET_IMAGE_ENDPOINT}/${encodeURIComponent(id)}`;
}

/** PATCH (JSON { tags?, notes?, hidden? }): edit one manifest entry → the new AssetListing. */
export function assetEntryUrl(id: string): string {
  return `${ASSETS_ENDPOINT}/entries/${encodeURIComponent(id)}`;
}
