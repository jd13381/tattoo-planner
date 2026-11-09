// Landmark chips for the distances (docs/adr/0024-projection-workspace.md, "Measurements inline"): the
// places along a body region whose distance from its start the planner knows from the current person's
// measurements (or the sample body), e.g. the elbow tip 30 cm above the wrist crease. A click on a chip
// sets a mark's distance to it. Pure: from the region's profile and which inputs are measured.
import type { RegionProfile } from "../body/profile.ts";

export type LandmarkChip = {
  id: string;
  label: string;
  /** Distance from the region's start along its axis, cm (one decimal). */
  cm: number;
  /** Whether every value it comes from is the person's own measurement (else the sample body's). */
  measured: boolean;
};

type Def = { id: string; label: string; at: (p: RegionProfile) => number | null; keys: string[] };

const station = (label: string) => (p: RegionProfile) => p.stations.find((s) => s.label === label)?.s ?? null;
const end = (p: RegionProfile) => p.length;

const DEFS: Record<RegionProfile["kind"], Def[]> = {
  arm: [
    { id: "wrist", label: "Wrist crease", at: () => 0, keys: [] },
    {
      id: "forearm_max",
      label: "Thickest forearm",
      at: station("forearm_max"),
      keys: ["elbow_to_wrist", "forearm_max_below_elbow"],
    },
    { id: "elbow", label: "Elbow tip", at: (p) => (p.kind === "arm" ? p.elbowAt : null), keys: ["elbow_to_wrist"] },
    {
      id: "armpit",
      label: "Armpit level",
      at: station("armpit_level"),
      keys: ["elbow_to_wrist", "shoulder_to_elbow", "armpit_level_below_shoulder"],
    },
    { id: "shoulder", label: "Shoulder point", at: end, keys: ["elbow_to_wrist", "shoulder_to_elbow"] },
  ],
  leg: [
    { id: "ankle", label: "Ankle", at: () => 0, keys: [] },
    { id: "calf_max", label: "Thickest calf", at: station("calf_max"), keys: ["ankle_to_knee", "calf_max_below_knee"] },
    { id: "knee", label: "Knee centre", at: (p) => (p.kind === "leg" ? p.kneeAt : null), keys: ["ankle_to_knee"] },
    {
      id: "thigh_top",
      label: "Top of the thigh",
      at: station("thigh_top"),
      keys: ["ankle_to_knee", "knee_to_hip", "thigh_top_below_hip"],
    },
    { id: "hip", label: "Hip crease", at: end, keys: ["ankle_to_knee", "knee_to_hip"] },
  ],
  torso: [
    { id: "waist", label: "Navel", at: () => 0, keys: [] },
    { id: "ribs", label: "Lowest ribs", at: (p) => (p.kind === "torso" ? p.ribsAt : null), keys: ["waist_to_ribs"] },
    { id: "chest", label: "Chest line", at: (p) => (p.kind === "torso" ? p.chestAt : null), keys: ["waist_to_chest"] },
    {
      id: "shoulder_line",
      label: "Shoulder line",
      at: station("shoulder_line"),
      keys: ["waist_to_neck", "shoulder_line_below_neck"],
    },
    { id: "neck", label: "Neck base", at: end, keys: ["waist_to_neck"] },
  ],
};

/**
 * The region's landmarks with their distance from its start, in order along the region. `fromSample`
 * lists the input keys nobody measured (src/body/body.ts, `ResolvedRegion.fromSample`).
 */
export function landmarkChips(
  profile: RegionProfile,
  fromSample: readonly string[],
): LandmarkChip[] {
  const sample = new Set(fromSample);
  return DEFS[profile.kind]
    .flatMap((d) => {
      const s = d.at(profile);
      if (s === null || !Number.isFinite(s)) return [];
      return [{ id: d.id, label: d.label, cm: Math.round(s * 10) / 10, measured: d.keys.every((k) => !sample.has(k)) }];
    })
    .sort((a, b) => a.cm - b.cm);
}

/** The chip a distance is at (within 0.05 cm), if any: shown as the mark's label. */
export function chipAt(chips: readonly LandmarkChip[], cm: number): LandmarkChip | null {
  return chips.find((c) => Math.abs(c.cm - cm) < 0.05) ?? null;
}
