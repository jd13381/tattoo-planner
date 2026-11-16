// Debug texture for checking UV distortion: a cm grid on the unwrap (docs/history/project-brief.md §14, Phase 2).
// Pure line model + a thin canvas painter, so the model can be tested without a browser.
import type { RegionProfile } from "../body/profile.ts";
import { MAIN_LINES } from "../body/regions.ts";
import { screenSign } from "../body/uv.ts";
import { wrapDelta } from "../layout/shapes.ts";

/**
 * A polyline in unwrap cm: x from the centre line of the image (positive towards growing u, lateral on
 * the left arm's outer-centred texture), y from the region's start.
 */
export type GridLine = {
  points: { x: number; y: number }[];
  weight: "minor" | "major" | "axis";
  label?: string;
};

const ROW_STEP_CM = 0.5;

export function gridLines(profile: RegionProfile, stepCm = 1, majorEvery = 5, centerU = 0): GridLine[] {
  const lines: GridLine[] = [];
  const L = profile.length;
  const half = (y: number) => profile.circumferenceAt(y) / 2;

  // Rings: horizontal lines every stepCm along the arm.
  for (let k = 0; k * stepCm <= L + 1e-9; k++) {
    const y = k * stepCm;
    lines.push({
      points: [
        { x: -half(y), y },
        { x: half(y), y },
      ],
      weight: k % majorEvery === 0 ? "major" : "minor",
      label: k % (majorEvery * 2) === 0 ? `${Math.round(y)} cm` : undefined,
    });
  }

  // Lengthwise lines every stepCm, measured along the ring from the nearer of the region's two main
  // centre lines (MAIN_LINES: outer/inner on limbs, front/back on the torso), each family clipped to its
  // half of the ring. A line then keeps its distance in cm from that centre line all the way along,
  // so it runs parallel to it on the 3D body. Measuring every line from the texture centre instead let
  // lines a quarter ring away drift by a quarter of every change in circumference (the S-shaped lines
  // on the torso's front and back). The two families meet on the other two centre lines, which are
  // drawn as axes anyway.
  for (const anchor of MAIN_LINES[profile.kind]) {
    const d = wrapDelta(anchor - centerU);
    const maxK = Math.floor(profile.maxCircumference / 4 / stepCm);
    for (let k = -maxK; k <= maxK; k++) {
      if (k === 0) continue;
      const offset = k * stepCm;
      let current: { x: number; y: number }[] = [];
      const flush = () => {
        if (current.length > 1)
          lines.push({ points: current, weight: k % majorEvery === 0 ? "major" : "minor" });
        current = [];
      };
      for (let y = 0; y <= L + 1e-9; y += ROW_STEP_CM) {
        const c = profile.circumferenceAt(y);
        if (Math.abs(offset) > c / 4) {
          flush();
          continue;
        }
        // Wrap into the row; a line that crosses the seam continues on the other edge.
        let x = d * c + offset;
        x -= c * Math.round(x / c);
        const prev = current[current.length - 1];
        if (prev && Math.abs(x - prev.x) > c / 2) flush();
        current.push({ x, y });
      }
      flush();
    }
  }

  // The four centre lines (u = 0, 0.25, 0.5, 0.75: outer, lateral, inner, medial on arms) as offsets
  // from the image's centre line; the one opposite the centre is the cut and forms both edges.
  const axes: { u: number; label: string }[] = [];
  (
    [
      [0, "outer"],
      [0.25, "lateral"],
      [0.75, "medial"],
      [0.5, "inner"],
    ] as const
  ).forEach(([u, label]) => {
    const d = wrapDelta(u - centerU);
    if (Math.abs(Math.abs(d) - 0.5) < 1e-9) axes.push({ u: 0.5, label }, { u: -0.5, label });
    else axes.push({ u: d, label });
  });
  for (const axis of axes) {
    const points: { x: number; y: number }[] = [];
    for (let y = 0; y <= L + 1e-9; y += ROW_STEP_CM) points.push({ x: axis.u * 2 * half(y), y });
    lines.push({ points, weight: "axis", label: axis.label });
  }
  return lines;
}

export type GridStyle = {
  background: string;
  skin: string;
  minor: string;
  major: string;
  axis: string;
  text: string;
};

/** Faint grid drawn over the blockout. */
export const OVERLAY_GRID_STYLE: GridStyle = {
  background: "transparent",
  skin: "transparent",
  minor: "rgba(40, 30, 25, 0.10)",
  major: "rgba(40, 30, 25, 0.35)",
  axis: "rgba(179, 38, 30, 0.55)",
  text: "rgba(40, 30, 25, 0.7)",
};

export const DEFAULT_GRID_STYLE: GridStyle = {
  background: "#8a8580",
  skin: "#efe6dc",
  minor: "rgba(60, 50, 45, 0.28)",
  major: "rgba(40, 30, 25, 0.75)",
  axis: "#b3261e",
  text: "#3a302a",
};

/** Paints the grid onto a canvas sized pxPerCm × the unwrap; the canvas top is the shoulder. */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  profile: RegionProfile,
  pxPerCm: number,
  style: GridStyle = DEFAULT_GRID_STYLE,
  opts: { background?: boolean; centerU?: number } = {},
): void {
  const W = profile.maxCircumference * pxPerCm;
  const H = profile.length * pxPerCm;
  // On the left arm lateral (positive x) is drawn on the left: the unwrap is seen from outside the arm
  // (src/body/uv.ts); mirrored regions turn the other way.
  const sign = screenSign(profile);
  const toPx = (p: { x: number; y: number }) => [W / 2 + sign * p.x * pxPerCm, H - p.y * pxPerCm] as const;

  if (opts.background !== false) {
    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, W, H);

    // Skin region: the vase outline.
    ctx.beginPath();
    for (let y = 0; y <= profile.length; y += ROW_STEP_CM)
      ctx.lineTo(...toPx({ x: -profile.circumferenceAt(y) / 2, y }));
    for (let y = profile.length; y >= 0; y -= ROW_STEP_CM)
      ctx.lineTo(...toPx({ x: profile.circumferenceAt(y) / 2, y }));
    ctx.closePath();
    ctx.fillStyle = style.skin;
    ctx.fill();
  }

  ctx.lineCap = "round";
  ctx.font = `${Math.round(pxPerCm * 0.9)}px system-ui, sans-serif`;
  for (const line of gridLines(profile, 1, 5, opts.centerU ?? 0)) {
    ctx.beginPath();
    for (const p of line.points) ctx.lineTo(...toPx(p));
    ctx.strokeStyle = style[line.weight];
    ctx.lineWidth = line.weight === "minor" ? Math.max(1, pxPerCm / 16) : pxPerCm / 7;
    ctx.stroke();
    if (line.label && line.weight !== "axis") {
      // Ring labels sit next to the centre line, the middle of the unwrap.
      const [x, y] = toPx({ x: 0, y: line.points[0]!.y });
      ctx.fillStyle = style.text;
      ctx.fillText(line.label, x + pxPerCm * 0.4, y - pxPerCm * 0.25);
    }
  }
}
