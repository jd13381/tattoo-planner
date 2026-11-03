// Schema for config/measurements.yaml (PROJECT_BRIEF.md §13.1).
// Every number may be null until Jan measures; Phase 2 fills gaps with flagged placeholders.
import { z } from "zod";

const cm = z.number().positive().nullable();

export const measurementsSchema = z.strictObject({
  arm: z.literal("left"),
  units: z.literal("cm"),
  lengths: z.strictObject({
    shoulder_to_elbow: cm,
    elbow_to_wrist: cm,
  }),
  circumferences: z.strictObject({
    wrist: cm,
    forearm_mid: cm,
    forearm_max: cm,
    elbow: cm,
    above_elbow: cm,
    biceps_mid: cm,
    armpit_level: cm,
    shoulder: cm,
  }),
  existing: z.strictObject({
    anubis: z.strictObject({
      distance_from_wrist: z.number().nonnegative().nullable(),
      height: cm,
      width: cm,
      side: z.enum(["inner", "outer"]),
    }),
  }),
  notes: z.string(),
});

export type Measurements = z.infer<typeof measurementsSchema>;
