// Schema for config/projections/*.yaml (docs/adr/0006-anubis-projection.md, docs/adr/0014-guided-projection.md):
// how several photos of an existing tattoo are projected onto a body region's skin coordinates and
// blended into one patch. Numbers only: the photos stay in the data folder and are named by their path
// there. Photo points are normalised (0..1 from the left/top edge) in the photo as shown upright: after
// the camera's EXIF orientation and after `turn`, so the region's start (wrist, ankle, waist) points down.
// The keys keep the arm's names (`wrist`, `elbow`, "wrist crease") for every region: on another region
// "wrist" means the region's start and "elbow" its twist reference (src/projection/model.ts twistReach).
import { z } from "zod";
import { DEFAULT_REGION, REGION_IDS, type RegionId } from "../body/regions.ts";
import { IMAGE_ROTATIONS } from "../layout/schema.ts";

const unit = z.number().min(0).max(1);
export const pointSchema = z.strictObject({ x: z.number(), y: z.number() });
export type PhotoPoint = z.infer<typeof pointSchema>;

/** A photo point at a known distance from the wrist crease along the arm. */
const markSchema = z.strictObject({ x: z.number(), y: z.number(), cm: z.number() });
export type AlongMark = z.infer<typeof markSchema>;

/** A straight line through two photo points (a silhouette edge of the forearm). */
const lineSchema = z.tuple([pointSchema, pointSchema]);

export const photoSchema = z.strictObject({
  /** Path of the photo in the data folder; it must have an entry in manifest.yaml. */
  file: z.string().min(1),
  /** Clockwise quarter turn of the upright photo so that the wrist points down. */
  turn: z.union(IMAGE_ROTATIONS.map((d) => z.literal(d))).default(0),
  /** The forearm's silhouette edges in the turned photo. */
  edges: z.strictObject({ left: lineSchema, right: lineSchema }),
  /**
   * Two points at known distances from the wrist crease along the arm (cm), e.g. the wrist crease
   * (0) and the top of the tattoo; they set the scale along the arm. Only their position along the
   * arm counts, not where they lie across it.
   */
  along: z.tuple([markSchema, markSchema]),
  /** Which u faces the camera, at the wrist crease and at the elbow tip (the forearm twists). */
  u_view: z.strictObject({ wrist: z.number(), elbow: z.number() }),
  /** Extra weight in the blend (1 = normal, 0 = ignore this photo). */
  weight: z.number().min(0).default(1),
  /**
   * An edited version of the photo in the data folder (Image studio: the ink alone, skin and body
   * removed; docs/adr/0023): its pixels are projected instead of `file`'s. The points above stay in
   * `file`'s frame; the edit is stretched onto it, so it should keep the photo's shape. Transparent
   * parts of the edit count as bare skin.
   */
  cleaned: z.string().min(1).optional(),
});
export type PhotoCalibration = z.infer<typeof photoSchema>;

export const projectionSchema = z
  .strictObject({
    name: z.string().min(1),
    description: z.string().optional(),
    /** The body region the tattoo is on; default arm-left (files written before regions existed). */
    region: z.enum(REGION_IDS).optional(),
    /** The area of skin the combined picture covers. */
    patch: z.strictObject({
      u: z.tuple([z.number(), z.number()]),
      v: z.tuple([unit, unit]),
      px_per_cm: z.number().min(2).max(60).default(20),
      /** Soft edge where the patch ends, in cm. */
      feather_cm: z.number().min(0).default(0.5),
    }),
    blend: z
      .strictObject({
        /** Weight of a photo = cos(viewing angle)^exponent: higher prefers the most frontal photo. */
        exponent: z.number().min(0).max(32).default(4),
        /** Window for the local skin brightness (exposure and shading normalisation), cm. */
        white_radius_cm: z.number().positive().default(1.5),
        /** Brightness (0..1 of the skin) from which a pixel counts as bare skin: hides hair and pores. */
        skin_level: z.number().gt(0).max(1).default(0.9),
        /** Ink below this darkness (0..1) counts as skin for the footprint (blockout, metrics). */
        ink_threshold: unit.default(0.03),
      })
      .prefault({}),
    /**
     * Ink only (docs/adr/0023): flattens the skin's shading and keeps only the ink, which is then
     * multiplied onto the planner's skin. Left out: the photos' brightness as it is (ADR 0006).
     */
    cleanup: z
      .strictObject({
        /** Window over which the skin's own brightness is estimated, cm; larger than the ink's lines. */
        flatten_cm: z.number().min(0.5).max(30).default(4),
        /** 0 = keep faint ink and grey tones … 1 = only clear ink, as solid line art. */
        strength: unit.default(0.5),
        /** Keep the ink's colour; otherwise black and grey. */
        keep_color: z.boolean().default(false),
      })
      .optional(),
    photos: z.array(photoSchema).min(1),
  })
  .superRefine((p, ctx) => {
    if (p.patch.u[0] >= p.patch.u[1])
      ctx.addIssue({ code: "custom", path: ["patch", "u"], message: "u range must go upwards" });
    if (p.patch.u[1] - p.patch.u[0] > 1)
      ctx.addIssue({ code: "custom", path: ["patch", "u"], message: "u range is at most once around" });
    if (p.patch.v[0] >= p.patch.v[1])
      ctx.addIssue({ code: "custom", path: ["patch", "v"], message: "v range must go upwards" });
    p.photos.forEach((ph, i) => {
      if (Math.abs(ph.along[1].cm - ph.along[0].cm) < 1)
        ctx.addIssue({
          code: "custom",
          path: ["photos", i, "along"],
          message: "the two points along the arm must be at least 1 cm apart",
        });
    });
  });

export type ProjectionCalibration = z.infer<typeof projectionSchema>;
export type CleanupSettings = NonNullable<ProjectionCalibration["cleanup"]>;

/** Ink-only settings for a new projection (the wizard switches it on by default). */
export const DEFAULT_CLEANUP: CleanupSettings = { flatten_cm: 4, strength: 0.5, keep_color: false };

/** The region a calibration belongs to. */
export function projectionRegion(cal: { region?: RegionId }): RegionId {
  return cal.region ?? DEFAULT_REGION;
}
