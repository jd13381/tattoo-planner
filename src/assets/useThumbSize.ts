// Thumbnail size of the Assets grid (small, medium, large), remembered per browser. A viewer
// convenience only: storage may be blocked (private window), then the default applies.
import { useCallback, useState } from "react";

export type ThumbSize = "s" | "m" | "l";

export const THUMB_SIZES: readonly ThumbSize[] = ["s", "m", "l"];

/** Smallest tile width per size; the grid fills the row with tiles at least this wide. */
export const THUMB_MIN_PX: Record<ThumbSize, number> = { s: 112, m: 156, l: 216 };

export const THUMB_LABELS: Record<ThumbSize, string> = {
  s: "Small thumbnails",
  m: "Medium thumbnails",
  l: "Large thumbnails",
};

const KEY = "tattoo-planner:assets-thumb-size";

function isThumbSize(v: unknown): v is ThumbSize {
  return v === "s" || v === "m" || v === "l";
}

export function useThumbSize(): [ThumbSize, (s: ThumbSize) => void] {
  const [size, setSize] = useState<ThumbSize>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return isThumbSize(v) ? v : "m";
    } catch {
      return "m";
    }
  });
  const set = useCallback((s: ThumbSize) => {
    setSize(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {
      // per-viewer convenience only
    }
  }, []);
  return [size, set];
}
