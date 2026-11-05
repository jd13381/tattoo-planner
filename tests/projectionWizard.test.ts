// The guided projection wizard's pure logic (docs/adr/0014-guided-projection.md): steps, answers turned
// into a calibration, and back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { layoutSchema } from "../src/layout/schema.ts";
import { layoutsShowing, layoutTarget, linkProjection } from "../src/projection/layoutLink.ts";
import { turnedToStored } from "../src/projection/model.ts";
import { parseProjection } from "../src/projection/yamlDoc.ts";
import {
  coveringArc,
  facingOptions,
  fitArea,
  fromCalibration,
  moveStep,
  nearestFacing,
  newDraft,
  newPhoto,
  slugify,
  stepIssue,
  stepIndex,
  storedToTurned,
  toCalibration,
  turnPhoto,
  uniqueName,
  wizardSteps,
  withPhotos,
  type WizardDraft,
} from "../src/projection/wizard.ts";

const body = resolveBody(null);
const arm = body.regions["arm-left"].profile;
const ctx = { taken: ["anubis"], profile: arm };

function draft(): WizardDraft {
  return withPhotos({ ...newDraft("arm-left"), name: "rose" }, ["photos/a.jpg", "photos/b.jpg"]);
}

describe("wizard steps", () => {
  it("has name, photos, four tasks per photo and the preview", () => {
    const steps = wizardSteps(draft());
    expect(steps.length).toBe(2 + 2 * 4 + 1);
    expect(steps[0]).toEqual({ kind: "name" });
    expect(steps[2]).toEqual({ kind: "photo", photo: 0, task: "turn" });
    expect(steps[9]).toEqual({ kind: "photo", photo: 1, task: "facing" });
    expect(steps.at(-1)).toEqual({ kind: "preview" });
  });

  it("moves forwards and backwards and stops at the ends", () => {
    const d = draft();
    expect(moveStep(d, { kind: "name" }, -1)).toEqual({ kind: "name" });
    expect(moveStep(d, { kind: "photos" }, 1)).toEqual({ kind: "photo", photo: 0, task: "turn" });
    expect(moveStep(d, { kind: "photo", photo: 0, task: "facing" }, 1)).toEqual({
      kind: "photo",
      photo: 1,
      task: "turn",
    });
    expect(moveStep(d, { kind: "preview" }, 5)).toEqual({ kind: "preview" });
    // A photo step of a photo that was removed falls back to the photo list.
    expect(stepIndex(d, { kind: "photo", photo: 5, task: "turn" })).toBe(1);
  });

  it("blocks Next with a plain reason", () => {
    const d = draft();
    expect(stepIssue({ ...d, name: "" }, { kind: "name" }, ctx)).toMatch(/name/);
    expect(stepIssue({ ...d, name: "anubis" }, { kind: "name" }, ctx)).toMatch(/exists/);
    expect(stepIssue(d, { kind: "name" }, ctx)).toBeNull();
    expect(stepIssue({ ...d, photos: [] }, { kind: "photos" }, ctx)).toMatch(/photo/);
    const close = structuredClone(d);
    close.photos[0]!.marks[1].cm = 0.5;
    expect(stepIssue(close, { kind: "photo", photo: 0, task: "marks" }, ctx)).toMatch(/1 cm/);
    const upsideDown = structuredClone(d);
    upsideDown.photos[0]!.marks = [
      { x: 0.5, y: 0.2, cm: 0 },
      { x: 0.5, y: 0.8, cm: 20 },
    ];
    expect(stepIssue(upsideDown, { kind: "photo", photo: 0, task: "marks" }, ctx)).toMatch(/higher up/);
    const swapped = structuredClone(d);
    swapped.photos[0]!.edges = { left: d.photos[0]!.edges.right, right: d.photos[0]!.edges.left };
    expect(stepIssue(swapped, { kind: "photo", photo: 0, task: "edges" }, ctx)).toMatch(/left of/);
    expect(stepIssue(d, { kind: "preview" }, ctx)).toBeNull();
    expect(stepIssue(swapped, { kind: "preview" }, ctx)).toMatch(/^Photo 1:/);
  });

  it("an edited projection may keep its taken name", () => {
    expect(stepIssue({ ...draft(), name: "anubis" }, { kind: "name" }, ctx)).toMatch(/exists/);
    const r = toCalibration({ ...draft(), name: "anubis" }, arm);
    if (!r.ok) throw new Error(r.error);
    expect(stepIssue(fromCalibration(r.calibration), { kind: "name" }, ctx)).toBeNull();
  });
});

