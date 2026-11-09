// The projection workspace's draft (docs/adr/0024-projection-workspace.md): photos, the covered area,
// answers turned into a calibration and back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { layoutSchema } from "../src/layout/schema.ts";
import { coveringArc } from "../src/projection/area.ts";
import { layoutsShowing, layoutTarget, linkProjection } from "../src/projection/layoutLink.ts";
import { turnedToStored } from "../src/projection/model.ts";
import { newProjectionText, parseProjection } from "../src/projection/yamlDoc.ts";
import {
  draftAutoArea,
  fromCalibration,
  nameIssue,
  newDraft,
  newPhoto,
  picksOf,
  sectionSketch,
  slugify,
  storedToTurned,
  toCalibration,
  turnPhoto,
  uniqueName,
  withPhotos,
  type ProjectionDraft,
} from "../src/projection/draft.ts";

const body = resolveBody(null);
const arm = body.regions["arm-left"].profile;

function draft(): ProjectionDraft {
  return withPhotos({ ...newDraft("arm-left"), name: "rose" }, [
    { file: "photos/a.jpg", cleaned: null },
    { file: "photos/b.jpg", cleaned: null },
  ]);
}

describe("names", () => {
  it("blocks saving with a plain reason", () => {
    const d = draft();
    expect(nameIssue({ ...d, name: "" }, ["anubis"])).toMatch(/name/);
    expect(nameIssue({ ...d, name: "anubis" }, ["anubis"])).toMatch(/exists/);
    expect(nameIssue({ ...d, name: "Rose!" }, [])).toMatch(/letters/);
    expect(nameIssue(d, ["anubis"])).toBeNull();
  });

  it("an edited projection may keep its taken name", () => {
    const r = toCalibration({ ...draft(), name: "anubis" }, arm);
    if (!r.ok) throw new Error(r.error);
    expect(nameIssue(fromCalibration(r.calibration), ["anubis"])).toBeNull();
  });
});

