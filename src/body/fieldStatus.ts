// What the measurements form shows for each value of a region: the value in use, where it comes from
// (an unsaved edit, the file, the other side, the sample body) and what it falls back to without an own
// value. Same precedence as resolveBody (src/body/body.ts); framework-free so it is testable.
import type { Measurements } from "../config/measurements.ts";
import type { MeasurementDraft } from "../config/measurementsDoc.ts";
import { measuredRegionValues, MIRROR, resolveBody, type ResolvedBody } from "./body.ts";
import { inputKeys, type InputValues } from "./inputs.ts";
import { REGIONS, type RegionId } from "./regions.ts";
import { DEFAULT_BODY, SAMPLES, scaleValues, UNSCALED_INPUTS, type BodyId } from "./samples.ts";

export type FieldSource = "edited" | "measured" | "other-side" | "sample";

export type FieldStatus = {
  key: string;
  /** The value the 3D region uses. */
  value: number;
  source: FieldSource;
  /** The own value (unsaved edit, else the file's), null when there is none. */
  own: number | null;
  /** The value in measurements.yaml, null when not measured. */
  file: number | null;
  /** Whether an unsaved edit changes the file's value (a cleared value counts). */
  changed: boolean;
  /** What the value would be without an own value: the other side's measurement or the sample's. */
  fallback: number;
  fallbackSource: "other-side" | "sample";
};

/** The file with the draft's body choice applied (what resolveBody should see). */
export function draftMeasurements(m: Measurements | null, draft: MeasurementDraft): Measurements | null {
  if (draft.body === undefined && draft.heightCm === undefined) return m;
  const base: Measurements = m ?? { units: "cm" };
  return {
    ...base,
    ...(draft.body !== undefined ? { body: draft.body } : {}),
    ...(draft.heightCm !== undefined ? { height_cm: draft.heightCm } : {}),
  };
}

/** The resolved body with the draft applied: the live preview of the form and the wizard. */
export function resolveDraft(m: Measurements | null, draft: MeasurementDraft): ResolvedBody {
  return resolveBody(draftMeasurements(m, draft), draft.regions ?? {});
}

/** The sample body and height in use, and their source. */
export function bodyStatus(m: Measurements | null, draft: MeasurementDraft) {
  const effective = draftMeasurements(m, draft);
  const body: BodyId = effective?.body ?? DEFAULT_BODY;
  const heightCm = effective?.height_cm ?? null;
  return {
    body,
    heightCm,
    sampleHeight: SAMPLES[body].params.height,
    bodyChanged: draft.body !== undefined && draft.body !== (m?.body ?? DEFAULT_BODY),
    heightChanged: draft.heightCm !== undefined && draft.heightCm !== (m?.height_cm ?? null),
  };
}

/** Every value of a region, in file order, with its source and fallback. */
export function fieldStatuses(m: Measurements | null, draft: MeasurementDraft, id: RegionId): FieldStatus[] {
  const { body, heightCm, sampleHeight } = bodyStatus(m, draft);
  const scale = heightCm ? heightCm / sampleHeight : 1;
  const sample = scaleValues(SAMPLES[body][REGIONS[id].kind] as InputValues, scale, UNSCALED_INPUTS);
  const file = measuredRegionValues(m, id);
  const edits = draft.regions?.[id] ?? {};
  const mirror = MIRROR[id];
  const other = mirror ? { ...measuredRegionValues(m, mirror), ...draft.regions?.[mirror] } : {};
  return inputKeys(REGIONS[id].kind).map((key) => {
    const fileValue = file[key] ?? null;
    const edited = edits[key] !== undefined;
    const own = edited ? (edits[key] ?? null) : fileValue;
    const otherValue = other[key] ?? null;
    const fallback = otherValue ?? sample[key]!;
    const fallbackSource = otherValue !== null ? "other-side" : "sample";
    const changed = edited && own !== fileValue;
    const source: FieldSource = own !== null ? (changed ? "edited" : "measured") : fallbackSource;
    return { key, value: own ?? fallback, source, own, file: fileValue, changed, fallback, fallbackSource };
  });
}

/** Rounds a cm value for display (one decimal, no trailing ".0"). */
export function formatCm(v: number): string {
  return String(Math.round(v * 10) / 10);
}
