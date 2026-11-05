// The built-in engine of the Image studio (docs/adr/0013-builtin-image-operations.md): the list of
// operations the panel offers, their controls and defaults, how one is applied to an image and how a
// step is named in the version strip and in a saved image's notes. The pixel work lives in
// src/render/builtinOps.ts; the page runs it on the decoded image and uploads the PNG, which the dev
// server adds to the editing session as a new version.
import {
  flipHorizontal,
  grayscale,
  invert,
  levels,
  removeBackground,
  rotate,
  threshold,
  type Pixels,
} from "../render/builtinOps.ts";

/** How the built-in engine is named in a job's tools and a saved image's notes. */
export const BUILTIN_TOOL = "built-in";

export type BuiltinOpId =
  "remove-background" | "threshold" | "levels" | "grayscale" | "invert" | "rotate" | "flip";

export type ParamSpec =
  | {
      key: string;
      label: string;
      kind: "range";
      min: number;
      max: number;
      step: number;
      default: number;
      /** "px" values scale with the image when the op runs on a smaller preview. */
      unit?: "px";
    }
  | {
      key: string;
      label: string;
      kind: "choice";
      options: readonly { value: number; label: string }[];
      default: number;
    };

export type BuiltinOp = { id: BuiltinOpId; label: string; hint: string; params: readonly ParamSpec[] };

export type BuiltinParams = Record<string, number>;

/** In panel order: the most useful first. At most two controls each. */
export const BUILTIN_OPS: readonly BuiltinOp[] = [
  {
    id: "remove-background",
    label: "Remove background",
    hint: "Makes the plain background around the motif transparent (flood fill from the border).",
    params: [
      { key: "tolerance", label: "Tolerance", kind: "range", min: 0, max: 128, step: 1, default: 32 },
      {
        key: "feather",
        label: "Soft edge",
        kind: "range",
        min: 0,
        max: 20,
        step: 1,
        default: 2,
        unit: "px",
      },
    ],
  },
  {
    id: "threshold",
    label: "Line art",
    hint: "Black and white only: darker than the level becomes black ink.",
    params: [
      { key: "level", label: "Level", kind: "range", min: 1, max: 254, step: 1, default: 128 },
      { key: "smooth", label: "Smoothing", kind: "range", min: 0, max: 8, step: 1, default: 1, unit: "px" },
    ],
  },
  {
    id: "levels",
    label: "Levels / contrast",
    hint: "Stretches the tones: values below the black point turn black, above the white point white.",
    params: [
      { key: "black", label: "Black point", kind: "range", min: 0, max: 200, step: 1, default: 20 },
      { key: "white", label: "White point", kind: "range", min: 55, max: 255, step: 1, default: 235 },
    ],
  },
  { id: "grayscale", label: "Black and grey", hint: "Removes the colour.", params: [] },
  { id: "invert", label: "Invert", hint: "Negative: dark becomes light.", params: [] },
  {
    id: "rotate",
    label: "Rotate",
    hint: "Quarter turns; the image size swaps for 90°.",
    params: [
      {
        key: "turns",
        label: "Direction",
        kind: "choice",
        options: [
          { value: 3, label: "90° left" },
          { value: 1, label: "90° right" },
          { value: 2, label: "180°" },
        ],
        default: 1,
      },
    ],
  },
  { id: "flip", label: "Mirror", hint: "Flips the image left to right.", params: [] },
];

export function builtinOp(id: string): BuiltinOp | null {
  return BUILTIN_OPS.find((o) => o.id === id) ?? null;
}

export function defaultParams(id: BuiltinOpId): BuiltinParams {
  return Object.fromEntries((builtinOp(id)?.params ?? []).map((p) => [p.key, p.default]));
}

/** Parameter values clamped to their control, with defaults for missing ones. */
export function cleanParams(id: BuiltinOpId, params: Partial<BuiltinParams>): BuiltinParams {
  const out: BuiltinParams = {};
  for (const p of builtinOp(id)?.params ?? []) {
    const v = params[p.key];
    if (p.kind === "range")
      out[p.key] =
        typeof v === "number" && Number.isFinite(v) ? Math.max(p.min, Math.min(p.max, v)) : p.default;
    else out[p.key] = p.options.some((o) => o.value === v) ? v! : p.default;
  }
  return out;
}

/**
 * Runs an operation. `pxScale` scales the pixel-sized controls (soft edge, smoothing) for a preview
 * that runs on a smaller copy of the image, so it looks like the full-size result.
 */
export function applyBuiltin(
  img: Pixels,
  id: BuiltinOpId,
  params: Partial<BuiltinParams> = {},
  pxScale = 1,
): Pixels {
  const p = cleanParams(id, params);
  switch (id) {
    case "remove-background":
      return removeBackground(img, { tolerance: p.tolerance!, featherPx: p.feather! * pxScale });
    case "threshold":
      return threshold(img, { level: p.level!, smoothPx: p.smooth! * pxScale });
    case "levels":
      return levels(img, { black: p.black!, white: Math.max(p.white!, p.black! + 1) });
    case "grayscale":
      return grayscale(img);
    case "invert":
      return invert(img);
    case "rotate":
      return rotate(img, p.turns!);
    case "flip":
      return flipHorizontal(img);
  }
}

/** The step as it appears in the version strip and a saved image's notes, e.g. "Line art (level 128, smoothing 1 px)". */
export function describeStep(id: BuiltinOpId, params: Partial<BuiltinParams> = {}): string {
  const op = builtinOp(id);
  if (!op) return id;
  const p = cleanParams(id, params);
  if (id === "rotate") {
    const choice = op.params[0];
    const label = choice?.kind === "choice" ? choice.options.find((o) => o.value === p.turns)?.label : "";
    return `Rotate ${label ?? ""}`.trim();
  }
  const parts = op.params.map(
    (s) => `${s.label.toLowerCase()} ${p[s.key]}${s.kind === "range" && s.unit ? ` ${s.unit}` : ""}`,
  );
  return parts.length > 0 ? `${op.label} (${parts.join(", ")})` : op.label;
}

/** Largest side of the copy the panel previews on; the full image is processed only on Apply. */
export const PREVIEW_MAX_SIDE = 640;
