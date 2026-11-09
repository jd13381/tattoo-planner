// Projection v2 (docs/adr/0023-projection-cleanup.md): ink only on small pixel buffers, edited photos in
// place of the originals, the clean-up keys in the projection file, and the camera picture's sides.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { REGION_IDS } from "../src/body/regions.ts";
import { applyBuiltin, describeStep } from "../src/edits/builtin.ts";
import { makePixels } from "../src/render/builtinOps.ts";
import { inkCut, inkLayer, inkOnlyImage, skinEstimate } from "../src/render/inkOnly.ts";
import { editsOf, isEditOf, newEdit, shapeWarning } from "../src/projection/cleanup.ts";
import { buildPatch, sampleLum, type PhotoPixels } from "../src/projection/patch.ts";
import {
  cameraAngle,
  describeFacing,
  facingAtAngle,
  joinFacing,
  neighbours,
  sideChoices,
  snapFacing,
  splitFacing,
} from "../src/projection/sides.ts";
import { DEFAULT_CLEANUP, projectionSchema } from "../src/projection/schema.ts";
import { sourceAssetIds, sourceAssets } from "../src/projection/useProjections.ts";
import {
  fromCalibration,
  newDraft,
  sectionSketch,
  toCalibration,
  withPhotos,
} from "../src/projection/draft.ts";
import { parseProjection, updateProjectionText } from "../src/projection/yamlDoc.ts";
import type { AssetInfo } from "../src/assets/types.ts";

const body = resolveBody(null);
const arm = body.regions["arm-left"].profile;

/** w × h brightness 0..1: skin lit from the left (1 → 0.55 across), with ink lines at `inkCols`. */
function shadedSkin(w: number, h: number, inkCols: (x: number) => boolean, ink = 0.25): Float32Array {
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const light = 1 - 0.45 * (x / (w - 1));
      v[y * w + x] = light * (inkCols(x) ? ink : 1);
    }
  return v;
}

describe("ink only on a brightness buffer", () => {
  const w = 80;
  const h = 20;
  const lines = (x: number) => x % 20 === 10 || x % 20 === 11;
  const gray = shadedSkin(w, h, lines);

  it("estimates the skin under the shading and leaves the ink out of it", () => {
    const bg = skinEstimate(gray, w, h, 12);
    for (const x of [5, 30, 50, 75]) {
      const light = 1 - 0.45 * (x / (w - 1));
      expect(bg[10 * w + x]!).toBeCloseTo(light, 1);
    }
    // On an ink line the estimate is the skin around it, not the ink.
    expect(bg[10 * w + 50]!).toBeGreaterThan(0.6);
  });

  it("keeps the lines and drops the shadow, in light and in shade alike", () => {
    const { ink, tone } = inkLayer(gray, w, h, { radiusPx: 12, strength: 0.5 });
    for (const x of [10, 30, 50, 70]) expect(ink[10 * w + x]!).toBeGreaterThan(0.95);
    // Bare skin, even where it is 45 % darker than the lit side, is no ink.
    for (const x of [2, 40, 60, 78]) expect(ink[10 * w + x]!).toBeLessThan(0.05);
    // Strength 0.5 darkens the grey ink half way towards black.
    expect(tone[10 * w + 30]!).toBeLessThan(0.25);
  });

  it("drops faint marks with more strength and keeps them with less", () => {
    const faint = shadedSkin(w, h, lines, 0.8); // 20 % darker than the skin: a pore, a hair
    const weak = inkLayer(faint, w, h, { radiusPx: 12, strength: 0 });
    const strong = inkLayer(faint, w, h, { radiusPx: 12, strength: 1 });
    expect(weak.ink[10 * w + 30]!).toBeGreaterThan(0.5);
    expect(strong.ink[10 * w + 30]!).toBe(0);
    expect(inkCut(1).from).toBeGreaterThan(inkCut(0).from);
  });

  it("leaves unseen pixels unseen", () => {
    const g = gray.slice();
    g[0] = NaN;
    expect(Number.isNaN(inkLayer(g, w, h, { radiusPx: 12, strength: 0.5 }).ink[0]!)).toBe(true);
  });

  it("keeps colour ink with its colour, the skin's colour cast removed", () => {
    const n = w * h;
    const rgb = new Float32Array(3 * n);
    const lum = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = k % w;
      const red = lines(x);
      // Skin (0.9, 0.75, 0.65), red ink (0.8, 0.1, 0.1).
      const c = red ? [0.8, 0.1, 0.1] : [0.9, 0.75, 0.65];
      rgb.set(c, 3 * k);
      lum[k] = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    }
    const r = inkLayer(lum, w, h, { radiusPx: 12, strength: 0.5, keepColor: true }, rgb);
    const at = 10 * w + 30;
    expect(r.ink[at]!).toBeGreaterThan(0.95);
    expect(r.rgb![3 * at]!).toBeGreaterThan(0.8); // red stays
    expect(r.rgb![3 * at + 1]!).toBeLessThan(0.2);
    const skin = 10 * w + 40;
    expect(r.ink[skin]!).toBeLessThan(0.05);
    expect(r.rgb![3 * skin]!).toBeCloseTo(1, 1); // skin reads white, ready to multiply
  });
});

