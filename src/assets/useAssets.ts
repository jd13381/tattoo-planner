// Browser side of the asset manifest: the listing from the dev server and a cache of decoded images.
// Images are fetched and decoded once per page load and kept as ImageBitmaps, so switching render
// modes never decodes again. Nothing is uploaded anywhere: the only source is the local dev server.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { AssetImage } from "../render/reference.ts";
import { assetImageUrl, ASSETS_ENDPOINT, type AssetListing } from "./types.ts";

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

/** The manifest listing; `reload` re-reads the manifest and drops cached images. */
export function useAssetListing(): { listing: AssetListing | null; reload: () => void } {
  const [listing, setListing] = useState<AssetListing | null>(null);
  const [request, setRequest] = useState(0);
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
            message: `Cannot load the asset list (${String(e)}). It loads only under npm run dev.`,
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [request]);
  const reload = useCallback(() => {
    clearImages();
    setRequest((n) => n + 1);
  }, []);
  return { listing, reload };
}
