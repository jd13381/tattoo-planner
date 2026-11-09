// The Clean up step's eraser (docs/adr/0023-projection-cleanup.md, "Eraser"): strokes and speck removal
// on small pixel buffers, in the patch, in the projection file and in the wizard's draft; and how an
// edited photo of another shape is laid onto the photo's frame.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import {
  EMPTY_HISTORY,
  eraseMask,
  extendStroke,
  hasErase,
  paintStrokes,
  patchPxToUv,
  recordHistory,
  redoHistory,
  speckMask,
  specksToPx,
  storedErase,
  undoHistory,
  uvToPatchPx,
  type EraseSettings,
  type PatchGrid,
} from "../src/projection/erase.ts";
import { buildPatch, editMapping, type PhotoPixels } from "../src/projection/patch.ts";
import { projectionSchema } from "../src/projection/schema.ts";
import { fromCalibration, newDraft, toCalibration, withPhotos } from "../src/projection/wizard.ts";
import { parseProjection, updateProjectionText } from "../src/projection/yamlDoc.ts";

const arm = resolveBody(null).regions["arm-left"].profile;

/** A 10 × 8 patch over u 0.2…0.7, v 0.1…0.5, 4 px per cm. */
const grid: PatchGrid = { u0: 0.2, u1: 0.7, v0: 0.1, v1: 0.5, width: 10, height: 8, pxPerCm: 4 };

/** The pixels of a mask as rows of "#" (1) and "." (0). */
const rows = (m: Uint8Array, w: number) =>
  Array.from({ length: m.length / w }, (_, y) =>
    Array.from(m.slice(y * w, y * w + w), (v) => (v ? "#" : ".")).join(""),
  );

describe("eraser strokes", () => {
  it("converts between skin coordinates and patch pixels (column 0 at u1, row 0 at v1)", () => {
    expect(uvToPatchPx(grid, 0.7, 0.5)).toEqual({ x: 0, y: 0 });
    expect(uvToPatchPx(grid, 0.2, 0.1)).toEqual({ x: 10, y: 8 });
    const [u, v] = patchPxToUv(grid, 2.5, 4);
    expect(u).toBeCloseTo(0.575, 4);
    expect(v).toBeCloseTo(0.3, 4);
    const back = uvToPatchPx(grid, u, v);
    expect(back.x).toBeCloseTo(2.5, 3);
    expect(back.y).toBeCloseTo(4, 3);
  });

  it("paints a dot as a disc and a drag as a capsule; restore paints it back", () => {
    const dot = paintStrokes(new Uint8Array(80), [{ size_cm: 1, points: [patchPxToUv(grid, 5, 4)] }], grid);
    // 1 cm = 4 px across: a disc of radius 2 px around (5, 4).
    expect(rows(dot, 10)).toEqual([
      "..........",
      "..........",
      "....##....",
      "...####...",
      "...####...",
      "....##....",
      "..........",
      "..........",
    ]);
    const line = paintStrokes(
      new Uint8Array(80),
      [
        { size_cm: 0.45, points: [patchPxToUv(grid, 1, 1.5), patchPxToUv(grid, 9, 1.5)] },
        { size_cm: 0.45, restore: true, points: [patchPxToUv(grid, 5, 1.5)] },
      ],
      grid,
    );
    expect(rows(line, 10).slice(0, 3)).toEqual(["..........", "####..####", ".........."]);
  });

  it("skips points closer than half the brush radius while drawing", () => {
    const s = { size_cm: 2, points: [patchPxToUv(grid, 5, 4)] };
    expect(extendStroke(s, patchPxToUv(grid, 5.5, 4), grid)).toBe(s);
    expect(extendStroke(s, patchPxToUv(grid, 7, 4), grid).points).toHaveLength(2);
  });
});