describe("photos", () => {
  it("keeps the answers of photos that stay picked and copies the distances to new ones", () => {
    const d = draft();
    d.photos[1]!.marks[1].cm = 26;
    d.photos[1]!.facing = 0.3;
    const next = withPhotos(d, [
      { file: "photos/b.jpg", cleaned: null },
      { file: "photos/c.jpg", cleaned: null },
    ]);
    expect(next.photos.map((p) => p.file)).toEqual(["photos/b.jpg", "photos/c.jpg"]);
    expect(next.photos[0]!.facing).toBe(0.3);
    expect(next.photos[1]!.marks[1].cm).toBe(26);
    expect(newPhoto("x.jpg").marks.map((m) => m.cm)).toEqual([0, 15]);
    expect(newPhoto("x.jpg").facingSet).toBe(false);
  });

  it("picking another version of a photo keeps its points and swaps the pixels", () => {
    const d = draft();
    d.photos[0]!.marks[1].cm = 21;
    d.photos[0]!.cleanedFit = "contain";
    const next = withPhotos(d, [
      { file: "photos/a.jpg", cleaned: "edits/a-ink.png" },
      { file: "photos/b.jpg", cleaned: null },
    ]);
    expect(next.photos[0]!.marks[1].cm).toBe(21);
    expect(next.photos[0]!.cleaned).toBe("edits/a-ink.png");
    expect(next.photos[0]!.cleanedFit).toBeNull(); // the fit belonged to the other edit
    expect(next.photos[1]).toBe(d.photos[1]);
    expect(picksOf(next)[0]).toEqual({ file: "photos/a.jpg", cleaned: "edits/a-ink.png" });
    // A new photo picked as an edit: the original is the frame.
    const fresh = withPhotos(newDraft(), [{ file: "photos/c.jpg", cleaned: "edits/c.png" }]);
    expect(fresh.photos[0]).toMatchObject({ file: "photos/c.jpg", cleaned: "edits/c.png" });
  });
  it("turning a photo keeps every point on the same spot of the picture", () => {
    const fresh = newPhoto("a.jpg");
    // Untouched starting points stay on the screen.
    expect(turnPhoto(fresh, 90).marks).toEqual(fresh.marks);
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

  it("follows the photos: outline ends and marks, both facings of a twisted photo", () => {
    const d = draft();
    d.photos[0]!.marks = [
      { x: 0.5, y: 0.8, cm: 2 },
      { x: 0.5, y: 0.2, cm: 28 },
    ];
    d.photos[1]!.twisted = true;
    d.photos[1]!.facingFar = 0.3;
    const area = draftAutoArea(d, arm)!;
    // Photo 1: 26 cm over 0.6 of the photo's height, so its outline ends (y 0.15 and 0.85) lie at
    // about -0.2 and 30.2 cm; then the 1 cm margin, and not below the start.
    expect(area.v[0]).toBe(0);
    expect(area.v[1] * arm.length).toBeCloseTo(31.2, 1);
    expect(area.u[0]).toBeCloseTo(0.05, 2);
    expect(area.u[1]).toBeCloseTo(0.75, 2);
  });

  it("uses the held area when there is one", () => {
    const d = { ...draft(), area: { u: [0.1, 0.9] as [number, number], v: [0.2, 0.4] as [number, number] } };
    const r = toCalibration(d, arm);
    expect(r.ok && r.calibration.patch).toMatchObject({ u: [0.1, 0.9], v: [0.2, 0.4] });
  });
});

describe("calibration from the draft", () => {
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

  it("writes a nudge of the edited version only with an edit, rounded", () => {
    const d = draft();
    d.photos[0]!.cleanedOffset = { x: 0.012345, y: 0 };
    let r = toCalibration(d, arm);
    expect(r.ok && r.calibration.photos[0]!.cleaned_offset).toBeUndefined();
    d.photos[0]!.cleaned = "edits/a.png";
    r = toCalibration(d, arm);
    expect(r.ok && r.calibration.photos[0]!.cleaned_offset).toEqual({ x: 0.0123, y: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(fromCalibration(r.calibration).photos[0]!.cleanedOffset).toEqual({ x: 0.0123, y: 0 });
  });

  it("writes the region for other body parts", () => {
    const leg = body.regions["leg-left"].profile;
    const d = { ...draft(), region: "leg-left" as const };
    const r = toCalibration(d, leg);
    expect(r.ok && r.calibration.region).toBe("leg-left");
  });

  it("round-trips Jan's calibration: opening it in the workspace and saving changes nothing", () => {
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
    expect(d.photos.every((p) => p.facingSet)).toBe(true);
  });
});

describe("file names", () => {
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

describe("orientation sketch", () => {
  it("puts the side facing the camera at the bottom and matches the photo's left and right", () => {
    const s = sectionSketch("arm-left", 0.5);
    const inner = s.lines.find((l) => l.u === 0.5)!;
    expect(inner.p.x).toBeCloseTo(0, 6);
    expect(inner.p.y).toBeGreaterThan(0.5);
    // Seen from the inner side, lateral (0.25) is on the right, as in the photo.
    expect(s.lines.find((l) => l.u === 0.25)!.p.x).toBeGreaterThan(0.5);
    // The torso from the front: the left flank (0.5) on the right.
    const t = sectionSketch("torso", 0.25);
    expect(t.lines.find((l) => l.u === 0.5)!.p.x).toBeGreaterThan(0.5);
    expect(t.lines.find((l) => l.u === 0.25)!.p.y).toBeGreaterThan(0.3);
  });
});

describe("a new projection file", () => {
  it("is written in the hand-written style and reads back", () => {
    const r = toCalibration({ ...draft(), region: "torso" }, body.regions.torso.profile);
    if (!r.ok) throw new Error(r.error);
    const text = newProjectionText(r.calibration);
    expect(text).toContain("u_view: { wrist: 0.5, elbow: 0.5 }");
    expect(text).toMatch(/left: \[\{ x: [\d.]+, y: [\d.]+ \}, \{ x/);
    expect(text).toContain("blend:\n  exponent: 4");
    const back = parseProjection(text);
    expect(back.ok && back.calibration).toEqual(r.calibration);
  });
});
