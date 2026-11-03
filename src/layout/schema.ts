// Schema for config/layouts/*.yaml (PROJECT_BRIEF.md §13.2, refined).
// Coordinates: u around the arm (0 outer, 0.25 lateral, 0.5 inner, 0.75 medial), v along it (0 wrist, 1 shoulder).
// Array order is layer order: later elements are drawn on top.
import { z } from "zod";

const unit = z.number().min(0).max(1);
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
};

export const figureSchema = z.strictObject({ type: z.literal("figure"), ...figureFields });
export const existingSchema = z.strictObject({ type: z.literal("existing"), ...figureFields });

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
    description: z.string().optional(),
    elements: z.array(elementSchema),
  })
  .superRefine((layout, ctx) => {
    const seen = new Set<string>();
    layout.elements.forEach((el, i) => {
      if (seen.has(el.id))
        ctx.addIssue({ code: "custom", path: ["elements", i, "id"], message: `duplicate id ${el.id}` });
      seen.add(el.id);
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
