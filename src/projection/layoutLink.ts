// Where a saved projection shows up (docs/adr/0014-guided-projection.md): the wizard links it into a
// layout of its region as an `existing` element with `projection:`. Pure functions over layout texts.
import type { RegionProfile } from "../body/profile.ts";
import type { RegionId } from "../body/regions.ts";
import { wrapU } from "../body/uv.ts";
import type { Layout, LayoutElement } from "../layout/schema.ts";
import { layoutRegion, parseLayout } from "../layout/yamlDoc.ts";
import type { ProjectionCalibration } from "./schema.ts";
import { uniqueName } from "./draft.ts";

export type LayoutFile = { name: string; text: string };

export type LayoutTarget = {
  name: string;
  /** False: the layout does not exist yet and is created on save. */
  exists: boolean;
  /** Why this layout: it already shows the tattoo, it is open in the Layout tab, the region's first, or new. */
  why: "linked" | "open" | "first" | "new";
};

/** Layouts that show a projection (an `existing` element with that `projection:`), by file name. */
export function layoutsShowing(files: readonly LayoutFile[], projection: string): string[] {
  return files
    .filter((f) => {
      const r = parseLayout(f.text);
      return r.ok && r.layout.elements.some((e) => e.type === "existing" && e.projection === projection);
    })
    .map((f) => f.name);
}

/**
 * The layout the wizard links a projection into: one of the region's layouts that already shows it,
 * else the one open in the Layout tab (when it is on that region), else the region's first layout,
 * else a new one named after the region.
 */
export function layoutTarget(
  region: RegionId,
  files: readonly LayoutFile[],
  projection: string,
  open?: string | null,
): LayoutTarget {
  const mine = files.filter((f) => layoutRegion(f.text) === region);
  const linked = layoutsShowing(mine, projection)[0];
  if (linked) return { name: linked, exists: true, why: "linked" };
  if (open && mine.some((f) => f.name === open)) return { name: open, exists: true, why: "open" };
  const first = [...mine].sort((a, b) => a.name.localeCompare(b.name))[0];
  if (first) return { name: first.name, exists: true, why: "first" };
  const taken = files.map((f) => f.name);
  let i = 1;
  while (taken.includes(`${region}-${i}`)) i++;
  return { name: `${region}-${i}`, exists: false, why: "new" };
}

/**
 * The layout with the projection in it. An element that already shows it stays as it is (its placement
 * comes from the projection anyway); otherwise a locked `existing` element is added at the patch's
 * middle, whose box is what the planner shows while the photos cannot be read.
 */
export function linkProjection(
  layout: Layout | null,
  target: { name: string; region: RegionId },
  cal: ProjectionCalibration,
  profile: Pick<RegionProfile, "length">,
): { layout: Layout; changed: boolean; elementId: string } {
  const base: Layout = layout ?? {
    name: target.name,
    ...(target.region !== "arm-left" ? { region: target.region } : {}),
    elements: [],
  };
  const present = base.elements.find((e) => e.type === "existing" && e.projection === cal.name);
  if (present) return { layout: base, changed: layout === null, elementId: present.id };
  const [u0, u1] = cal.patch.u;
  const [v0, v1] = cal.patch.v;
  const id = uniqueName(
    cal.name,
    base.elements.map((e) => e.id),
  );
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const element: LayoutElement = {
    type: "existing",
    id,
    projection: cal.name,
    locked: true,
    position: { u: round(wrapU((u0 + u1) / 2)), v: round((v0 + v1) / 2) },
    size_cm: { h: Math.max(1, Math.round((v1 - v0) * profile.length)) },
  };
  return { layout: { ...base, elements: [...base.elements, element] }, changed: true, elementId: id };
}

/**
 * What deleting a projection does to the layouts (Settings → Projection → Delete): the layouts showing
 * it, the ones its element can be taken out of, and the one held back because it has unsaved edits in
 * the Layout tab (its next save there would put the element back).
 */
export function deletePlan(
  files: readonly LayoutFile[],
  projection: string,
  open?: { name: string; dirty: boolean } | null,
): { shownIn: string[]; removable: string[]; heldBack: string | null } {
  const shownIn = layoutsShowing(files, projection);
  const heldBack = open?.dirty && shownIn.includes(open.name) ? open.name : null;
  return { shownIn, removable: shownIn.filter((n) => n !== heldBack), heldBack };
}