describe("photos", () => {
  it("keeps the answers of photos that stay picked and copies the distances to new ones", () => {
    const d = draft();
    d.photos[1]!.marks[1].cm = 26;
    d.photos[1]!.facing = 0.3;
    const next = withPhotos(d, ["photos/b.jpg", "photos/c.jpg"]);
    expect(next.photos.map((p) => p.file)).toEqual(["photos/b.jpg", "photos/c.jpg"]);
    expect(next.photos[0]!.facing).toBe(0.3);
    expect(next.photos[1]!.marks[1].cm).toBe(26);
    expect(newPhoto("x.jpg").marks.map((m) => m.cm)).toEqual([0, 15]);
  });

  it("turning a photo keeps every point on the same spot of the picture", () => {
    const p = newPhoto("a.jpg");
    p.edges.left[0] = { x: 0.2, y: 0.1 };
    for (const turn of [90, 180, 270] as const) {
      const q = turnPhoto(p, turn);
      expect(q.turn).toBe(turn);
      const before = turnedToStored(p.edges.left[0].x, p.edges.left[0].y, p.turn);
      const after = turnedToStored(q.edges.left[0].x, q.edges.left[0].y, q.turn);
      expect(after.x).toBeCloseTo(before.x, 4);
      expect(after.y).toBeCloseTo(before.y, 4);
      expect(q.marks[0].cm).toBe(p.marks[0].cm);
      const back = turnPhoto(q, 0);
      expect(back.marks[1].x).toBeCloseTo(p.marks[1].x, 4);
      expect(back.marks[1].y).toBeCloseTo(p.marks[1].y, 4);
    }
    for (const turn of [0, 90, 180, 270] as const) {
      const s = turnedToStored(0.3, 0.8, turn);
      const t = storedToTurned(s.x, s.y, turn);
      expect(t.x).toBeCloseTo(0.3, 9);
      expect(t.y).toBeCloseTo(0.8, 9);
    }
  });
});

describe("facing options", () => {
  it("names eight orientations after the region's centre lines", () => {
    const arm = facingOptions("arm-left");
    expect(arm.map((o) => o.u)).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
    expect(arm[0]!.label).toBe("Outer");
    expect(arm[4]!.label).toBe("Inner");
    expect(arm[3]!.label).toBe("Between lateral and inner");
    expect(arm[7]!.label).toBe("Between medial and outer");
    expect(facingOptions("torso")[2]!.label).toBe("Front");
    expect(nearestFacing("arm-left", 0.97).u).toBe(0);
    expect(nearestFacing("arm-left", 0.3).u).toBe(0.25);
  });
});

describe("patch area", () => {
  it("covers a quarter turn either side of every facing direction", () => {
    expect(coveringArc([0.5], 0.25)).toEqual([0.25, 0.75]);
    const [a, b] = coveringArc([0.5, 0.3], 0.25);
    expect(a).toBeCloseTo(0.05, 2);
    expect(b).toBeCloseTo(0.75, 2);
    // Across the u = 0 line: u0 goes negative.
    const [c, d] = coveringArc([0], 0.25);
    expect(c).toBeCloseTo(-0.25, 2);
    expect(d).toBeCloseTo(0.25, 2);
    // All round.
    const [e, f] = coveringArc([0, 0.5], 0.25);
    expect(f - e).toBeCloseTo(1, 6);
  });

  it("runs along the region from just below the lowest mark to above the highest", () => {
    const d = draft();
    d.photos[0]!.marks = [
      { x: 0.5, y: 0.8, cm: 2 },
      { x: 0.5, y: 0.2, cm: 28 },
    ];
    d.photos[1]!.twisted = true;
    d.photos[1]!.facingFar = 0.3;
    const area = fitArea(d, arm);
    expect(area.v[0] * arm.length).toBeCloseTo(0, 1);
    expect(area.v[1] * arm.length).toBeCloseTo(30, 1);
    expect(area.u[0]).toBeCloseTo(0.05, 2);
    expect(area.u[1]).toBeCloseTo(0.75, 2);
  });
});

