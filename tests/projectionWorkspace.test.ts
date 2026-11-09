// The projection workspace's pure logic (docs/adr/0024-projection-workspace.md): checklist, covered
// area, undo history, photo versions, landmark chips, correction on the unwrap and the cm ruler.
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { areaContains, autoArea, openingArea, photoSpan } from "../src/projection/area.ts";
import { draftIssues, photoChecks, photoState, previewable } from "../src/projection/checks.ts";
import { newDraft, newPhoto, toPhotoCalibration, withPhotos, type DraftPhoto } from "../src/projection/draft.ts";
import {
  beginGesture,
  canRedo,
  canUndo,
  cancelGesture,
  commit,
  endGesture,
  historyOf,
  mapHistory,
  redo,
  undo,
} from "../src/projection/history.ts";
import { chipAt, landmarkChips } from "../src/projection/landmarks.ts";
import { photoFrame, twistReach } from "../src/projection/model.ts";
import { buildPatch, type PhotoPixels } from "../src/projection/patch.ts";
import { pickedVersion, photoStacks, stackedIds, togglePick } from "../src/projection/photoVersions.ts";
import { rulerTicks } from "../src/projection/ruler.ts";
import { projectionSchema } from "../src/projection/schema.ts";
import {
  dragPhoto,
  nudgePhoto,
  scaleAlong,
  shiftAlong,
  skinToUnwrap,
  unwrapToSkin,
  type UnwrapView,
} from "../src/projection/unwrapDrag.ts";

const body = resolveBody(null);
const arm = body.regions["arm-left"].profile;

/** A photo whose outline and marks were placed by hand (not the starting places). */
function placed(file = "photos/a.jpg"): DraftPhoto {
  const p = newPhoto(file);
  return {
    ...p,
    edges: {
      left: [
        { x: 0.3, y: 0.1 },
        { x: 0.32, y: 0.9 },
      ],
      right: [
        { x: 0.7, y: 0.1 },
        { x: 0.68, y: 0.9 },
      ],
    },
    marks: [
      { x: 0.5, y: 0.9, cm: 0 },
      { x: 0.5, y: 0.1, cm: 20 },
    ],
  };
}

describe("checklist", () => {
  it("says what a new photo still needs, and blocks only on errors", () => {
    const fresh = newPhoto("photos/a.jpg");
    const checks = photoChecks(fresh, "arm-left");
    expect(checks.map((c) => [c.id, c.state])).toEqual([
      ["outline", "todo"],
      ["distances", "todo"],
      ["facing", "todo"],
      ["cleaned", "optional"],
    ]);
    expect(photoState(checks)).toBe("todo");
    expect(previewable(checks)).toBe(false);
    const done = { ...placed(), facingSet: true };
    expect(photoState(photoChecks(done, "arm-left"))).toBe("done");
    expect(previewable(photoChecks({ ...placed(), facingSet: false }, "arm-left"))).toBe(true);
    const swapped = { ...done, edges: { left: done.edges.right, right: done.edges.left } };
    const bad = photoChecks(swapped, "arm-left");
    expect(bad[0]).toMatchObject({ state: "error", text: expect.stringMatching(/left of/) });
    expect(photoState(bad)).toBe("error");
    const close = structuredClone(done);
    close.marks[1].cm = 0.5;
    expect(photoChecks(close, "arm-left")[1]!.text).toMatch(/1 cm/);
    const upside = structuredClone(done);
    upside.marks = [
      { x: 0.5, y: 0.2, cm: 0 },
      { x: 0.5, y: 0.8, cm: 20 },
    ];
    expect(photoChecks(upside, "arm-left")[1]!.text).toMatch(/higher up/);
  });

  it("asks to check the fit of an edit of another shape", () => {
    const p = { ...placed(), facingSet: true, cleaned: "edits/a.png" };
    const sizes = new Map([
      ["photos/a.jpg", { width: 3000, height: 4000 }],
      ["edits/a.png", { width: 1024, height: 1024 }],
    ]);
    const sizeOf = (f: string) => sizes.get(f) ?? null;
    expect(photoChecks(p, "arm-left", sizeOf)[3]!.state).toBe("todo");
    expect(photoChecks({ ...p, cleanedFit: "contain" }, "arm-left", sizeOf)[3]!.state).toBe("done");
  });

  it("lists the to-dos for Save, errors first", () => {
    const d = withPhotos({ ...newDraft(), name: "" }, [{ file: "photos/a.jpg", cleaned: null }]);
    const issues = draftIssues(d, []);
    expect(issues[0]).toMatchObject({ photo: null, check: "name", severity: "error" });
    expect(issues.filter((i) => i.photo === 0).map((i) => i.check)).toEqual(["outline", "distances", "facing"]);
    expect(draftIssues({ ...newDraft(), name: "x" }, [])[0]!.check).toBe("photos");
  });
});

