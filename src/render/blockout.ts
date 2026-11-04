// Blockout mode (PROJECT_BRIEF.md §10.1 F5): every element as a flat shape coloured by type.
import { OUTSIDE, type Classification } from "../layout/shapes.ts";
import type { ElementType } from "../layout/schema.ts";

type RGB = [number, number, number];

export const BLOCKOUT_COLORS: Record<ElementType | "open" | "outside", RGB> = {
  figure: [74, 70, 67], // dark grey
  existing: [120, 112, 105], // outline drawn darker, see below
  filler: [196, 190, 184], // light grey
  band: [140, 134, 128], // mid grey, hatched
  line: [198, 40, 40], // red
  open: [239, 230, 220], // skin
  outside: [138, 133, 128],
};

const EXISTING_OUTLINE: RGB = [30, 26, 24];
const EXISTING_FILL: RGB = [222, 211, 199];
/** The selected element's outline: the UI's selection accent (--accent, #8f84ff). */
export const SELECTION_OUTLINE: RGB = [143, 132, 255];

/** Paints the classification into RGBA pixels (row 0 = shoulder, as the texture expects). */
export function blockoutPixels(cls: Classification, selected?: number): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, cells, resolved, pxPerCm } = cls;
  const out = new Uint8ClampedArray(width * height * 4);
  const outlinePx = Math.max(1, Math.round(pxPerCm * 0.25));
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const idx = j * width + i;
      const v = cells[idx]!;
      let color: RGB;
      if (v === OUTSIDE) color = BLOCKOUT_COLORS.outside;
      else if (v === 0) color = BLOCKOUT_COLORS.open;
      else {
        const type = resolved[v - 1]!.element.type;
        color = BLOCKOUT_COLORS[type];
        if (type === "band" && ((i + j) / pxPerCm) % 1 < 0.35) color = BLOCKOUT_COLORS.figure;
        if (type === "existing")
          color = isEdge(cells, width, height, i, j, v, outlinePx) ? EXISTING_OUTLINE : EXISTING_FILL;
        if (selected !== undefined && v === selected + 1 && isEdge(cells, width, height, i, j, v, outlinePx))
          color = SELECTION_OUTLINE;
      }
      out[idx * 4] = color[0];
      out[idx * 4 + 1] = color[1];
      out[idx * 4 + 2] = color[2];
      out[idx * 4 + 3] = 255;
    }
  }
  return out;
}

export function isEdge(
  cells: Uint8Array,
  w: number,
  h: number,
  i: number,
  j: number,
  v: number,
  r: number,
): boolean {
  for (const [di, dj] of [
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ] as const) {
    const ii = i + di;
    const jj = j + dj;
    // Beyond the skin's row (the unwrap's curved edge) is the inner seam, not the element's edge: the
    // element goes on across the seam, so no outline there (it showed as a line down Anubis in 3D).
    if (ii < 0 || ii >= w) continue;
    if (jj < 0 || jj >= h) return true;
    const n = cells[jj * w + ii]!;
    if (n !== v && n !== OUTSIDE) return true;
  }
  return false;
}
