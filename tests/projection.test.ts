import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PLACEHOLDERS } from "../src/arm/inputs.ts";
import { listProjections, saveProjection } from "../src/data/server/projectionsApi.ts";
import { classify, resolveElement } from "../src/layout/shapes.ts";
import { coverage } from "../src/metrics/coverage.ts";
import { buildProfile } from "../src/arm/profile.ts";
import {
  alongArm,
  photoFrame,
  projectPoint,
  sectionView,
  turnedSize,
  turnedToStored,
  viewWeight,
} from "../src/projection/model.ts";
import {
  buildPatch,
  dropSmall,
  fillHoles,
  footprintBounds,
  localWhite,
  patchCovers,
  patchSize,
  type PhotoPixels,
} from "../src/projection/patch.ts";
import { projectionSchema, type ProjectionCalibration } from "../src/projection/schema.ts";
import { parseProjection, updateProjectionText } from "../src/projection/yamlDoc.ts";

const profile = buildProfile(PLACEHOLDERS);

/** A photo of the arm standing upright: edges at x = 0.3 and 0.7, wrist crease at y = 0.9, 30 cm = 0.6. */
function calibration(uView = 0.5): ProjectionCalibration {
  return projectionSchema.parse({
    name: "t",
    patch: { u: [0.2, 0.8], v: [0, 0.4], px_per_cm: 4 },
    photos: [
      {
        file: "arm-photos/a.jpg",
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
        u_view: { wrist: uView, elbow: uView },
      },
    ],
  });
}

describe("sectionView", () => {
  it("puts u_view on an axis in the middle of the silhouette and the sides 90° away on its edges", () => {
    for (const uView of [0, 0.25, 0.5, 0.75]) {
      const view = sectionView(24, 1.3, uView);
      expect(view.at(uView).t).toBeCloseTo(0, 6);
      expect(view.at(uView).cos).toBeCloseTo(1, 6);
      // Seen from u_view, lateral (u − 0.25 … ) lies on the right for the inner view.
      expect(Math.abs(view.at(uView + 0.25).t)).toBeCloseTo(1, 3);
      expect(Math.abs(view.at(uView - 0.25).t)).toBeCloseTo(1, 3);
      expect(view.at(uView + 0.25).cos).toBeCloseTo(0, 3);
      expect(view.at(uView + 0.5).cos).toBeCloseTo(-1, 6);
    }
  });

  it("shows lateral on the right of the inner view, as the unwrap seen from outside", () => {
    const inner = sectionView(24, 1.3, 0.5);
    expect(inner.at(0.25).t).toBeCloseTo(1, 3); // lateral
    expect(inner.at(0.75).t).toBeCloseTo(-1, 3); // medial
  });

  it("keeps every point inside the silhouette, with visibility falling off away from u_view", () => {
    const view = sectionView(20, 1.4, 0.4);
    for (let u = 0; u < 1; u += 0.01) expect(Math.abs(view.at(u).t)).toBeLessThanOrEqual(1 + 1e-9);
    expect(view.at(0.4).cos).toBeGreaterThan(view.at(0.3).cos);
    expect(view.at(0.3).cos).toBeGreaterThan(view.at(0.2).cos);
  });
});

describe("photoFrame and projectPoint", () => {
  const cal = calibration();
  const frame = photoFrame(cal.photos[0]!, 1000, 2000, profile.elbowAt)!;

  it("scales the arm from the two marks and finds the wrist crease", () => {
    expect(frame.pxPerCm).toBeCloseTo(1200 / 30, 9);
    expect(frame.wrist.y).toBeCloseTo(1800, 9);
    expect(alongArm(frame, { x: 123, y: 1800 - 40 * 12 })).toBeCloseTo(12, 9);
  });

  it("projects the inner line to the middle and the sides to the edges", () => {
    const mid = projectPoint(frame, profile, 0.5, 10)!;
    expect(mid.x).toBeCloseTo(500, 6);
    expect(mid.y).toBeCloseTo(1800 - 400, 6);
    expect(mid.cos).toBeCloseTo(1, 6);
    expect(projectPoint(frame, profile, 0.25, 10)!.x).toBeCloseTo(700, 0);
    expect(projectPoint(frame, profile, 0.75, 10)!.x).toBeCloseTo(300, 0);
  });

  it("works with the marks given the other way round and off the axis", () => {
    const p = calibration().photos[0]!;
    p.along = [
      { x: 0.65, y: 0.5, cm: 20 },
      { x: 0.32, y: 0.8, cm: 5 },
    ];
    const f = photoFrame(p, 1000, 2000, profile.elbowAt)!;
    expect(f.pxPerCm).toBeCloseTo(600 / 15, 9);
    expect(f.wrist.y).toBeCloseTo(1600 + 5 * 40, 9);
  });

  it("follows u_view along the arm between wrist and elbow", () => {
    const p = calibration().photos[0]!;
    p.u_view = { wrist: 0.3, elbow: 0.5 };
    const f = photoFrame(p, 1000, 2000, profile.elbowAt)!;
    expect(f.uViewAt(0)).toBeCloseTo(0.3);
    expect(f.uViewAt(profile.elbowAt / 2)).toBeCloseTo(0.4);
    expect(f.uViewAt(profile.elbowAt + 10)).toBeCloseTo(0.5);
  });

  it("rejects marks that do not run along the arm", () => {
    const p = calibration().photos[0]!;
    p.along = [
      { x: 0.3, y: 0.5, cm: 0 },
      { x: 0.7, y: 0.5, cm: 10 },
    ];
    expect(photoFrame(p, 1000, 2000, profile.elbowAt)).toBeNull();
  });
});