describe("covered area", () => {
  it("spans each photo's outline ends and marks along the region", () => {
    const span = photoSpan(toPhotoCalibration(placed()), { width: 1000, height: 1000 }, arm)!;
    expect(span[0]).toBeCloseTo(0, 6);
    expect(span[1]).toBeCloseTo(20, 6);
    const area = autoArea([{ photo: toPhotoCalibration(placed()), size: null }], arm)!;
    expect(area.v[0]).toBe(0);
    expect(area.v[1] * arm.length).toBeCloseTo(21, 1);
    expect(area.u).toEqual([0.25, 0.75]);
    expect(autoArea([], arm)).toBeNull();
  });

  it("tells whether one area covers another, also across u = 0", () => {
    const a = { u: [0.2, 0.8] as [number, number], v: [0, 0.5] as [number, number] };
    expect(areaContains(a, { u: [0.25, 0.75], v: [0.1, 0.4] })).toBe(true);
    expect(areaContains(a, { u: [0.1, 0.75], v: [0.1, 0.4] })).toBe(false);
    expect(areaContains(a, { u: [0.25, 0.75], v: [0.1, 0.6] })).toBe(false);
    const seam = { u: [-0.3, 0.3] as [number, number], v: [0, 1] as [number, number] };
    expect(areaContains(seam, { u: [0.75, 1.2], v: [0.2, 0.3] })).toBe(true);
    expect(areaContains(seam, { u: [0.6, 1.2], v: [0.2, 0.3] })).toBe(false);
    expect(areaContains({ u: [0, 1], v: [0, 1] }, { u: [0.6, 1.2], v: [0.2, 0.3] })).toBe(true);
  });

  it("opens a saved projection on the automatic area when its own cuts the photos off", () => {
    const saved = { u: [0.25, 0.75] as [number, number], v: [0, 0.3] as [number, number] };
    expect(openingArea(saved, { u: [0.25, 0.75], v: [0, 0.4] })).toBeNull();
    expect(openingArea(saved, { u: [0.3, 0.7], v: [0.05, 0.25] })).toBe(saved);
    expect(openingArea(saved, null)).toBe(saved);
  });
});

describe("undo history", () => {
  it("makes one step per change, per gesture and per run of the same key", () => {
    let h = historyOf(0);
    h = commit(h, 1);
    h = commit(h, 2, "slider");
    h = commit(h, 3, "slider");
    expect(h.past).toEqual([0, 1]);
    h = beginGesture(h);
    h = commit(h, 4);
    h = commit(h, 5);
    h = endGesture(h);
    expect(h.past).toEqual([0, 1, 3]);
    h = undo(h);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = commit(h, 9);
    expect(canRedo(h)).toBe(false);
    // A change with a key after an undo starts a new step.
    h = undo(h);
    h = commit(h, 10, "slider");
    expect(h.past.at(-1)).toBe(3);
  });

  it("Esc cancels a gesture, and a gesture that changed nothing is no step", () => {
    let h = commit(historyOf("a"), "b");
    h = beginGesture(h);
    h = commit(h, "c");
    expect(canUndo(h)).toBe(true);
    h = cancelGesture(h);
    expect(h.present).toBe("b");
    expect(h.past).toEqual(["a"]);
    h = endGesture(beginGesture(h));
    expect(h.past).toEqual(["a"]);
    // Undo during a gesture cancels it.
    h = undo(commit(beginGesture(h), "d"));
    expect(h.present).toBe("b");
  });

  it("can change every state at once without a step", () => {
    const h = mapHistory(commit(historyOf({ n: 1, base: 0 }), { n: 2, base: 0 }), (s) => ({ ...s, base: 7 }));
    expect(h.past[0]).toEqual({ n: 1, base: 7 });
    expect(h.present).toEqual({ n: 2, base: 7 });
  });
});

