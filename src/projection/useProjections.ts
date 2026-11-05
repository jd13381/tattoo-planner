// Browser side of the photo projections (docs/adr/0006): the calibrations from config/projections/
// (via the dev server), the photos' pixels and a cache of built patches. A patch is built in the
// browser from the photos the asset server already serves, so nothing is written to the data folder
// and a saved calibration shows at once.
import { useCallback, useSyncExternalStore } from "react";
import type { RegionProfile } from "../body/profile.ts";
import { fileKey } from "../assets/manifestDoc.ts";
import type { AssetInfo } from "../assets/types.ts";
import type { AssetImage } from "../render/reference.ts";
import { buildPatch, type PhotoPixels, type ProjectedPatch } from "./patch.ts";
import type { ProjectionCalibration } from "./schema.ts";
import { parseProjection } from "./yamlDoc.ts";

export const PROJECTIONS_ENDPOINT = "/api/projections";

export type StoredProjection = { name: string; text: string };

export type ProjectionStore = {
  /** null until the list has arrived (or when it failed). */
  files: StoredProjection[] | null;
  calibrations: ReadonlyMap<string, ProjectionCalibration>;
  /** Parse errors by projection name. */
  errors: ReadonlyMap<string, string>;
  loadError: string | null;
};

let store: ProjectionStore = { files: null, calibrations: new Map(), errors: new Map(), loadError: null };
let started = false;
const listeners = new Set<() => void>();

function setFiles(files: StoredProjection[] | null, loadError: string | null = null) {
  const calibrations = new Map<string, ProjectionCalibration>();
  const errors = new Map<string, string>();
  for (const f of files ?? []) {
    const r = parseProjection(f.text);
    if (r.ok) calibrations.set(f.name, r.calibration);
    else errors.set(f.name, r.error);
  }
  store = { files, calibrations, errors, loadError };
  listeners.forEach((l) => l());
}

export async function reloadProjections(): Promise<void> {
  try {
    const r = await fetch(PROJECTIONS_ENDPOINT);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setFiles((await r.json()) as StoredProjection[]);
  } catch (e) {
    setFiles(
      [],
      `Cannot load projections (${String(e)}). The planner's local server did not answer; restart the planner.`,
    );
  }
}

/** Writes a calibration through the dev server and updates every view that uses it. */
export async function saveProjection(calibration: ProjectionCalibration): Promise<void> {
  const r = await fetch(`${PROJECTIONS_ENDPOINT}/${encodeURIComponent(calibration.name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ calibration }),
  });
  if (!r.ok) {
    let message = `HTTP ${r.status}`;
    try {
      message = ((await r.json()) as { error?: string }).error ?? message;
    } catch {
      // keep the status
    }
    throw new Error(message);
  }
  const saved = (await r.json()) as StoredProjection;
  const others = (store.files ?? []).filter((f) => f.name !== saved.name);
  setFiles([...others, saved].sort((a, b) => a.name.localeCompare(b.name)));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (!started) {
    started = true;
    void reloadProjections();
  }
  return () => listeners.delete(l);
};

export function useProjections(): ProjectionStore & { reload: () => void } {
  const s = useSyncExternalStore(subscribe, () => store);
  const reload = useCallback(() => void reloadProjections(), []);
  return { ...s, reload };
}

/** The manifest entry of each photo (matched by file path, case-insensitive), or null. */
export function photoAssets(
  cal: ProjectionCalibration,
  assets: ReadonlyMap<string, AssetInfo> | null,
): (AssetInfo | null)[] {
  const byFile = new Map<string, AssetInfo>();
  for (const a of assets?.values() ?? []) byFile.set(fileKey(a.file), a);
  return cal.photos.map((p) => byFile.get(fileKey(p.file)) ?? null);
}

const pixelCache = new WeakMap<object, PhotoPixels>();

/** RGBA pixels of a decoded image (already upright by its EXIF orientation), read once and cached. */
export function pixelsOf(img: Extract<AssetImage, { status: "ready" }>): PhotoPixels | null {
  const key = img.image as object;
  const hit = pixelCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img.image, 0, 0);
  const px = {
    width: img.width,
    height: img.height,
    data: ctx.getImageData(0, 0, img.width, img.height).data,
  };
  pixelCache.set(key, px);
  return px;
}

export type PatchStatus =
  | { status: "ready"; patch: ProjectedPatch; missing: string[] }
  | { status: "loading" }
  | { status: "unavailable"; reason: string };

const patchCache = new WeakMap<RegionProfile, Map<string, ProjectedPatch | null>>();

/**
 * The patch of a calibration from the photos that are available. Photos still loading make it
 * "loading"; missing photos are left out (listed in `missing`) as long as one is there.
 */
export function patchFor(
  cal: ProjectionCalibration,
  profile: RegionProfile,
  assets: ReadonlyMap<string, AssetInfo> | null,
  images: ReadonlyMap<string, AssetImage>,
): PatchStatus {
  if (!assets) return { status: "unavailable", reason: "no data folder" };
  const infos = photoAssets(cal, assets);
  const missing: string[] = [];
  const pixels: (PhotoPixels | null)[] = [];
  const versions: (number | null)[] = [];
  for (const [k, info] of infos.entries()) {
    const file = cal.photos[k]!.file;
    if (!info) {
      missing.push(`${file}: not in manifest`);
    } else if (!info.exists) {
      missing.push(`${file}: file missing`);
    } else {
      const img = images.get(info.id);
      if (!img || img.status === "loading") return { status: "loading" };
      if (img.status === "error") missing.push(`${file}: ${img.message}`);
      else {
        const px = pixelsOf(img);
        pixels.push(px);
        versions.push(px ? img.version : null);
        continue;
      }
    }
    pixels.push(null);
    versions.push(null);
  }
  if (!pixels.some((p) => p)) return { status: "unavailable", reason: missing.join("; ") || "no photos" };
  let byKey = patchCache.get(profile);
  if (!byKey) patchCache.set(profile, (byKey = new Map()));
  const key = JSON.stringify([cal, versions]);
  let patch = byKey.get(key);
  if (patch === undefined) {
    patch = buildPatch(cal, profile, pixels);
    byKey.set(key, patch);
    // Keep a handful: editing a calibration creates a new key per change.
    if (byKey.size > 8) byKey.delete(byKey.keys().next().value!);
  }
  return patch ? { status: "ready", patch, missing } : { status: "unavailable", reason: "no photos" };
}