describe("calibration from the wizard", () => {
  it("turns the answers into a valid calibration with default blending", () => {
    const d = draft();
    d.description = "Rose, inner forearm";
    d.photos[0]!.twisted = true;
    d.photos[0]!.facing = 0.4;
    d.photos[0]!.facingFar = 0.55;
    d.photos[1]!.facingFar = 0.1; // ignored while not twisted
    const r = toCalibration(d, arm);
    if (!r.ok) throw new Error(r.error);
    const cal = r.calibration;
    expect(cal.name).toBe("rose");
    expect(cal.region).toBeUndefined(); // the left arm stays implicit
    expect(cal.description).toBe("Rose, inner forearm");
    expect(cal.photos[0]!.u_view).toEqual({ wrist: 0.4, elbow: 0.55 });
    expect(cal.photos[1]!.u_view).toEqual({ wrist: 0.5, elbow: 0.5 });
    expect(cal.photos[0]!.along).toEqual(d.photos[0]!.marks);
    expect(cal.blend.exponent).toBe(4);
    expect(cal.patch.px_per_cm).toBe(20);
  });

  it("writes the region for other body parts", () => {
    const leg = body.regions["leg-left"].profile;
    const d = { ...draft(), region: "leg-left" as const };
    const r = toCalibration(d, leg);
    expect(r.ok && r.calibration.region).toBe("leg-left");
  });

  it("round-trips Jan's calibration: opening it in the wizard and saving changes nothing", () => {
    const text = readFileSync(new URL("../config/projections/anubis.yaml", import.meta.url), "utf8");
    const parsed = parseProjection(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const d = fromCalibration(parsed.calibration);
    expect(d.region).toBe("arm-left");
    expect(d.photos[1]!.twisted).toBe(true);
    expect(d.photos[0]!.twisted).toBe(false);
    const back = toCalibration(d, arm);
    if (!back.ok) throw new Error(back.error);
    expect(back.calibration).toEqual(parsed.calibration);
  });
});

describe("names", () => {
  it("makes file names from free text", () => {
    expect(slugify("Rose on the Calf")).toBe("rose-on-the-calf");
    expect(slugify("  Schädel & Blüten! ")).toBe("schadel-bluten");
    expect(slugify("Fuß")).toBe("fuss");
    expect(uniqueName("rose", ["rose", "rose-2"])).toBe("rose-3");
    expect(uniqueName("", [])).toBe("tattoo");
  });
});

describe("linking a projection into a layout", () => {
  const baseline = readFileSync(new URL("../config/layouts/v1-baseline.yaml", import.meta.url), "utf8");
  const torso = "name: back\nregion: torso\nelements: []\n";
  const files = [
    { name: "v1-baseline", text: baseline },
    { name: "back", text: torso },
    { name: "a-arm", text: "name: a-arm\nelements: []\n" },
  ];
  const cal = (() => {
    const r = toCalibration(draft(), arm);
    if (!r.ok) throw new Error(r.error);
    return r.calibration;
  })();

  it("prefers a layout that already shows it, then the open one, then the region's first, else a new one", () => {
    expect(layoutsShowing(files, "anubis")).toEqual(["v1-baseline"]);
    expect(layoutTarget("arm-left", files, "anubis", "a-arm")).toEqual({
      name: "v1-baseline",
      exists: true,
      why: "linked",
    });
    expect(layoutTarget("arm-left", files, "rose", "v1-baseline").why).toBe("open");
    expect(layoutTarget("arm-left", files, "rose", "back")).toEqual({
      name: "a-arm",
      exists: true,
      why: "first",
    });
    expect(layoutTarget("torso", files, "rose")).toEqual({ name: "back", exists: true, why: "first" });
    expect(layoutTarget("leg-left", files, "rose")).toEqual({
      name: "leg-left-1",
      exists: false,
      why: "new",
    });
  });

  it("adds a locked existing element at the patch, or leaves a linked one alone", () => {
    const layout = { name: "a-arm", elements: [] };
    const r = linkProjection(layout, { name: "a-arm", region: "arm-left" }, cal, arm);
    expect(r.changed).toBe(true);
    const el = r.layout.elements[0]!;
    expect(el).toMatchObject({ type: "existing", id: "rose", projection: "rose", locked: true });
    expect(layoutSchema.safeParse(r.layout).success).toBe(true);
    const again = linkProjection(r.layout, { name: "a-arm", region: "arm-left" }, cal, arm);
    expect(again.changed).toBe(false);
    expect(again.layout.elements.length).toBe(1);
    // An id clash gets a suffix.
    const clash = { name: "x", elements: [{ ...el, projection: "other" }] };
    expect(linkProjection(clash, { name: "x", region: "arm-left" }, cal, arm).elementId).toBe("rose-2");
  });

  it("creates the layout for a region that has none", () => {
    const r = linkProjection(null, { name: "leg-left-1", region: "leg-left" }, cal, arm);
    expect(r.layout).toMatchObject({ name: "leg-left-1", region: "leg-left" });
    expect(r.changed).toBe(true);
    expect(layoutSchema.safeParse(r.layout).success).toBe(true);
  });
});