describe("photo versions", () => {
  const assets = [
    { id: "a", file: "photos/a.jpg" },
    { id: "a-ink", file: "edits/a-ink.png", derived_from: "a" },
    { id: "a-gpt", file: "edits/a-gpt.png", derived_from: "a" },
    { id: "gone", file: "edits/gone.png", derived_from: "a", exists: false },
    { id: "b", file: "photos/b.jpg" },
  ];
  const stacks = photoStacks([assets[0]!, assets[4]!], assets);

  it("stacks the edits on their original, newest first, without missing files", () => {
    expect(stacks[0]!.edits.map((e) => e.id)).toEqual(["a-gpt", "a-ink"]);
    expect(stacks[1]!.edits).toEqual([]);
    expect([...stackedIds(stacks)]).toEqual(["a-gpt", "a-ink"]);
  });

  it("picking an edit keeps the original as the frame and uses the edit's pixels", () => {
    const [a] = stacks;
    let picks = togglePick(a!, assets[1]!, []);
    expect(picks).toEqual([{ file: "photos/a.jpg", cleaned: "edits/a-ink.png" }]);
    expect(pickedVersion(a!, picks)?.id).toBe("a-ink");
    picks = togglePick(stacks[1]!, assets[4]!, picks);
    // Another version of a picked photo keeps its place.
    picks = togglePick(a!, assets[0]!, picks);
    expect(picks).toEqual([
      { file: "photos/a.jpg", cleaned: null },
      { file: "photos/b.jpg", cleaned: null },
    ]);
    // The picked version again unpicks the photo.
    picks = togglePick(a!, assets[0]!, picks);
    expect(picks).toEqual([{ file: "photos/b.jpg", cleaned: null }]);
    expect(pickedVersion(a!, picks)).toBeNull();
    // An older file that names an edit as the photo shows that edit as picked.
    expect(pickedVersion(a!, [{ file: "EDITS/a-gpt.png", cleaned: null }])?.id).toBe("a-gpt");
  });
});

describe("landmark chips", () => {
  it("lists the arm's landmarks with their distance from the wrist crease", () => {
    const own = resolveBody({ lengths: { elbow_to_wrist: 30, shoulder_to_elbow: 44 } } as never);
    const r = own.regions["arm-left"];
    const chips = landmarkChips(r.profile, r.fromSample);
    expect(chips.map((c) => c.id)).toEqual(["wrist", "forearm_max", "elbow", "armpit", "shoulder"]);
    expect(chips.find((c) => c.id === "elbow")).toMatchObject({ cm: 30, measured: true });
    expect(chips.find((c) => c.id === "shoulder")).toMatchObject({ cm: 74, measured: true });
    // forearm_max_below_elbow is not measured: the sample body's value.
    expect(chips.find((c) => c.id === "forearm_max")!.measured).toBe(false);
    expect(chipAt(chips, 30.02)?.id).toBe("elbow");
    expect(chipAt(chips, 12)).toBeNull();
  });

  it("has landmarks for legs and the torso", () => {
    const leg = body.regions["leg-right"];
    expect(landmarkChips(leg.profile, leg.fromSample).map((c) => c.id)).toContain("knee");
    const torso = body.regions.torso;
    const t = landmarkChips(torso.profile, torso.fromSample);
    expect(t[0]).toMatchObject({ id: "waist", cm: 0, measured: true });
    expect(t.at(-1)!.cm).toBeCloseTo(torso.profile.length, 1);
  });
});

