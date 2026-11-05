import { useMemo, useState } from "react";
import measurementsText from "../../config/measurements.yaml?raw";
import { resolveBody, type ResolvedBody } from "../body/body.ts";
import { measuredValues, PLACEHOLDERS, type ArmInputKey } from "../body/inputs.ts";
import type { ArmProfile, RegionProfile } from "../body/profile.ts";
import type { RegionId } from "../body/regions.ts";
import { parseMeasurements } from "../config/loadMeasurements.ts";
import type { ExistingSize } from "../layout/shapes.ts";

export const loadedMeasurements = parseMeasurements(measurementsText);
export const INPUT_COUNT = Object.keys(PLACEHOLDERS).length;
const measurements = loadedMeasurements.ok ? loadedMeasurements.measurements : null;

/** The left arm's values in measurements.yaml (the measurements panel edits these). */
export const fileValues: Record<ArmInputKey, number | null> = measuredValues(measurements ?? {});

/** Anubis size from measurements.yaml, used when the layout leaves it null. */
export const anubisSize: ExistingSize = measurements?.existing
  ? { height: measurements.existing.anubis.height, width: measurements.existing.anubis.width }
  : { height: null, width: null };

export type Overrides = Partial<Record<ArmInputKey, number>>;

export type ArmState = {
  /** The left arm (the measurements panel and the projection work on it). */
  profile: ArmProfile;
  /** Left-arm keys that still show the sample body. */
  placeholders: ArmInputKey[];
  overrides: Overrides;
  setOverride: (key: ArmInputKey, value: number | undefined) => void;
  resetOverrides: () => void;
  /** The whole body: every region's profile and the placement for the full-body view. */
  body: ResolvedBody;
  /** A region's profile. */
  region: (id: RegionId) => RegionProfile;
};

/** The body shared by all tabs: file values plus unsaved panel edits (left arm). */
export function useArm(): ArmState {
  const [overrides, setOverrides] = useState<Overrides>({});
  const body = useMemo(() => resolveBody(measurements, { "arm-left": overrides }), [overrides]);
  const left = body.regions["arm-left"];
  return {
    profile: left.profile as ArmProfile,
    placeholders: left.fromSample as ArmInputKey[],
    overrides,
    setOverride: (key, value) =>
      setOverrides((o) => {
        const next = Object.entries(o).filter(([k]) => k !== key);
        if (value !== undefined) next.push([key, value]);
        return Object.fromEntries(next);
      }),
    resetOverrides: () => setOverrides({}),
    body,
    region: (id) => body.regions[id].profile,
  };
}

/** Elbow pose shared by the 3D views (src/body/bend.ts). */
export type Pose = { bendDeg: number; setBendDeg: (deg: number) => void };
