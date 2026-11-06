// Reading layouts written before background layers (docs/adr/0019). Fillers used to be elements
// (`type: filler` with a pattern, a u/v region and a density). On load each becomes an "area"
// background layer with that region as a `span` shape, appended above the file's own background
// layers in their element order. Nothing is written back on load: the file changes to the new form
// only when the variant is saved.
import type { BackgroundLayer, LegacyFiller } from "./schema.ts";

export type MigrationResult = {
  /** The raw layout object with fillers moved from `elements` to `backgrounds`. */
  value: unknown;
  /** Ids of the fillers that were converted, in their old order. */
  converted: string[];
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** The background layer a former filler element becomes. Same id, pattern, density, region and lock. */
export function fillerToLayer(f: LegacyFiller): BackgroundLayer {
  return {
    id: f.id,
    ...(f.locked !== undefined ? { locked: f.locked } : {}),
    ...(f.notes !== undefined ? { notes: f.notes } : {}),
    source: { pattern: f.pattern, ...(f.density !== undefined ? { density: f.density } : {}) },
    cover: "area",
    shapes: [{ kind: "span", u: [f.region.u[0], f.region.u[1]], v: [f.region.v[0], f.region.v[1]] }],
  };
}

/**
 * Moves every `type: filler` element of a raw (unvalidated) layout object into `backgrounds`.
 * Anything that is not a well-formed layout is returned unchanged, so the schema reports the error.
 * A filler with unexpected fields is converted field by field; the schema then checks the result.
 */
export function migrateFillers(raw: unknown): MigrationResult {
  if (!isObject(raw) || !Array.isArray(raw.elements)) return { value: raw, converted: [] };
  const fillers = raw.elements.filter((e) => isObject(e) && e.type === "filler") as Record<string, unknown>[];
  if (fillers.length === 0) return { value: raw, converted: [] };
  const layers = fillers.map((f) => {
    const { type, id, locked, notes, pattern, region, density, ...rest } = f;
    void type;
    const r = isObject(region) ? region : {};
    return {
      id,
      ...(locked !== undefined ? { locked } : {}),
      ...(notes !== undefined ? { notes } : {}),
      source: { pattern, ...(density !== undefined ? { density } : {}) },
      cover: "area",
      shapes: [{ kind: "span", u: r.u, v: r.v }],
      // Unknown filler keys stay, so the schema names them instead of silently dropping them.
      ...rest,
    };
  });
  const own = Array.isArray(raw.backgrounds) ? raw.backgrounds : [];
  return {
    value: {
      ...raw,
      backgrounds: [...own, ...layers],
      elements: raw.elements.filter((e) => !(isObject(e) && e.type === "filler")),
    },
    converted: fillers.map((f) => String(f.id)),
  };
}
