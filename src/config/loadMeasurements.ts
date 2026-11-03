import { parse } from "yaml";
import { measurementsSchema, type Measurements } from "./measurements.ts";

export type LoadResult = { ok: true; measurements: Measurements } | { ok: false; error: string };

/** Parses and validates the text of config/measurements.yaml. */
export function parseMeasurements(text: string): LoadResult {
  let data: unknown;
  try {
    data = parse(text);
  } catch (e) {
    return { ok: false, error: `YAML syntax: ${(e as Error).message}` };
  }
  const result = measurementsSchema.safeParse(data);
  if (result.success) return { ok: true, measurements: result.data };
  const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, error: issues.join("; ") };
}