describe("Tattoo ink only (Image studio)", () => {
  function photo(w: number, h: number) {
    const img = makePixels(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const light = 1 - 0.4 * (y / (h - 1)); // shadow towards the bottom
        const ink = x >= 20 && x <= 24 && y >= 5 && y <= 35;
        const v = Math.round(255 * light * (ink ? 0.2 : 0.95));
        img.data.set([v, Math.round(v * 0.85), Math.round(v * 0.75), 255], (y * w + x) * 4);
      }
    return img;
  }

  it("keeps the ink opaque on a transparent background and keeps the size", () => {
    const img = photo(60, 40);
    const out = inkOnlyImage(img, { strength: 0.5, radiusShare: 0.25 });
    expect([out.width, out.height]).toEqual([60, 40]);
    const a = (x: number, y: number) => out.data[(y * 60 + x) * 4 + 3]!;
    expect(a(22, 20)).toBeGreaterThan(240);
    expect(a(22, 34)).toBeGreaterThan(240); // ink in the shadow
    expect(a(45, 5)).toBeLessThan(13);
    expect(a(45, 38)).toBeLessThan(13); // skin in the shadow
  });

  it("is offered by the built-in engine with two controls and a readable step name", () => {
    const out = applyBuiltin(photo(30, 20), "tattoo-ink", { strength: 50, color: 1 });
    expect(out.width).toBe(30);
    expect(describeStep("tattoo-ink", { strength: 70, color: 1 })).toBe(
      "Tattoo ink only (strength 70, keep colour)",
    );
  });

  it("leaves transparent pixels transparent", () => {
    const img = photo(30, 20);
    img.data[3] = 0;
    expect(inkOnlyImage(img, { strength: 0.5, radiusShare: 0.25 }).data[3]).toBe(0);
  });
});

/** A projection of one upright photo of the left forearm, as in projectionRegions.test.ts. */
function calibration(extra: Record<string, unknown> = {}, photoExtra: Record<string, unknown> = {}) {
  return projectionSchema.parse({
    name: "t",
    patch: { u: [0.3, 0.7], v: [0, 0.4], px_per_cm: 4 },
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
        ...photoExtra,
      },
    ],
  });
}

/** Skin with a shadow across the limb (dark on the left) and an ink bar in the middle at s = 8…12 cm. */
function shadedPhoto(): PhotoPixels {
  const width = 200;
  const height = 400;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (360 - y) / 8;
      const ink = s >= 8 && s <= 12 && x >= 92 && x <= 108;
      // A broad shadow (a shoulder blade, the side of the limb): 40 % darker over 8 cm.
      const shade = 1 - 0.4 * Math.max(0, Math.min(1, (130 - x) / 64));
      const v = Math.round(225 * shade * (ink ? 0.15 : 1));
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { width, height, data };
}