describe("removing small specks", () => {
  // Ink: a 2-px dot, a 6-px diagonal line (8-connected), a faint mark below the threshold, NaN.
  const w = 8;
  const h = 6;
  const ink = new Float32Array(w * h);
  const set = (x: number, y: number, v = 1) => (ink[y * w + x] = v);
  set(0, 2);
  set(0, 3);
  for (let k = 0; k < 6; k++) set(2 + k, k);
  set(0, 5, 0.02);
  ink[4] = NaN;

  it("drops pieces smaller than the size, keeps larger ones and diagonal lines whole", () => {
    expect(rows(speckMask(ink, w, h, 3), w)).toEqual([
      "........",
      "........",
      "#.......",
      "#.......",
      "........",
      "........",
    ]);
    // Larger than the diagonal: it goes too. Off: nothing.
    expect(speckMask(ink, w, h, 7).reduce((a, b) => a + b, 0)).toBe(8);
    expect(speckMask(ink, w, h, 0).some((v) => v)).toBe(false);
  });

  it("measures the size in mm² at the patch's resolution", () => {
    // 10 px per cm: one pixel is 1 mm². 20 px per cm: 0.25 mm².
    expect(specksToPx(4, 10)).toBe(4);
    expect(specksToPx(4, 20)).toBe(16);
  });

  it("lets restore strokes bring back a speck", () => {
    const g: PatchGrid = { u0: 0, u1: 0.8, v0: 0, v1: 0.6, width: w, height: h, pxPerCm: 10 };
    const settings: EraseSettings = {
      specks_mm2: 3,
      strokes: [{ size_cm: 0.2, restore: true, points: [patchPxToUv(g, 0.5, 2.3)] }],
    };
    const m = eraseMask(settings, g, ink)!;
    expect(m[2 * w]).toBe(0);
    expect(m[3 * w]).toBe(1);
    expect(eraseMask({ specks_mm2: 0, strokes: [] }, g, ink)).toBeNull();
  });

  it("stores nothing when nothing is erased", () => {
    expect(hasErase(null)).toBe(false);
    expect(storedErase({ specks_mm2: 0, strokes: [] })).toBeNull();
    expect(storedErase({ specks_mm2: 2, strokes: [] })).toEqual({ specks_mm2: 2, strokes: [] });
  });
});

describe("undo and redo", () => {
  it("steps back and forth through the snapshots", () => {
    const a: EraseSettings = { specks_mm2: 0, strokes: [{ size_cm: 1, points: [[0.3, 0.3]] }] };
    let h = recordHistory(EMPTY_HISTORY, null);
    const undone = undoHistory(h, a)!;
    expect(undone.state).toBeNull();
    h = undone.history;
    expect(undoHistory(h, null)).toBeNull();
    const redone = redoHistory(h, null)!;
    expect(redone.state).toBe(a);
    expect(redoHistory(redone.history, a)).toBeNull();
  });
});

/** One upright photo of the left forearm with an ink bar and a small dot (as projectionCleanup.test.ts). */
function calibration(extra: Record<string, unknown> = {}) {
  return projectionSchema.parse({
    name: "t",
    patch: { u: [0.3, 0.7], v: [0, 0.4], px_per_cm: 4 },
    cleanup: { flatten_cm: 4, strength: 0.5 },
    ...extra,
    photos: [
      {
        file: "photos/a.jpg",
        edges: {
          left: [
            { x: 0.3, y: 0.1 },
            { x: 0.3, y: 0.9 },
          ],
          right: [
            { x: 0.7, y: 0.1 },
            { x: 0.7, y: 0.9 },
          ],
        },
        along: [
          { x: 0.5, y: 0.9, cm: 0 },
          { x: 0.5, y: 0.3, cm: 30 },
        ],
        u_view: { wrist: 0.5, elbow: 0.5 },
      },
    ],
  });
}

/** Skin with an ink bar at s = 8…12 cm in the middle and a 1 cm dot at s = 20 cm. */
function photo(): PhotoPixels {
  const width = 200;
  const height = 400;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (360 - y) / 8;
      const bar = s >= 8 && s <= 12 && x >= 92 && x <= 108;
      const dot = Math.hypot(s - 20, (x - 100) / 8) < 0.5;
      const v = bar || dot ? 30 : 220;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { width, height, data };
}

/** Opaque ink pixels of a patch in rows v0…v1 (fractions of the length). */
function inkIn(p: ReturnType<typeof buildPatch>, va: number, vb: number): number {
  let n = 0;
  for (let j = 0; j < p!.height; j++) {
    const v = p!.v1 - ((j + 0.5) / p!.height) * (p!.v1 - p!.v0);
    if (v < va || v > vb) continue;
    for (let i = 0; i < p!.width; i++) if (p!.alpha[j * p!.width + i]! > 128) n++;
  }
  return n;
}

describe("the eraser in the patch", () => {
  const L = arm.length;
  const bar = [8 / L, 12 / L] as const;
  const dot = [19 / L, 21 / L] as const;

  it("renders a file without the key exactly as before", () => {
    const a = buildPatch(calibration(), arm, [photo()])!;
    const b = buildPatch(calibration({ erase: { specks_mm2: 0, strokes: [] } }), arm, [photo()])!;
    expect(b.alpha).toEqual(a.alpha);
    expect(b.footprint).toEqual(a.footprint);
    expect(a.ink.length).toBe(a.width * a.height);
    expect(inkIn(a, ...bar)).toBeGreaterThan(10);
    expect(inkIn(a, ...dot)).toBeGreaterThan(0);
  });

  it("removes the dot as a speck and keeps the bar", () => {
    const p = buildPatch(calibration({ erase: { specks_mm2: 300 } }), arm, [photo()])!;
    expect(inkIn(p, ...dot)).toBe(0);
    expect(inkIn(p, ...bar)).toBeGreaterThan(10);
  });

  it("erases under a stroke, and the footprint follows", () => {
    const before = buildPatch(calibration(), arm, [photo()])!;
    const stroke = { size_cm: 8, points: [[0.5, 10 / L] as [number, number]] };
    const p = buildPatch(calibration({ erase: { strokes: [stroke] } }), arm, [photo()])!;
    expect(inkIn(p, ...bar)).toBe(0);
    expect(inkIn(p, ...dot)).toBe(inkIn(before, ...dot));
    expect(p.footprint.reduce((a, b) => a + b, 0)).toBeLessThan(before.footprint.reduce((a, b) => a + b, 0));
    // The ink before erasing stays available for the live view.
    expect(p.ink).toEqual(before.ink);
  });
});

