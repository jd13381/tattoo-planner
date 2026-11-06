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

/**
 * Filler elements of layouts written before background layers (docs/adr/0019). They are no longer
 * part of `elements`: parseLayout (src/layout/migrate.ts) turns each into an "area" background layer
 * on load, and the file is written in the new form only when it is saved.
 */
export const legacyFillerSchema = z.strictObject({
  type: z.literal("filler"),
  ...base,
  pattern: z.string(),
  region: z.strictObject({ u: z.tuple([z.number(), z.number()]), v: z.tuple([unit, unit]) }),
  density: unit.optional(),
});
export type LegacyFiller = z.infer<typeof legacyFillerSchema>;

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
  bandSchema,
  lineSchema,
]);

// ---------------------------------------------------------------------------------------------
// Background layers (docs/adr/0019): an ordered list below every element, bottom layer first.
// Motifs (figures, existing tattoos, bands) cover them; lines lie on top of everything as before.

/** How a layer is put onto the skin under it; "multiply" lets ink darken the skin (the default). */
export const BLEND_MODES = ["multiply", "normal"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

const offset = z.strictObject({ x: z.number(), y: z.number() });
const sourceCommon = {
  /** Turn of the pattern or tile on the skin in degrees, counter-clockwise as seen. */
  rotation_deg: z.number().optional(),
  /** Shift of the pattern or tile on the skin in cm (x around the region, y along it). */
  offset_cm: offset.optional(),
};

/** A procedural pattern by name (src/render/backgrounds/catalogue.ts lists them). */
export const patternSourceSchema = z.strictObject({
  pattern: z.string().min(1),
  /** Size relative to the pattern's natural size; default 1. */
  scale: z.number().positive().optional(),
  /** 0..1, how much ink; default 0.5 (0.3 for the line patterns of former fillers). */
  density: unit.optional(),
  /** Ink colour (CSS hex); default the black-grey ink. */
  ink: z.string().optional(),
  ...sourceCommon,
});

/** A standard background: its catalogue image when present (assets/backgrounds/), else procedural. */
export const standardSourceSchema = z.strictObject({
  standard: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  /** Width of one tile on the skin in cm; default from the catalogue. */
  tile_cm: cm.optional(),
  /** Procedural version only. */
  density: unit.optional(),
  ink: z.string().optional(),
  ...sourceCommon,
});

/** A tileable image from the project's assets (asset kind `background`). */
export const imageSourceSchema = z.strictObject({
  image: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
  /** Width of one tile on the skin in cm (the height follows the image). */
  tile_cm: cm,
  ...sourceCommon,
});

export const backgroundSourceSchema = z.union([patternSourceSchema, standardSourceSchema, imageSourceSchema]);

/** Shapes of an "area" layer: u, v as for elements, sizes in cm on the skin. */
export const areaShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("rect"),
    u: z.number(),
    v: unit,
    w_cm: cm,
    h_cm: cm,
    rotation_deg: z.number().optional(),
  }),
  z.strictObject({
    kind: z.literal("ellipse"),
    u: z.number(),
    v: unit,
    w_cm: cm,
    h_cm: cm,
    rotation_deg: z.number().optional(),
  }),
  z.strictObject({ kind: z.literal("polygon"), points: z.array(point).min(3) }),
  /** A u range (wrapping; [0, 1] = all the way round) between two v: the shape of a former filler. */
  z.strictObject({
    kind: z.literal("span"),
    u: z.tuple([z.number(), z.number()]),
    v: z.tuple([unit, unit]),
  }),
]);

/** One stroke of the painted mask: a round brush along the points; `erase` removes instead of paints. */
export const maskStrokeSchema = z.strictObject({
  erase: z.boolean().optional(),
  radius_cm: cm,
  points: z.array(point).min(1),
});

export const COVER_MODES = ["region", "area"] as const;
export type CoverMode = (typeof COVER_MODES)[number];

export const backgroundLayerSchema = z.strictObject({
  id: base.id,
  /** Name in the Layers panel; default the id. */
  name: z.string().optional(),
  hidden: z.boolean().optional(),
  locked: base.locked,
  notes: base.notes,
  source: backgroundSourceSchema,
  /** 0..1; default 1. */
  opacity: unit.optional(),
  /** Default multiply. */
  blend: z.enum(BLEND_MODES).optional(),
  /** "region" (default): the whole body region; "area": only the shapes and the painted mask. */
  cover: z.enum(COVER_MODES).optional(),
  shapes: z.array(areaShapeSchema).optional(),
  /** Brush strokes, applied in order after the shapes. */
  mask: z.array(maskStrokeSchema).optional(),
  /** Soft edge of the area in cm; default 0 (hard). */
  feather_cm: z.number().min(0).optional(),
  /** Skin left free around every motif on top, in cm; default 0 (the background touches the motifs). */
  gap_cm: z.number().min(0).optional(),
});

export type BackgroundSource = z.infer<typeof backgroundSourceSchema>;
export type PatternSource = z.infer<typeof patternSourceSchema>;
export type StandardSource = z.infer<typeof standardSourceSchema>;
export type ImageSource = z.infer<typeof imageSourceSchema>;
export type AreaShape = z.infer<typeof areaShapeSchema>;
export type MaskStroke = z.infer<typeof maskStrokeSchema>;
export type BackgroundLayer = z.infer<typeof backgroundLayerSchema>;

export const layoutSchema = z
  .strictObject({
    name: z.string().min(1),
    /** The body region the layout is drawn on; missing = arm-left (every layout before regions). */
    region: z.enum(REGION_IDS).optional(),
    description: z.string().optional(),
    /** Background layers below every element, bottom layer first (docs/adr/0019). */
    backgrounds: z.array(backgroundLayerSchema).optional(),
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
    });
    // Background ids share one namespace with the elements, so an id always names one thing.
    layout.backgrounds?.forEach((bg, i) => {
      if (seen.has(bg.id))
        ctx.addIssue({ code: "custom", path: ["backgrounds", i, "id"], message: `duplicate id ${bg.id}` });
      seen.add(bg.id);
      bg.shapes?.forEach((s, k) => {
        if (s.kind === "span" && s.v[0] >= s.v[1])
          ctx.addIssue({
            code: "custom",
            path: ["backgrounds", i, "shapes", k, "v"],
            message: "v range must go upwards",
          });
      });
    });
  });

export type Layout = z.infer<typeof layoutSchema>;
export type LayoutElement = z.infer<typeof elementSchema>;
export type ElementType = LayoutElement["type"];
export type FigureLike = Extract<LayoutElement, { type: "figure" | "existing" }>;

export const ELEMENT_TYPES: ElementType[] = ["figure", "existing", "band", "line"];
