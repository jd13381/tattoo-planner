import { useMemo, useState } from "react";
import { type ResolvedBody } from "../body/body.ts";
import { resolveDraft } from "../body/fieldStatus.ts";
import { PLACEHOLDERS, type ArmInputKey } from "../body/inputs.ts";
import type { ArmProfile, RegionProfile } from "../body/profile.ts";
import type { RegionId } from "../body/regions.ts";
import type { BodyId } from "../body/samples.ts";
import { parseMeasurements, type LoadResult } from "../config/loadMeasurements.ts";
import type { Measurements } from "../config/measurements.ts";
import { draftSize, updateMeasurementsText, type MeasurementDraft } from "../config/measurementsDoc.ts";
import type { ExistingSize } from "../layout/shapes.ts";
import { getMeasurementsText, saveMeasurementsText, useMeasurementsText } from "./measurementsStore.ts";

export const INPUT_COUNT = Object.keys(PLACEHOLDERS).length;

const initial = parseMeasurements(getMeasurementsText());

/** Anubis size from measurements.yaml (read once; a hand edit of `existing` reloads the page). */
export const anubisSize: ExistingSize =
  initial.ok && initial.measurements.existing
    ? {
        height: initial.measurements.existing.anubis.height,
        width: initial.measurements.existing.anubis.width,
      }
    : { height: null, width: null };

export type ArmState = {
  /** The left arm (the projection works on it). */
  profile: ArmProfile;
  /** Left-arm keys that still show the sample body. */
  placeholders: ArmInputKey[];
  /** The whole body: every region's profile and the placement for the full-body view. */
  body: ResolvedBody;
  /** A region's profile. */
  region: (id: RegionId) => RegionProfile;
  /** measurements.yaml as loaded (an error keeps the sample body). */
  loaded: LoadResult;
  measurements: Measurements | null;
  /** Unsaved edits from Settings → Body & measurements; every 3D view shows them at once. */
  draft: MeasurementDraft;
  /** Number of unsaved values. */
  dirty: number;
  /** An own value (number), clear it back to the sample (null) or drop the edit (undefined). */
  setValue: (region: RegionId, key: string, value: number | null | undefined) => void;
  setBody: (body: BodyId | undefined) => void;
  setHeight: (cm: number | null | undefined) => void;
  discard: () => void;
  /** Writes the draft into measurements.yaml; rejects with a readable message. */
  save: () => Promise<void>;
};

/** The body shared by all tabs: file values plus the unsaved draft. */
export function useArm(): ArmState {
  const text = useMeasurementsText();
  const loaded = useMemo(() => parseMeasurements(text), [text]);
  const measurements = loaded.ok ? loaded.measurements : null;
  const [draft, setDraft] = useState<MeasurementDraft>({});
  const body = useMemo(() => resolveDraft(measurements, draft), [measurements, draft]);
  const left = body.regions["arm-left"];
  return {
    profile: left.profile as ArmProfile,
    placeholders: left.fromSample as ArmInputKey[],
    body,
    region: (id) => body.regions[id].profile,
    loaded,
    measurements,
    draft,
    dirty: draftSize(draft),
    setValue: (region, key, value) =>
      setDraft((d) => {
        const values = Object.fromEntries(
          Object.entries({ ...d.regions?.[region], [key]: value }).filter(([, v]) => v !== undefined),
        );
        const regions = Object.fromEntries(
          Object.entries({ ...d.regions, [region]: values }).filter(
            ([, v]) => Object.keys(v ?? {}).length > 0,
          ),
        );
        return { ...d, regions };
      }),
    setBody: (b) => setDraft((d) => ({ ...d, body: b })),
    setHeight: (cm) => setDraft((d) => ({ ...d, heightCm: cm })),
    discard: () => setDraft({}),
    save: async () => {
      const next = updateMeasurementsText(getMeasurementsText(), draft);
      await saveMeasurementsText(next);
      setDraft({});
    },
  };
}

/** Elbow pose shared by the 3D views (src/body/bend.ts). */
export type Pose = { bendDeg: number; setBendDeg: (deg: number) => void };
