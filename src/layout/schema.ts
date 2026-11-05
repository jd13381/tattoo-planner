// Schema for config/layouts/*.yaml (PROJECT_BRIEF.md §13.2, refined).
// Coordinates: u around the region, v along it. On the arm (the default region) u is 0 outer, 0.25 lateral,
// 0.5 inner, 0.75 medial and v 0 wrist, 1 shoulder; other regions: src/body/regions.ts, docs/adr/0011.
// Array order is layer order: later elements are drawn on top.
import { z } from "zod";
import { rectSchema } from "../assets/manifest.ts";
import { REGION_IDS } from "../body/regions.ts";

const unit = z.number().min(0).max(1);

/** Image looks in reference mode: hatching = grayscale with a line screen (engraving style, §4.2). */
export const IMAGE_FILTERS = ["none", "grayscale", "hatching"] as const;
export type ImageFilter = (typeof IMAGE_FILTERS)[number];
export const IMAGE_ROTATIONS = [0, 90, 180, 270] as const;
const point = z.strictObject({ u: z.number(), v: unit });
const cm = z.number().positive();

const base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  locked: z.boolean().optional(),
  notes: z.string().optional(),
};

/** Size of a figure; null = not decided yet (the planner shows a flagged placeholder). */
const size = z.strictObject({ h: cm.nullable(), w: cm.nullable().optional() });

const figureFields = {
  ...base,
  asset: z.string().optional(),
  position: point,
  size_cm: size,
  rotation_deg: z.number().optional(),
  style: z.string().optional(),
  red_accents: z.boolean().optional(),
  // Reference mode (PROJECT_BRIEF.md §10.1 F6), all optional; how they combine: src/layout/imageFit.ts.
  /** Cut-out of the asset image, normalised to the image as stored (before image_rotation_deg). */
  crop: rectSchema.optional(),
  /** Quarter turn of the cut-out, clockwise, so a sideways photo stands upright (wrist down). */
  image_rotation_deg: z.union(IMAGE_ROTATIONS.map((d) => z.literal(d))).optional(),
  /** Mirror the image left-right (after the quarter turn). */
  flip: z.boolean().optional(),
  /** Soft edge of the cut-out in cm; default 1 cm, 0 = hard edge. */
  feather_cm: z.number().min(0).optional(),
  /** Image look; default grayscale on the forearm, none elsewhere. */
  filter: z.enum(IMAGE_FILTERS).optional(),
};

export const figureSchema = z.strictObject({ type: z.literal("figure"), ...figureFields });
export const existingSchema = z.strictObject({
  type: z.literal("existing"),
  ...figureFields,
  /**
   * Name of a calibration in config/projections/ (docs/adr/0006): the tattoo is drawn from all its
   * photos, already in skin coordinates, where they place it. Position, size and cut-out then only
   * apply while that picture cannot be built (no data folder, photos missing).
   */
  projection: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes")
    .optional(),
});

export const fillerSchema = z.strictObject({
  type: z.literal("filler"),
  ...base,
  pattern: z.string(),
  region: z.strictObject({ u: z.tuple([z.number(), z.number()]), v: z.tuple([unit, unit]) }),
  density: unit.optional(),
});

export const bandSchema = z.strictObject({
  type: z.literal("band"),
  ...base,
  pattern: z.string(),
  v: unit,
  width_cm: cm,
});

export const lineSchema = z.strictObject({
  type: z.literal("line"),
  ...base,
  color: z.string().optional(),
  points: z.array(point).min(2),
  width_cm: cm,
});

export const elementSchema = z.discriminatedUnion("type", [
  figureSchema,
  existingSchema,
  fillerSchema,
  bandSchema,
  lineSchema,
]);

export const layoutSchema = z
  .strictObject({
    name: z.string().min(1),
    /** The body region the layout is drawn on; missing = arm-left (every layout before regions). */
    region: z.enum(REGION_IDS).optional(),
    description: z.string().optional(),
    elements: z.array(elementSchema),
  })
  .superRefine((layout, ctx) => {
    const seen = new Set<string>();
    layout.elements.forEach((el, i) => {
      if (seen.has(el.id))
        ctx.addIssue({ code: "custom", path: ["elements", i, "id"], message: `duplicate id ${el.id}` });
      seen.add(el.id);
      if (
        (el.type === "figure" || el.type === "existing") &&
        el.crop &&
        (el.crop.x + el.crop.w > 1 + 1e-9 || el.crop.y + el.crop.h > 1 + 1e-9)
      )
        ctx.addIssue({
          code: "custom",
          path: ["elements", i, "crop"],
          message: "crop must stay inside the image (x + w ≤ 1, y + h ≤ 1)",
        });
      if (el.type === "filler" && el.region.v[0] >= el.region.v[1])
        ctx.addIssue({
          code: "custom",
          path: ["elements", i, "region", "v"],
          message: "v range must go upwards",
        });
    });
  });

export type Layout = z.infer<typeof layoutSchema>;
export type LayoutElement = z.infer<typeof elementSchema>;
export type ElementType = LayoutElement["type"];
export type FigureLike = Extract<LayoutElement, { type: "figure" | "existing" }>;

export const ELEMENT_TYPES: ElementType[] = ["figure", "existing", "filler", "band", "line"];