describe("patches with ink only", () => {
  it("without the clean-up key renders as before (the photo's shading stays)", () => {
    const before = buildPatch(calibration(), arm, [shadedPhoto()])!;
    expect(before.rgb).toBeUndefined();
    // Somewhere the shadow is left in the grey.
    expect(Math.min(...before.gray.filter((_, k) => before.alpha[k]! > 200))).toBeLessThan(200);
  });

  it("with it, only the ink is opaque: skin and shadow vanish, the ink stays", () => {
    const cal = calibration({ cleanup: { flatten_cm: 4, strength: 0.5 } });
    const p = buildPatch(cal, arm, [shadedPhoto()])!;
    let inkPx = 0;
    let skinOpaque = 0;
    for (let k = 0; k < p.width * p.height; k++) {
      if (p.alpha[k]! > 128 && p.gray[k]! < 80) inkPx++;
      else if (p.alpha[k]! > 40) skinOpaque++;
    }
    expect(inkPx).toBeGreaterThan(20);
    expect(skinOpaque).toBeLessThan(inkPx / 2);
    expect(p.footprint.some((f) => f === 1)).toBe(true);
  });

  it("keeps colour when asked", () => {
    const cal = calibration({ cleanup: { keep_color: true } });
    const p = buildPatch(cal, arm, [shadedPhoto()])!;
    expect(p.rgb?.length).toBe(3 * p.width * p.height);
  });

  it("reads an edited photo's transparent parts as bare skin, stretched onto the photo's frame", () => {
    const edit = makePixels(4, 4);
    edit.data.set([0, 0, 0, 255], 0); // one black pixel, the rest transparent
    const img: PhotoPixels = { ...edit, cleaned: { frame: { width: 200, height: 400 } } };
    expect(sampleLum(img, 3, 3)).toBeCloseTo(255, 6);
    expect(sampleLum({ ...edit }, 3, 3)).toBeNaN();
    const cal = calibration({}, { cleaned: "edits/a-edit-1.png" });
    // A plain white edit: nothing to project, every seen pixel white.
    const white = makePixels(100, 200);
    white.data.fill(255);
    const p = buildPatch(cal, arm, [{ ...white, cleaned: { frame: { width: 200, height: 400 } } }])!;
    expect(Math.min(...p.gray)).toBeGreaterThan(250);
  });
});

describe("projection files", () => {
  const anubis = readFileSync(new URL("../config/projections/anubis.yaml", import.meta.url), "utf8");

  it("reads files without the new keys as before", () => {
    const r = parseProjection(anubis);
    if (!r.ok) throw new Error(r.error);
    expect(r.calibration.cleanup).toBeUndefined();
    expect(r.calibration.photos.every((p) => p.cleaned === undefined)).toBe(true);
    // Opening it in the workspace keeps the clean-up off, so saving changes nothing.
    expect(fromCalibration(r.calibration).cleanup).toBeNull();
  });

  it("writes the clean-up block and an edited photo into the file, the rest untouched", () => {
    const r = parseProjection(anubis);
    if (!r.ok) throw new Error(r.error);
    const cal = structuredClone(r.calibration);
    cal.cleanup = { ...DEFAULT_CLEANUP };
    cal.photos[0]!.cleaned = "edits/anubis-front-edit-1.png";
    const text = updateProjectionText(anubis, cal);
    expect(text).toMatch(/\ncleanup:\n {2}flatten_cm: 4\n {2}strength: 0.5\n {2}keep_color: false\n/);
    expect(text).toContain("cleaned: edits/anubis-front-edit-1.png");
    // Comments of the hand-written file survive.
    const comments = (t: string) => t.split("\n").filter((l) => l.trim().startsWith("#")).length;
    expect(comments(text)).toBe(comments(anubis));
    const back = parseProjection(text);
    expect(back.ok && back.calibration).toEqual(cal);
    // And off again.
    const off = updateProjectionText(text, r.calibration);
    expect(off).not.toContain("cleanup");
    expect(off).not.toContain("cleaned");
  });

  it("starts a new tattoo with ink only on, and keeps an edited photo in the draft", () => {
    const d = withPhotos({ ...newDraft("arm-left"), name: "rose" }, [
      { file: "photos/a.jpg", cleaned: null },
    ]);
    d.photos[0]!.cleaned = "edits/a-edit-1.png";
    const r = toCalibration(d, arm);
    if (!r.ok) throw new Error(r.error);
    expect(r.calibration.cleanup).toEqual(DEFAULT_CLEANUP);
    expect(r.calibration.photos[0]!.cleaned).toBe("edits/a-edit-1.png");
    const again = fromCalibration(r.calibration);
    expect(again.photos[0]!.cleaned).toBe("edits/a-edit-1.png");
    expect(again.cleanup).toEqual(DEFAULT_CLEANUP);
  });
});