describe("correction on the unwrap", () => {
  const view: UnwrapView = { profile: arm, pxPerCm: 10, centerU: 0.5, top: 100 };

  it("maps skin points to the crop and back", () => {
    for (const [u, s] of [
      [0.5, 10],
      [0.3, 25],
      [0.7, 4],
    ] as const) {
      const p = skinToUnwrap(view, u, s);
      const q = unwrapToSkin(view, p.x, p.y);
      expect(q.u).toBeCloseTo(u, 9);
      expect(q.s).toBeCloseTo(s, 9);
    }
    // On the left arm's unwrap u grows to the left (lateral left of the outer line).
    expect(skinToUnwrap(view, 0.6, 10).x).toBeLessThan(skinToUnwrap(view, 0.5, 10).x);
    // Higher up the arm is higher on the screen.
    expect(skinToUnwrap(view, 0.5, 20).y).toBeLessThan(skinToUnwrap(view, 0.5, 10).y);
  });

  it("dragging turns the camera side and shifts the marks; handles stretch", () => {
    const p = { ...placed(), facing: 0.5, facingFar: 0.5 };
    const moved = dragPhoto(p, "move", { u: 0.5, s: 10 }, { u: 0.55, s: 12.5 }, [0, 20]);
    expect(moved.facing).toBeCloseTo(0.55, 6);
    expect(moved.facingFar).toBeCloseTo(0.55, 6);
    expect(moved.marks.map((m) => m.cm)).toEqual([2.5, 22.5]);
    expect(moved.facingSet).toBe(true);
    // Across the seam the turn is the short way round.
    expect(dragPhoto({ ...p, facing: 0.98 }, "move", { u: 0.98, s: 0 }, { u: 1.03, s: 0 }, [0, 20]).facing).toBeCloseTo(
      0.03,
      6,
    );
    const taller = dragPhoto(p, "top", { u: 0.5, s: 20 }, { u: 0.5, s: 25 }, [0, 20]);
    expect(taller.marks.map((m) => m.cm)).toEqual([0, 25]);
    const lower = dragPhoto(p, "bottom", { u: 0.5, s: 0 }, { u: 0.5, s: 4 }, [0, 20]);
    expect(lower.marks.map((m) => m.cm)).toEqual([4, 20]);
  });

  it("keeps the marks at or above the start and at least 1 cm apart", () => {
    const p = placed();
    expect(shiftAlong(p, -5).marks.map((m) => m.cm)).toEqual([0, 20]);
    expect(scaleAlong(p, 0, 0.001).marks.map((m) => m.cm)).toEqual([0, 1]);
    expect(scaleAlong(p, 20, 2).marks.map((m) => m.cm)).toEqual([0, 40]);
  });

  it("nudges with the arrow keys: 0.1 cm, Shift 1 cm", () => {
    const p = placed();
    expect(nudgePhoto(p, "ArrowUp", false, 25, -1).marks[1].cm).toBeCloseTo(20.1, 6);
    expect(nudgePhoto(shiftAlong(p, 5), "ArrowDown", true, 25, -1).marks[1].cm).toBeCloseTo(24, 6);
    // Not below the start.
    expect(nudgePhoto(p, "ArrowDown", true, 25, -1).marks[1].cm).toBe(20);
    // On the left arm u grows to the left: ArrowLeft adds 1 cm of 25 cm round.
    expect(nudgePhoto(p, "ArrowLeft", true, 25, -1).facing).toBeCloseTo(0.54, 6);
    expect(nudgePhoto(p, "ArrowRight", true, 25, 1).facing).toBeCloseTo(0.54, 6);
  });
});

describe("cm ruler", () => {
  it("puts a tick every cm outside the left edge, a long one every 5 cm", () => {
    const frame = photoFrame(toPhotoCalibration(placed()), 1000, 1000, twistReach(arm))!;
    const ticks = rulerTicks(frame, arm.length, 10, 8);
    expect(ticks[0]!.cm).toBe(0);
    // The photo spans 20 cm over 0.8 of its height: 22.5 cm in all from its bottom edge.
    expect(ticks.at(-1)!.cm).toBe(22);
    expect(ticks.filter((t) => t.major).map((t) => t.cm)).toEqual([0, 5, 10, 15, 20]);
    // Left of the left edge (x 0.3 … 0.32 of 1000 px), pointing away from it.
    expect(ticks.every((t) => t.a.x < 320 && t.b.x < t.a.x)).toBe(true);
  });
});

describe("edited version nudge", () => {
  it("reads cleaned_offset and shifts the edit's pixels on the photo", () => {
    const cal = projectionSchema.parse({
      name: "t",
      patch: { u: [0.25, 0.75], v: [0, 0.3] },
      photos: [{ ...toPhotoCalibration({ ...placed(), facingSet: true }), cleaned: "e.png" }],
    });
    // An edit with a dark vertical bar in the middle; shifted right, the bar moves with it.
    const W = 200;
    const data = new Uint8ClampedArray(W * W * 4).fill(255);
    for (let y = 0; y < W; y++)
      for (let x = 95; x < 105; x++) data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
    const edit = (offset?: { x: number; y: number }): PhotoPixels => ({
      width: W,
      height: W,
      data,
      cleaned: { frame: { width: W, height: W }, ...(offset ? { offset } : {}) },
    });
    const darkest = (img: PhotoPixels) => {
      const patch = buildPatch(cal, arm, [img])!;
      const row = Math.floor(patch.height / 2);
      let best = 0;
      for (let i = 1; i < patch.width; i++)
        if (patch.gray[row * patch.width + i]! < patch.gray[row * patch.width + best]!) best = i;
      return best;
    };
    expect(darkest(edit({ x: 0.05, y: 0 }))).not.toBe(darkest(edit()));
    expect(projectionSchema.safeParse({ ...cal, photos: [{ ...cal.photos[0], cleaned_offset: { x: 0.9, y: 0 } }] }).success).toBe(
      false,
    );
  });
});
