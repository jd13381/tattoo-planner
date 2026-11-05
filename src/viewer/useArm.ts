import { useMemo, useState } from "react";
import measurementsText from "../../config/measurements.yaml?raw";
import { measuredValues, PLACEHOLDERS, resolveInputs, type ArmInputKey } from "../body/inputs.ts";
import { buildProfile, type ArmProfile } from "../body/profile.ts";
import { parseMeasurements } from "../config/loadMeasurements.ts";
import type { ExistingSize } from "../layout/shapes.ts";

export const loadedMeasurements = parseMeasurements(measurementsText);
export const INPUT_COUNT = Object.keys(PLACEHOLDERS).length;

export const fileValues: Record<ArmInputKey, number | null> = loadedMeasurements.ok
  ? measuredValues(loadedMeasurements.measurements)
  : (Object.fromEntries(Object.keys(PLACEHOLDERS).map((k) => [k, null])) as Record<ArmInputKey, null>);

/** Anubis size from measurements.yaml, used when the layout leaves it null. */
export const anubisSize: ExistingSize = loadedMeasurements.ok
  ? {
      height: loadedMeasurements.measurements.existing.anubis.height,
      width: loadedMeasurements.measurements.existing.anubis.width,
    }
  : { height: null, width: null };

export type Overrides = Partial<Record<ArmInputKey, number>>;

export type ArmState = {
  profile: ArmProfile;
  placeholders: ArmInputKey[];
  overrides: Overrides;
  setOverride: (key: ArmInputKey, value: number | undefined) => void;
  resetOverrides: () => void;
};

/** The arm shared by all tabs: file values plus unsaved panel edits. */
export function useArm(): ArmState {
  const [overrides, setOverrides] = useState<Overrides>({});
  const { profile, placeholders } = useMemo(() => {
    const { inputs, placeholders } = resolveInputs({ ...fileValues, ...overrides });
    return { profile: buildProfile(inputs), placeholders };
  }, [overrides]);
  return {
    profile,
    placeholders,
    overrides,
    setOverride: (key, value) =>
      setOverrides((o) => {
        const next = Object.entries(o).filter(([k]) => k !== key);
        if (value !== undefined) next.push([key, value]);
        return Object.fromEntries(next);
      }),
    resetOverrides: () => setOverrides({}),
  };
}

/** Elbow pose shared by the 3D views (src/body/bend.ts). */
export type Pose = { bendDeg: number; setBendDeg: (deg: number) => void };
