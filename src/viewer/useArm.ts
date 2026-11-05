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
import { withProjectBody } from "../project/projectData.ts";
import { heightSchema } from "../project/schema.ts";
import {
  bodyInProject,
  getMeasurementsText,
  saveBodyChoice,
  saveMeasurementsText,
  useMeasurementsState,
} from "./measurementsStore.ts";

export const INPUT_COUNT = Object.keys(PLACEHOLDERS).length;

const initial = parseMeasurements(getMeasurementsText());

/** Anubis size from measurements.yaml (read once at load; Body & measurements never changes it). */
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
  /** measurements.yaml with body and height from project.yaml where it gives them. */
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
  /**
   * Writes the draft: values into measurements.yaml, body and height into project.yaml for a project
   * folder (else into measurements.yaml too). Rejects with a readable message.
   */
  save: () => Promise<void>;
};

/** The body shared by all tabs: file values plus the unsaved draft. */
export function useArm(): ArmState {
  const { text, project } = useMeasurementsState();
  const loaded = useMemo(() => parseMeasurements(text), [text]);
  const measurements = useMemo(
    () => withProjectBody(loaded.ok ? loaded.measurements : null, project),
    [loaded, project],
  );
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
      const h = draft.heightCm;
      if (h !== undefined && h !== null && !heightSchema.safeParse(h).success)
        throw new Error("the body height must be between 50 and 260 cm");
      const inProject = bodyInProject();
      const bodyChanged = draft.body !== undefined || draft.heightCm !== undefined;
      // In a project, project.yaml holds body and height: the height leaves measurements.yaml.
      const forText: MeasurementDraft = inProject
        ? { regions: draft.regions, ...(draft.heightCm !== undefined ? { heightCm: null } : {}) }
        : draft;
      const next = updateMeasurementsText(getMeasurementsText(), forText);
      if (next !== getMeasurementsText()) await saveMeasurementsText(next);
      if (inProject && bodyChanged) await saveBodyChoice({ body: draft.body, height_cm: draft.heightCm });
      setDraft({});
    },
  };
}

/** Elbow pose shared by the 3D views (src/body/bend.ts). */
export type Pose = { bendDeg: number; setBendDeg: (deg: number) => void };
