// Schema for config/measurements.yaml (PROJECT_BRIEF.md §13.1, per region since docs/adr/0011).
// Every number may be null until someone measures; missing values come from the sample body.
//
// The top-level `arm: left` with `lengths`, `circumferences` and `positions` is the original format and
// stays the way to give the left arm (`arm-left`). Every region, the left arm included, can also be given
// under `regions:`, with any subset of its keys; the left arm may not be given both ways.
import { z } from "zod";
import { INPUT_SECTIONS, type InputSection } from "../body/inputs.ts";
import type { RegionKind } from "../body/profile.ts";
import { REGIONS, type RegionId } from "../body/regions.ts";
import { BODY_IDS } from "../body/samples.ts";

const cm = z.number().positive().nullable();

/** A region block under `regions:`: any section, any subset of its keys. */
function regionBlock(kind: RegionKind) {
  return z
    .strictObject(
      Object.fromEntries(
        INPUT_SECTIONS[kind].map((s) => [
          s.section,
          z.strictObject(Object.fromEntries(s.keys.map((k) => [k, cm.optional()]))).optional(),
        ]),
      ),
    )
    .nullable();
}

const regionsSchema = z.strictObject(
  Object.fromEntries(Object.values(REGIONS).map((r) => [r.id, regionBlock(r.kind).optional()])) as Record<
    RegionId,
    z.ZodOptional<ReturnType<typeof regionBlock>>
  >,
);

// The left arm's top-level blocks list every key (tests/bodies.test.ts checks them against INPUT_SECTIONS).
const armLengths = z.strictObject({ shoulder_to_elbow: cm, elbow_to_wrist: cm });
const armCircumferences = z.strictObject({
  wrist: cm,
  forearm_mid: cm,
  forearm_max: cm,
  elbow: cm,
  above_elbow: cm,
  biceps_mid: cm,
  armpit_level: cm,
  shoulder: cm,
});
const armPositions = z.strictObject({
  forearm_max_below_elbow: cm,
  armpit_level_below_shoulder: cm,
  shoulder_below_shoulder: cm,
});

export const measurementsSchema = z
  .strictObject({
    /** Sample body for every value nobody measured; default male (src/body/samples.ts). */
    body: z.enum(BODY_IDS).optional(),
    /** Own body height: scales every sample value nobody measured. */
    height_cm: cm.optional(),
    arm: z.literal("left").optional(),
    units: z.literal("cm"),
    lengths: armLengths.optional(),
    circumferences: armCircumferences.optional(),
    positions: armPositions.optional(),
    regions: regionsSchema.optional(),
    existing: z
      .strictObject({
        anubis: z.strictObject({
          distance_from_wrist: z.number().nonnegative().nullable(),
          height: cm,
          width: cm,
          side: z.enum(["inner", "outer"]),
        }),
      })
      .optional(),
    notes: z.string().optional(),
  })
  .superRefine((m, ctx) => {
    if ((m.lengths || m.circumferences || m.positions) && m.regions?.["arm-left"])
      ctx.addIssue({
        code: "custom",
        path: ["regions", "arm-left"],
        message: "the left arm is already given at the top level (arm: left); give it in one place only",
      });
  });

export type Measurements = z.infer<typeof measurementsSchema>;
/** A region block as parsed: sections of optional, nullable numbers. */
export type RegionMeasurements = Partial<Record<InputSection, Partial<Record<string, number | null>>>> | null;