describe("viewWeight", () => {
  it("prefers frontal views and ignores the far side", () => {
    expect(viewWeight(1, 4)).toBe(1);
    expect(viewWeight(0.5, 4)).toBeCloseTo(0.0625);
    expect(viewWeight(0.5, 4, 2)).toBeCloseTo(0.125);
    expect(viewWeight(0, 4)).toBe(0);
    expect(viewWeight(-0.3, 4)).toBe(0);
  });
});

describe("turned photos", () => {
  it("maps turned points back to the stored photo", () => {
    expect(turnedToStored(0, 0, 90)).toEqual({ x: 0, y: 1 });
    expect(turnedToStored(1, 0, 90)).toEqual({ x: 0, y: 0 });
    expect(turnedToStored(0.2, 0.3, 180)).toEqual({ x: 0.8, y: 0.7 });
    expect(turnedToStored(0.2, 0.3, 270)).toEqual({ x: 0.7, y: 0.2 });
    expect(turnedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
  });
});

/** A synthetic photo: white skin with a dark square where the inner line crosses s = 6…10 cm. */
function syntheticPhoto(brightness = 220): PhotoPixels {
  const width = 200;
  const height = 400;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // pxPerCm = 0.6 * 400 / 30 = 8; s = (360 - y) / 8.
      const s = (360 - y) / 8;
      const ink = s >= 6 && s <= 10 && Math.abs(x - 100) <= 12;
      const v = ink ? 30 : brightness;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { width, height, data };
}

describe("buildPatch", () => {
  it("returns null without photos", () => {
    expect(buildPatch(calibration(), profile, [null])).toBeNull();
  });

  it("maps the photo onto the skin: ink where the photo has it, white skin elsewhere", () => {
    const cal = calibration();
    const patch = buildPatch(cal, profile, [syntheticPhoto()])!;
    expect(patch.width).toBe(patchSize(cal, profile).width);
    const at = (u: number, v: number) => {
      const i = Math.floor(((patch.u1 - u) / (patch.u1 - patch.u0)) * patch.width);
      const j = Math.floor(((patch.v1 - v) / (patch.v1 - patch.v0)) * patch.height);
      return { gray: patch.gray[j * patch.width + i]!, alpha: patch.alpha[j * patch.width + i]! };
    };
    const L = profile.length;
    expect(at(0.5, 8 / L).gray).toBeLessThan(80);
    expect(at(0.5, 15 / L).gray).toBeGreaterThan(240);
    expect(at(0.5, 15 / L).alpha).toBe(255);
    // Grazing views fade out.
    expect(at(0.24, 15 / L).alpha).toBeLessThan(at(0.5, 15 / L).alpha);
    expect(patchCovers(patch, 0.5, 8 / L)).toBe(true);
    expect(patchCovers(patch, 0.5, 20 / L)).toBe(false);
    expect(patchCovers(patch, 0.1, 8 / L)).toBe(false);
    const b = footprintBounds(patch)!;
    expect(b.v[0] * L).toBeLessThan(6.5);
    expect(b.v[1] * L).toBeGreaterThan(9.5);
    expect(patch.share).toEqual([1]);
  });

  it("evens out exposure: a darker photo of the same skin gives the same patch", () => {
    const cal = calibration();
    const bright = buildPatch(cal, profile, [syntheticPhoto(230)])!;
    const dark = buildPatch(cal, profile, [syntheticPhoto(150)])!;
    const k = Math.floor(bright.height * 0.3) * bright.width + Math.floor(bright.width / 2);
    expect(Math.abs(bright.gray[k]! - dark.gray[k]!)).toBeLessThan(3);
  });

  it("blends photos by their view weight: the frontal photo wins", () => {
    const front = calibration(0.5);
    const side = calibration(0.3).photos[0]!;
    const cal = { ...front, photos: [front.photos[0]!, side] };
    const patch = buildPatch(cal, profile, [syntheticPhoto(), syntheticPhoto()])!;
    expect(patch.share[0]).toBeGreaterThan(patch.share[1]!);
    expect(patch.share[0]! + patch.share[1]!).toBeCloseTo(1, 9);
  });
});

describe("footprint helpers", () => {
  it("drops small specks and fills enclosed holes", () => {
    // 5 × 5: a ring with a hole, and a lone speck.
    const m = Uint8Array.from([1, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const cleaned = dropSmall(m, 5, 5, 2);
    expect(cleaned[9]).toBe(0);
    expect(fillHoles(cleaned, 5, 5)[6]).toBe(1);
  });

  it("local white follows the skin around dark marks", () => {
    const w = 40;
    const h = 40;
    const src = new Float32Array(w * h).fill(200);
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) src[y * w + x] = 20;
    const white = localWhite(src, w, h, 6);
    expect(white[20 * w + 20]).toBeCloseTo(200, 0);
  });
});

describe("projection YAML", () => {
  const text = readFileSync(new URL("../config/projections/anubis.yaml", import.meta.url), "utf8");

  it("the committed Anubis calibration is valid and covers the measured tattoo", () => {
    const r = parseProjection(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calibration.photos.map((p) => p.file)).toContain("arm-photos/anubis1_nr.JPG");
    const L = 74;
    expect(r.calibration.patch.v[0] * L).toBeLessThan(2);
    expect(r.calibration.patch.v[1] * L).toBeGreaterThan(28);
  });

  it("rejects bad ranges and marks too close together", () => {
    const bad = parse(text);
    bad.patch.u = [0.8, 0.2];
    bad.photos[0].along[1].cm = bad.photos[0].along[0].cm + 0.5;
    const r = projectionSchema.safeParse(bad);
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("patch.u");
    expect(paths).toContain("photos.0.along");
  });

  it("writes changed numbers back and keeps the comments", () => {
    const r = parseProjection(text);
    if (!r.ok) throw new Error(r.error);
    const cal = structuredClone(r.calibration);
    cal.photos[1]!.u_view.wrist = 0.61;
    cal.photos[0]!.edges.left[0].x = 0.355;
    const out = updateProjectionText(text, cal);
    expect(out).toContain("Fitted by Claude");
    expect(out).toContain("# u facing the camera");
    expect(out).toContain("wrist: 0.61");
    expect(out).toContain("x: 0.355");
    const back = parseProjection(out);
    expect(back.ok && back.calibration.photos[1]!.u_view.wrist).toBe(0.61);
    // Unchanged values stay as written.
    expect(out.split("\n").length).toBe(text.split("\n").length);
  });
});

describe("projected existing tattoo in a layout", () => {
  const cal = calibration();
  const patch = buildPatch(cal, profile, [syntheticPhoto()])!;
  const el = {
    type: "existing" as const,
    id: "anubis",
    asset: "anubis-photo",
    projection: "t",
    locked: true,
    position: { u: 0.5, v: 0.9 },
    size_cm: { h: 5, w: 5 },
  };

  it("uses the patch footprint instead of the box when the patch is there", () => {
    const r = resolveElement(el, profile, undefined, undefined, patch);
    expect(r.shape.kind).toBe("patch");
    const cls = classify(
      { name: "t", elements: [el] },
      profile,
      2,
      undefined,
      0,
      undefined,
      new Map([["anubis", patch]]),
    );
    const area = coverage(cls, profile).total.byCategory.existing;
    // The dark square: about 4 cm tall, 3 cm wide, plus the footprint's smoothing.
    expect(area).toBeGreaterThan(8);
    expect(area).toBeLessThan(60);
    // The element is in the classification (the box at v = 0.9 would be far above the square).
    expect(cls.cells.some((c) => c === 1)).toBe(true);
  });

  it("falls back to the box without a patch", () => {
    expect(resolveElement(el, profile).shape.kind).toBe("box");
  });
});

describe("projections API", () => {
  it("saves a calibration, keeping the comments, and lists it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "projections-"));
    await writeFile(
      path.join(dir, "anubis.yaml"),
      readFileSync(new URL("../config/projections/anubis.yaml", import.meta.url), "utf8"),
    );
    const r = parseProjection((await listProjections(dir))[0]!.text);
    if (!r.ok) throw new Error(r.error);
    r.calibration.blend.exponent = 6;
    const text = await saveProjection(dir, "anubis", { calibration: r.calibration });
    expect(text).toContain("exponent: 6 # weight of a photo");
    expect((await listProjections(dir)).map((p) => p.name)).toEqual(["anubis"]);
    await expect(saveProjection(dir, "other", { calibration: r.calibration })).rejects.toThrow(/match/);
    await expect(saveProjection(dir, "../x", { calibration: r.calibration })).rejects.toThrow(/invalid/);
    expect(await listProjections(path.join(dir, "missing"))).toEqual([]);
  });
});
