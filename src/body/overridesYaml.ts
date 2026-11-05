// Turns the measurement edits from the Arm tab into a YAML snippet Jan can paste into
// config/measurements.yaml. Only values that differ from the file are listed, grouped under the
// same section keys and in the same order as the file.
import { measurementsSchema } from "../config/measurements.ts";
import type { ArmInputKey } from "./inputs.ts";

const SECTIONS = ["lengths", "circumferences", "positions"] as const;

/** Section keys of measurements.yaml with their field keys, in file order. */
const SECTION_KEYS: { section: (typeof SECTIONS)[number]; keys: ArmInputKey[] }[] = SECTIONS.map(
  (section) => ({
    section,
    keys: Object.keys(measurementsSchema.shape[section].shape) as ArmInputKey[],
  }),
);

/** The edited keys whose value differs from the file (null in the file counts as different). */
export function changedKeys(
  overrides: Partial<Record<ArmInputKey, number>>,
  fileValues: Record<ArmInputKey, number | null>,
): ArmInputKey[] {
  return SECTION_KEYS.flatMap(({ keys }) =>
    keys.filter((k) => overrides[k] !== undefined && overrides[k] !== fileValues[k]),
  );
}

/** Rounds to 0.01 cm and drops float noise (30.100000000000001 → 30.1). */
function formatCm(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * YAML for the changed values, e.g. "circumferences:\n  wrist: 18.5\n"; "" when nothing changed.
 * Keys are listed in file order whatever order they were edited in.
 */
export function overridesYaml(
  overrides: Partial<Record<ArmInputKey, number>>,
  fileValues: Record<ArmInputKey, number | null>,
): string {
  const changed = new Set(changedKeys(overrides, fileValues));
  let out = "";
  for (const { section, keys } of SECTION_KEYS) {
    const lines = keys.filter((k) => changed.has(k)).map((k) => `  ${k}: ${formatCm(overrides[k]!)}\n`);
    if (lines.length > 0) out += `${section}:\n${lines.join("")}`;
  }
  return out;
}