describe("edited versions of a photo", () => {
  const asset = (id: string, extra: Partial<AssetInfo> = {}) =>
    ({ id, file: `x/${id}.png`, kind: "existing", tags: [], exists: true, ...extra }) as AssetInfo;
  const photo = asset("back");
  const assets = [
    photo,
    asset("back-edit-1", { derived_from: "back" }),
    asset("other"),
    asset("back-edit-2", { derived_from: "back" }),
  ];

  it("lists the photo's edits newest first and finds the one saved since", () => {
    expect(editsOf(photo, assets).map((a) => a.id)).toEqual(["back-edit-2", "back-edit-1"]);
    // From an edit, its siblings: every edit of the same original.
    expect(editsOf(assets[1]!, assets).map((a) => a.id)).toEqual(["back-edit-2"]);
    expect(newEdit(["back-edit-1"], editsOf(photo, assets))?.id).toBe("back-edit-2");
    expect(newEdit(["back-edit-1", "back-edit-2"], editsOf(photo, assets))).toBeNull();
    expect(isEditOf("X/BACK-EDIT-1.png", editsOf(photo, assets))).toBe(true);
  });

  it("warns when an edit has another shape than the photo", () => {
    expect(shapeWarning({ width: 3000, height: 4000 }, { width: 1500, height: 2000 })).toBeNull();
    expect(shapeWarning({ width: 3000, height: 4000 }, { width: 1024, height: 1536 })).toMatch(
      /another shape/,
    );
  });

  it("loads both the photo and its edit for the patch", () => {
    const cal = calibration({}, { cleaned: "x/back-edit-2.png", file: "x/back.png" });
    const map = new Map(assets.map((a) => [a.id, a]));
    expect(sourceAssets(cal, map)[0]!.cleaned?.id).toBe("back-edit-2");
    expect(sourceAssetIds(cal, map)).toEqual(["back", "back-edit-2"]);
  });
});

describe("where was the camera", () => {
  it("names the sides in plain words", () => {
    expect(sideChoices("arm-left").map((s) => s.label)).toEqual([
      "Outer side",
      "Thumb side",
      "Inner side",
      "Little-finger side",
    ]);
    expect(sideChoices("torso").map((s) => s.label)).toEqual(["Right side", "Front", "Left side", "Back"]);
    expect(sideChoices("leg-right")[0]!.label).toBe("Front");
  });

  it("places every side on the picture as the model sees it", () => {
    // The camera at angle A looks at the part; the photo's right is the picture direction
    // (-d.y, d.x) for the view direction d. Each other side must lie on that side of the photo.
    for (const region of REGION_IDS) {
      const sides = sideChoices(region);
      for (const cam of sides) {
        const a = (cam.angle * Math.PI) / 180;
        const d = { x: -Math.cos(a), y: -Math.sin(a) };
        const right = { x: -d.y, y: d.x };
        const sketch = sectionSketch(region, cam.u);
        for (const other of sides) {
          const b = (other.angle * Math.PI) / 180;
          const expected = Math.cos(b) * right.x + Math.sin(b) * right.y;
          const line = sketch.lines.find((l) => Math.abs(l.u - other.u) < 1e-9)!;
          if (Math.abs(expected) < 0.5) expect(Math.abs(line.p.x)).toBeLessThan(0.05);
          else expect(Math.sign(line.p.x)).toBe(Math.sign(expected));
        }
      }
    }
  });

  it("turns a camera position into a facing and back", () => {
    for (const region of REGION_IDS)
      for (const u of [0, 0.1, 0.25, 0.4, 0.5, 0.8]) {
        expect(facingAtAngle(region, cameraAngle(region, u))).toBeCloseTo(u, 3);
      }
    // Front of the torso: the camera below the person on the picture.
    expect(cameraAngle("torso", 0.25)).toBe(90);
    expect(snapFacing("torso", 94)).toBe(0.25);
    expect(snapFacing("torso", 110)).not.toBe(0.25);
  });

  it("splits a facing into a side and a small turn", () => {
    expect(splitFacing(0.53)).toEqual({ main: 0.5, offset: 0.03 });
    expect(splitFacing(0.98)).toEqual({ main: 0, offset: -0.02 });
    expect(joinFacing(0, -0.02)).toBe(0.98);
    expect(describeFacing("arm-left", 0.53)).toMatchObject({ turnDeg: 11 });
    expect(describeFacing("arm-left", 0.53).side.label).toBe("Inner side");
    expect(neighbours("arm-left", 0.5).map((s) => s.label)).toEqual(["Thumb side", "Little-finger side"]);
  });
});
