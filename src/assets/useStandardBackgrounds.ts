// The standard backgrounds of the build (docs/adr/0019): the catalogue assets/backgrounds/
// backgrounds.yaml and the images next to it, bundled by Vite. Without images (none generated yet)
// every standard background shows its procedural version. Images decode once, on first use.
import { useEffect, useState } from "react";
import catalogueText from "../../assets/backgrounds/backgrounds.yaml?raw";
import {
  parseCatalogue,
  standardBackgrounds,
  type StandardBackground,
} from "../render/backgrounds/catalogue.ts";
import type { BackgroundSources, ReadyImage } from "../render/backgrounds/paint.ts";

const files = import.meta.glob("../../assets/backgrounds/*.{png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const urlsByName = Object.fromEntries(Object.entries(files).map(([p, url]) => [p.split("/").pop()!, url]));
const parsed = parseCatalogue(catalogueText);

/** Every standard background, in catalogue order. */
export const STANDARD_BACKGROUNDS: StandardBackground[] = standardBackgrounds(
  parsed.ok ? parsed.catalogue : null,
  urlsByName,
);
/** Why the catalogue cannot be read, for the Layers panel (null when it reads fine). */
export const CATALOGUE_ERROR = parsed.ok ? null : parsed.error;

const byName = new Map(STANDARD_BACKGROUNDS.map((s) => [s.name, s]));
const decoded = new Map<string, ReadyImage | "loading" | "error">();
const listeners = new Set<() => void>();
let version = 0;

function load(name: string) {
  const info = byName.get(name);
  if (!info?.imageUrl || decoded.has(name)) return;
  decoded.set(name, "loading");
  const img = new Image();
  img.onload = () => {
    decoded.set(name, { image: img, width: img.naturalWidth, height: img.naturalHeight, version: 1 });
    version++;
    for (const l of listeners) l();
  };
  img.onerror = () => {
    decoded.set(name, "error");
    version++;
    for (const l of listeners) l();
  };
  img.src = info.imageUrl;
}

export type StandardSources = Pick<BackgroundSources, "standard" | "standardImage">;

/** Sources for the renderer; the object changes whenever another catalogue image has decoded. */
export function useStandardBackgrounds(): StandardSources {
  const [, setV] = useState(version);
  useEffect(() => {
    const on = () => setV(version);
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  const [sources, setSources] = useState<{ v: number; s: StandardSources } | null>(null);
  if (!sources || sources.v !== version) {
    const s: StandardSources = {
      standard: byName,
      standardImage: (name) => {
        load(name);
        const d = decoded.get(name);
        return d && typeof d === "object" ? d : null;
      },
    };
    setSources({ v: version, s });
    return s;
  }
  return sources.s;
}
