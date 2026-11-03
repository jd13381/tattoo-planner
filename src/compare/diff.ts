// Which elements differ between two layout variants (read-only comparison, PROJECT_BRIEF.md §14 Phase 6).
import type { Layout, LayoutElement } from "../layout/schema.ts";

export type ElementChange = { id: string; type: LayoutElement["type"]; fields: string[] };
export type LayoutDiff = { onlyA: string[]; onlyB: string[]; changed: ElementChange[]; same: string[] };

const json = (v: unknown) => JSON.stringify(v ?? null);

/** Elements matched by id; `fields` lists the keys whose values differ (missing = undefined). */
export function diffLayouts(a: Layout, b: Layout): LayoutDiff {
  const byIdB = new Map(b.elements.map((e) => [e.id, e]));
  const idsA = new Set(a.elements.map((e) => e.id));
  const out: LayoutDiff = { onlyA: [], onlyB: [], changed: [], same: [] };
  for (const ea of a.elements) {
    const eb = byIdB.get(ea.id);
    if (!eb) {
      out.onlyA.push(ea.id);
      continue;
    }
    const keys = [...new Set([...Object.keys(ea), ...Object.keys(eb)])];
    const fields = keys.filter(
      (k) => json((ea as Record<string, unknown>)[k]) !== json((eb as Record<string, unknown>)[k]),
    );
    if (fields.length > 0) out.changed.push({ id: ea.id, type: eb.type, fields });
    else out.same.push(ea.id);
  }
  for (const eb of b.elements) if (!idsA.has(eb.id)) out.onlyB.push(eb.id);
  return out;
}
