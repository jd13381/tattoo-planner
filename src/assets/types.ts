// Contract between the dev-server asset middleware (Node) and the browser UI.
import type { PersonRef } from "../project/persons.ts";
import type { AssetCategory } from "./category.ts";
import type { Asset } from "./manifest.ts";
import type { EntryPatch } from "./manifestDoc.ts";
import type { AssetUse, UsageMap } from "./references.ts";

/** GET: the parsed manifest plus a check of which files exist. */
export const ASSETS_ENDPOINT = "/api/assets";
/** GET `${ASSET_IMAGE_ENDPOINT}/<asset id>`: the image bytes of one manifest asset (local dev server only). */
export const ASSET_IMAGE_ENDPOINT = "/api/assets/image";

export type AssetInfo = Asset & {
  /** False when the manifest names a file that is not in the data folder. */
  exists: boolean;
  /** The section it is shown in: the `category` field, else derived (src/assets/category.ts). */
  effectiveCategory: AssetCategory;
  /** The person a photo belongs to; null for the shared library. */
  effectivePerson: string | null;
};

/**
 * Where "Move to Trash" puts files: the system Trash (desktop app; macOS ~/.Trash) or, where there
 * is none, the project's own .trash/ folder.
 */
export type TrashMode = "system" | "project";

export type AssetListing =
  | {
      status: "ok";
      assets: AssetInfo[];
      manifestFound: boolean;
      warnings: string[];
      /** Persons of the project; the first is the implicit one. */
      persons?: PersonRef[];
      trash?: TrashMode;
      /** The sample project: nothing can be changed. */
      readOnly?: boolean;
    }
  | { status: "unset" }
  | { status: "error"; message: string };

/** POST: catalogue new images in the data folder (the same as `npm run assets:scan`) → ScanReport. */
export const ASSETS_SCAN_ENDPOINT = "/api/assets/scan";

export type ScanReport = {
  /** Images in the scanned folders (images/, photos/ and the older cards/, refs/, existing/, arm-photos/). */
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
      `${r.outside.length} outside images/, photos/ and the other image folders: ${r.outside.slice(0, 3).join(", ")}${r.outside.length > 3 ? " …" : ""}`,
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

/** GET: asset id → where it is used (layouts of every person, projections, edits, studio sessions). */
export const ASSETS_USAGE_ENDPOINT = "/api/assets/usage";
export type UsageListing = { usage: UsageMap };
export type { AssetUse, UsageMap };

/** POST: one action on several entries (at most MAX_BATCH ids). */
export const ASSETS_BATCH_ENDPOINT = "/api/assets/batch";
export const MAX_BATCH = 500;
export type BatchAction = "hide" | "unhide" | "set" | "delete";
export type BatchRequest = {
  action: BatchAction;
  ids: string[];
  /** action "set": the fields to change on every entry (category, person, tags …). */
  patch?: EntryPatch;
  /** action "delete": also delete photos that projections use (they break). */
  force?: boolean;
};

/** What a batch did; `undo` can be sent for a few seconds (POST ASSETS_UNDO_ENDPOINT/<token>). */
export type BatchResult = {
  listing: AssetListing;
  changed: string[];
  undo: { token: string; expiresAt: string } | null;
  /** action "delete": files moved away (several entries can share one file). */
  files?: number;
};

/** The 409 body of a delete that needs confirmation or cannot be done. */
export type DeleteRefusal = {
  error: string;
  /** Ids open in the Image studio: never deleted. */
  inSession: string[];
  /** Projection uses: deleted only with force. */
  projections: { id: string; use: AssetUse }[];
};

export const ASSETS_UNDO_ENDPOINT = "/api/assets/undo";
/** POST <token>: makes a pending delete final now (the undo toast closed, the page unloads). */
export const ASSETS_COMMIT_ENDPOINT = "/api/assets/commit";
/** How long an action can be undone in the page (the toast); the server keeps it a little longer. */
export const UNDO_MS = 8000;

/**
 * POST raw bytes ?name=<file name>&category=<category>&person=<id>: copies one dropped image into
 * the section's folder and catalogues it → ImportResult.
 */
export const ASSETS_IMPORT_ENDPOINT = "/api/assets/import";
export type ImportResult = { listing: AssetListing; id: string; file: string };
/** Largest image a drop accepts (bytes). */
export const MAX_IMPORT_BYTES = 60 * 1024 * 1024;
