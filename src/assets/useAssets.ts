// Browser side of the asset manifest: the listing from the dev server and a cache of decoded images.
// Images are fetched and decoded once per page load and kept as ImageBitmaps, so switching render
// modes never decodes again. Nothing is uploaded anywhere: the only source is the local dev server.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { LAYOUT_SAVED_EVENT } from "../layout/useLayouts.ts";
import type { AssetImage } from "../render/reference.ts";
import { fetchUsage } from "./actions.ts";
import {
  assetImageUrl,
  ASSETS_ENDPOINT,
  ASSETS_SCAN_ENDPOINT,
  scanSummary,
  type AssetListing,
  type ScanReport,
  type UsageMap,
} from "./types.ts";

/** Longest side kept after decoding; plenty for 12 px/cm on a 30 cm piece, and light on memory. */
const MAX_DECODED_PX = 2048;

const images = new Map<string, AssetImage>();
const listeners = new Set<() => void>();
let storeVersion = 0;
let decodeCounter = 0;

function setImage(id: string, entry: AssetImage) {
  images.set(id, entry);
  storeVersion++;
  listeners.forEach((l) => l());
}

async function decode(id: string): Promise<AssetImage> {
  const r = await fetch(assetImageUrl(id));
  if (!r.ok) {
    let message = `HTTP ${r.status}`;
    try {
      message = ((await r.json()) as { error?: string }).error ?? message;
    } catch {
      // keep the status
    }
    return { status: "error", message };
  }
  let bmp = await createImageBitmap(await r.blob(), { imageOrientation: "from-image" });
  const scale = MAX_DECODED_PX / Math.max(bmp.width, bmp.height);
  if (scale < 1) {
    const small = await createImageBitmap(bmp, {
      resizeWidth: Math.round(bmp.width * scale),
      resizeHeight: Math.round(bmp.height * scale),
      resizeQuality: "high",
    });
    bmp.close();
    bmp = small;
  }
  return { status: "ready", image: bmp, width: bmp.width, height: bmp.height, version: ++decodeCounter };
}

/** Starts loading an asset image unless it is cached or on its way. */
export function requestImage(id: string): void {
  if (images.has(id)) return;
  setImage(id, { status: "loading" });
  decode(id).then(
    (entry) => setImage(id, entry),
    (e: unknown) => setImage(id, { status: "error", message: e instanceof Error ? e.message : String(e) }),
  );
}

/** Forgets every decoded image, e.g. after the manifest or the files changed. */
export function clearImages(): void {
  for (const entry of images.values()) if (entry.status === "ready") (entry.image as ImageBitmap).close?.();
  images.clear();
  storeVersion++;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The image cache and a version number that changes whenever an image arrives. */
export function useAssetImages(): { images: ReadonlyMap<string, AssetImage>; version: number } {
  const version = useSyncExternalStore(subscribe, () => storeVersion);
  return { images, version };
}

/** Fired on window when the manifest changed in another part of the page (e.g. a kept image edit). */
export const MANIFEST_CHANGED_EVENT = "tattoo-planner:manifest-changed";

export function announceManifestChanged(): void {
  window.dispatchEvent(new Event(MANIFEST_CHANGED_EVENT));
}

/**
 * The manifest listing. `reload` first catalogues new images in the data folder (as
 * `npm run assets:scan`), then re-reads the manifest and drops cached images; `scanNote` says what the
 * last scan did.
 */
export function useAssetListing(): {
  listing: AssetListing | null;
  reload: () => void;
  scanNote: string | null;
} {
  const [listing, setListing] = useState<AssetListing | null>(null);
  const [request, setRequest] = useState(0);
  const [scanNote, setScanNote] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(ASSETS_ENDPOINT)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AssetListing>;
      })
      .then(
        (l) => !cancelled && setListing(l),
        (e: unknown) =>
          !cancelled &&
          setListing({
            status: "error",
            message: `Cannot load the asset list (${String(e)}). The planner's local server did not answer; restart the planner.`,
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [request]);
  const reload = useCallback(() => {
    setScanNote("Looking for new images…");
    fetch(ASSETS_SCAN_ENDPOINT, { method: "POST" })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as ScanReport & { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setScanNote(scanSummary(body));
        if (body.added.length > 0) announceManifestChanged();
      })
      .catch((e: unknown) =>
        setScanNote(`Could not look for new images: ${e instanceof Error ? e.message : String(e)}`),
      )
      .finally(() => {
        clearImages();
        setRequest((n) => n + 1);
      });
  }, []);
  useEffect(() => {
    // New entries only: cached images stay valid, so just re-read the list.
    const onChange = () => setRequest((n) => n + 1);
    window.addEventListener(MANIFEST_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(MANIFEST_CHANGED_EVENT, onChange);
  }, []);
  return { listing, reload, scanNote };
}

/**
 * Where each image is used (GET /api/assets/usage), re-read when the manifest changes or a layout
 * is saved anywhere in the page. Null while loading or when it failed.
 */
export function useAssetUsage(): { usage: UsageMap | null; refresh: () => void } {
  const [usage, setUsage] = useState<UsageMap | null>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchUsage().then(
      (u) => !cancelled && setUsage(u),
      () => !cancelled && setUsage(null),
    );
    return () => {
      cancelled = true;
    };
  }, [request]);
  useEffect(() => {
    const onChange = () => setRequest((n) => n + 1);
    window.addEventListener(MANIFEST_CHANGED_EVENT, onChange);
    window.addEventListener(LAYOUT_SAVED_EVENT, onChange);
    return () => {
      window.removeEventListener(MANIFEST_CHANGED_EVENT, onChange);
      window.removeEventListener(LAYOUT_SAVED_EVENT, onChange);
    };
  }, []);
  const refresh = useCallback(() => setRequest((n) => n + 1), []);
  return { usage, refresh };
}
