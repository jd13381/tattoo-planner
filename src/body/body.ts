// Resolves the body the planner shows (docs/adr/0011): the chosen sample body, adjusted by own
// measurements. For every value of every region the first of these wins:
//   1. an unsaved edit from the measurements panel (left arm only, for now),
//   2. the value measured for that region in measurements.yaml,
//   3. the value measured for the same key on the other side (an unmeasured right arm copies the left),
//   4. the sample body's value, scaled by own height / sample height when `height_cm` is given.
import type { Measurements, RegionMeasurements } from "../config/measurements.ts";
import { inputKeys, type InputValues } from "./inputs.ts";
import { layoutBody, type BodyLayout } from "./placement.ts";
import { buildLegProfile, buildProfile, buildTorsoProfile, type RegionProfile } from "./profile.ts";
import { REGION_IDS, REGIONS, type RegionId } from "./regions.ts";
import {
  DEFAULT_BODY,
  SAMPLES,
  scaleValues,
  UNSCALED_INPUTS,
  UNSCALED_PARAMS,
  type BodyId,
  type BodyParams,
} from "./samples.ts";
import type { ArmInputs, LegInputs, TorsoInputs } from "./inputs.ts";

export type ResolvedRegion = {
  id: RegionId;
  profile: RegionProfile;
  inputs: InputValues;
  /** Keys nobody measured on this region or its mirror image: they show the sample body. */
  fromSample: string[];
};

export type ResolvedBody = {
  body: BodyId;
  /** Own height from measurements.yaml, null when not given. */
  heightCm: number | null;
  /** Own height / sample height (1 without an own height). */
  scale: number;
  params: BodyParams;
  regions: Record<RegionId, ResolvedRegion>;
  /** Region placements and the neutral parts for the full-body view. */
  layout: BodyLayout;
};

/** Per-region edits that are not saved in measurements.yaml yet. */
export type RegionOverrides = Partial<Record<RegionId, Partial<Record<string, number>>>>;

const MIRROR: Partial<Record<RegionId, RegionId>> = {
  "arm-left": "arm-right",
  "arm-right": "arm-left",
  "leg-left": "leg-right",
  "leg-right": "leg-left",
};

/** The measured values of one region, flattened; null (or missing) where not measured. */
export function measuredRegionValues(
  m: Measurements | null,
  id: RegionId,
): Partial<Record<string, number | null>> {
  if (!m) return {};
  const block: RegionMeasurements | undefined =
    id === "arm-left" && (m.lengths || m.circumferences || m.positions)
      ? { lengths: m.lengths, circumferences: m.circumferences, positions: m.positions }
      : m.regions?.[id];
  if (!block) return {};
  return Object.assign({}, ...Object.values(block).filter(Boolean)) as Partial<Record<string, number | null>>;
}

export function resolveBody(m: Measurements | null, overrides: RegionOverrides = {}): ResolvedBody {
  const body = m?.body ?? DEFAULT_BODY;
  const sample = SAMPLES[body];
  const heightCm = m?.height_cm ?? null;
  const scale = heightCm ? heightCm / sample.params.height : 1;
  const params = scaleValues(sample.params, scale, UNSCALED_PARAMS as ReadonlySet<string>);

  const regions = {} as Record<RegionId, ResolvedRegion>;
  for (const id of REGION_IDS) {
    const def = REGIONS[id];
    const own = { ...measuredRegionValues(m, id), ...overrides[id] };
    const mirror = MIRROR[id];
    const other = mirror ? { ...measuredRegionValues(m, mirror), ...overrides[mirror] } : {};
    const fallback = scaleValues(sample[def.kind] as InputValues, scale, UNSCALED_INPUTS);
    const inputs: InputValues = {};
    const fromSample: string[] = [];
    for (const key of inputKeys(def.kind)) {
      const v = own[key] ?? other[key];
      if (v === null || v === undefined) {
        inputs[key] = fallback[key]!;
        fromSample.push(key);
      } else inputs[key] = v;
    }
    regions[id] = { id, profile: buildRegionProfile(id, inputs), inputs, fromSample };
  }
  const profiles = Object.fromEntries(REGION_IDS.map((id) => [id, regions[id].profile])) as Record<
    RegionId,
    RegionProfile
  >;
  return { body, heightCm, scale, params, regions, layout: layoutBody(params, profiles) };
}

/** Builds a region's profile from its resolved inputs. */
export function buildRegionProfile(id: RegionId, inputs: InputValues): RegionProfile {
  const def = REGIONS[id];
  switch (def.kind) {
    case "arm":
      return buildProfile(inputs as ArmInputs, def.mirrored);
    case "leg":
      return buildLegProfile(inputs as LegInputs, def.mirrored);
    case "torso":
      return buildTorsoProfile(inputs as TorsoInputs);
  }
}