describe("edited photos of another shape", () => {
  const frame = { width: 300, height: 400 };

  it("stretches by default, or fits inside / fills keeping the centre", () => {
    expect(editMapping(frame, { width: 600, height: 400 })).toEqual({ sx: 2, sy: 1, ox: 0, oy: 0 });
    // A 3:4 photo letterboxed into a square edit: bands left and right.
    expect(editMapping(frame, { width: 400, height: 400 }, "contain")).toEqual({
      sx: 1,
      sy: 1,
      ox: 50,
      oy: 0,
    });
    // Filling the square: top and bottom cut off.
    const cover = editMapping(frame, { width: 400, height: 400 }, "cover");
    expect(cover.sx).toBeCloseTo(4 / 3, 6);
    expect(cover.ox).toBeCloseTo(0, 6);
    expect(cover.oy).toBeCloseTo((400 - 400 * (4 / 3)) / 2, 6);
  });

  it("keeps the fit in the file and the draft, only next to an edit", () => {
    const d = withPhotos({ ...newDraft("arm-left"), name: "rose" }, ["photos/a.jpg"]);
    d.photos[0]!.cleanedFit = "contain";
    let r = toCalibration(d, arm);
    if (!r.ok) throw new Error(r.error);
    expect(r.calibration.photos[0]!.cleaned_fit).toBeUndefined();
    d.photos[0]!.cleaned = "edits/a-edit-1.png";
    r = toCalibration(d, arm);
    if (!r.ok) throw new Error(r.error);
    expect(r.calibration.photos[0]!.cleaned_fit).toBe("contain");
    expect(fromCalibration(r.calibration).photos[0]!.cleanedFit).toBe("contain");
  });
});

describe("the eraser in the projection file", () => {
  const anubis = readFileSync(new URL("../config/projections/anubis.yaml", import.meta.url), "utf8");
  const parsed = parseProjection(anubis);
  if (!parsed.ok) throw new Error(parsed.error);

  it("writes one line per stroke and reads it back; off again leaves no trace", () => {
    const cal = structuredClone(parsed.calibration);
    cal.erase = {
      specks_mm2: 4,
      strokes: [
        {
          size_cm: 1.5,
          points: [
            [0.31, 0.42],
            [0.3125, 0.43],
          ],
        },
        { size_cm: 0.5, restore: true, points: [[0.3, 0.4]] },
      ],
    };
    const text = updateProjectionText(anubis, cal);
    expect(text).toContain(
      "erase:\n  specks_mm2: 4\n  strokes:\n" +
        "    - { size_cm: 1.5, points: [[0.31, 0.42], [0.3125, 0.43]] }\n" +
        "    - { size_cm: 0.5, restore: true, points: [[0.3, 0.4]] }\n",
    );
    const back = parseProjection(text);
    expect(back.ok && back.calibration).toEqual(cal);
    // One more stroke rewrites the list in the same style.
    cal.erase.strokes.push({ size_cm: 2, points: [[0.5, 0.5]] });
    const more = updateProjectionText(text, cal);
    expect(more).toContain("    - { size_cm: 2, points: [[0.5, 0.5]] }\n");
    expect(updateProjectionText(more, parsed.calibration)).toBe(anubis);
  });

  it("keeps the eraser through the wizard's draft and drops empty settings", () => {
    const cal = structuredClone(parsed.calibration);
    cal.erase = { specks_mm2: 0, strokes: [{ size_cm: 1, points: [[0.3, 0.4]] }] };
    const d = fromCalibration(cal);
    expect(d.erase).toEqual(cal.erase);
    const r = toCalibration(d, arm);
    expect(r.ok && r.calibration.erase).toEqual(cal.erase);
    const none = toCalibration({ ...d, erase: { specks_mm2: 0, strokes: [] } }, arm);
    expect(none.ok && none.calibration.erase).toBeUndefined();
    expect(fromCalibration(parsed.calibration).erase).toBeNull();
  });
});
