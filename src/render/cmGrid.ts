// Debug texture for checking UV distortion: a cm grid on the unwrap (PROJECT_BRIEF.md §14, Phase 2).
// Pure line model + a thin canvas painter, so the model can be tested without a browser.
import type { ArmProfile } from "../body/profile.ts";

/** A polyline in unwrap cm: x from the outer centre line (lateral positive), y from the wrist. */
export type GridLine = {
  points: { x: number; y: number }[];
  weight: "minor" | "major" | "axis";
  label?: string;
};

const ROW_STEP_CM = 0.5;

export function gridLines(profile: ArmProfile, stepCm = 1, majorEvery = 5): GridLine[] {
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

  // Lengthwise lines every stepCm from the outer centre line, clipped to the local circumference.
  const maxK = Math.floor(profile.maxCircumference / 2 / stepCm);
  for (let k = -maxK; k <= maxK; k++) {
    if (k === 0) continue;
    const x = k * stepCm;
    let current: { x: number; y: number }[] = [];
    const flush = () => {
      if (current.length > 1)
        lines.push({ points: current, weight: k % majorEvery === 0 ? "major" : "minor" });
      current = [];
    };
    for (let y = 0; y <= L + 1e-9; y += ROW_STEP_CM) {
      if (Math.abs(x) <= half(y)) current.push({ x, y });
      else flush();
    }
    flush();
  }

  // Centre lines as fractions of the circumference: outer, lateral, medial, and the inner seam on both edges.
  const axes: { u: number; label: string }[] = [
    { u: 0, label: "outer" },
    { u: 0.25, label: "lateral" },
    { u: -0.25, label: "medial" },
    { u: 0.5, label: "inner" },
    { u: -0.5, label: "inner" },
  ];
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
  profile: ArmProfile,
  pxPerCm: number,
  style: GridStyle = DEFAULT_GRID_STYLE,
  opts: { background?: boolean } = {},
): void {
  const W = profile.maxCircumference * pxPerCm;
  const H = profile.length * pxPerCm;
  // Lateral (positive x) is drawn on the left: the unwrap is seen from outside the arm (src/body/uv.ts).
  const toPx = (p: { x: number; y: number }) => [W / 2 - p.x * pxPerCm, H - p.y * pxPerCm] as const;

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
  for (const line of gridLines(profile)) {
    ctx.beginPath();
    for (const p of line.points) ctx.lineTo(...toPx(p));
    ctx.strokeStyle = style[line.weight];
    ctx.lineWidth = line.weight === "minor" ? Math.max(1, pxPerCm / 16) : pxPerCm / 7;
    ctx.stroke();
    if (line.label && line.weight !== "axis") {
      // Ring labels sit next to the outer centre line, the middle of the unwrap.
      const [x, y] = toPx({ x: 0, y: line.points[0]!.y });
      ctx.fillStyle = style.text;
      ctx.fillText(line.label, x + pxPerCm * 0.4, y - pxPerCm * 0.25);
    }
  }
}
