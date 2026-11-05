// The photo projection on every body region (docs/adr/0014-guided-projection.md): the forward model
// must agree with the region's own mesh geometry, and a patch must land where the photo shows the ink.
import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { semiAxes } from "../src/body/ellipse.ts";
import { surfacePoint } from "../src/body/geometry.ts";
import { REGION_IDS, REGIONS } from "../src/body/regions.ts";
import { photoFrame, projectPoint, sectionView, twistReach } from "../src/projection/model.ts";
import { buildPatch, patchCovers, type PhotoPixels } from "../src/projection/patch.ts";
import { projectionRegion, projectionSchema } from "../src/projection/schema.ts";

const body = resolveBody(null);

describe("sectionView on every region", () => {
  for (const id of REGION_IDS) {
    const profile = body.regions[id].profile;
    it(`${id}: agrees with the mesh's surface points and normals`, () => {
      const s = profile.length * 0.3;
      const c = profile.circumferenceAt(s);
      const k = profile.aspectAt(s);
      const { a } = semiAxes(c, k);
      for (const uView of [0, 0.125, 0.25, 0.4, 0.5, 0.75, 0.9]) {
        const view = sectionView(c, k, uView, profile);
        const n = surfacePoint(profile, uView, s).normal;
        // Image right = Y × N = (N.z, 0, −N.x).
        const right = [n[2], 0, -n[0]] as const;
        let half = 0;
        for (let u = 0; u < 1; u += 0.002) {
          const p = surfacePoint(profile, u, s).position;
          half = Math.max(half, Math.abs(p[0] * right[0] + p[2] * right[2]));
        }
        expect(half).toBeLessThanOrEqual(a + 1e-6);
        for (const u of [0.05, 0.3, 0.45, 0.6, 0.8]) {
          const sp = surfacePoint(profile, u, s);
          const t = (sp.position[0] * right[0] + sp.position[2] * right[2]) / half;
          const cos = sp.normal[0] * n[0] + sp.normal[2] * n[2];
          expect(view.at(u).t).toBeCloseTo(t, 2);
          expect(view.at(u).cos).toBeCloseTo(cos, 2);
        }
      }
    });
  }

  it("shows u growing to the right on mirrored regions, to the left on the others", () => {
    for (const id of REGION_IDS) {
      const profile = body.regions[id].profile;
      const s = profile.length / 2;
      const view = sectionView(profile.circumferenceAt(s), profile.aspectAt(s), 0.5, profile);
      // Seen from the seam side (u = 0.5): u = 0.75 lies right on mirrored regions.
      expect(Math.sign(view.at(0.75).t)).toBe(REGIONS[id].mirrored ? 1 : -1);
    }
  });

  it("puts the torso's front centre (u = 0.25) facing a camera in front and its left flank on the right", () => {
    const torso = body.regions.torso.profile;
    const s = torso.chestAt;
    const view = sectionView(torso.circumferenceAt(s), torso.aspectAt(s), 0.25, torso);
    expect(surfacePoint(torso, 0.25, s).normal[2]).toBeCloseTo(1, 6); // +Z = front
    expect(view.at(0.5).t).toBeCloseTo(1, 2); // left flank: image right (the person's left)
    expect(view.at(0).t).toBeCloseTo(-1, 2);
  });

  it("twists up to the elbow on arms, the knee on legs and the neck on the torso", () => {
    const arm = body.regions["arm-left"].profile;
    const leg = body.regions["leg-right"].profile;
    const torso = body.regions.torso.profile;
    expect(twistReach(arm)).toBe(arm.kind === "arm" ? arm.elbowAt : NaN);
    expect(twistReach(leg)).toBe(leg.kind === "leg" ? leg.kneeAt : NaN);
    expect(twistReach(torso)).toBe(torso.length);
  });
});

/** A photo of an upright limb: edges at x = 0.3 and 0.7, start at y = 0.9, 30 cm = 0.6 of the height. */
function calibration(region: string, uView: number, u: [number, number]) {
  return projectionSchema.parse({
    name: "t",
    region,
    patch: { u, v: [0, 0.3], px_per_cm: 4 },
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
        u_view: { wrist: uView, elbow: uView },
      },
    ],
  });
}

/** White skin with a dark square right of the middle (x 110…130 of 200) at s = 8…12 cm. */
function photoWithInkRightOfCentre(): PhotoPixels {
  const width = 200;
  const height = 400;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = (360 - y) / 8;
      const ink = s >= 8 && s <= 12 && x >= 110 && x <= 130;
      const v = ink ? 30 : 220;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { width, height, data };
}

describe("patches on other regions", () => {
  it("a leg photo from the front puts ink right of centre on the medial side of the right leg", () => {
    const leg = body.regions["leg-right"].profile;
    // Right leg: u = 0 front, 0.25 lateral (the body's right, image left), 0.75 medial (image right).
    const cal = calibration("leg-right", 0, [-0.3, 0.3]);
    const patch = buildPatch(cal, leg, [photoWithInkRightOfCentre()])!;
    const L = leg.length;
    expect(patchCovers(patch, 0.94, 10 / L)).toBe(true);
    expect(patchCovers(patch, 0.06, 10 / L)).toBe(false);
  });

  it("a torso photo from the front puts ink right of centre towards the left flank", () => {
    const torso = body.regions.torso.profile;
    const cal = calibration("torso", 0.25, [0, 0.5]);
    const patch = buildPatch(cal, torso, [photoWithInkRightOfCentre()])!;
    const L = torso.length;
    // Seen from the front, the person's left (u > 0.25) is on the image's right.
    let right = 0;
    let left = 0;
    for (let du = 0.01; du < 0.12; du += 0.01) {
      if (patchCovers(patch, 0.25 + du, 10 / L)) right++;
      if (patchCovers(patch, 0.25 - du, 10 / L)) left++;
    }
    expect(right).toBeGreaterThan(2);
    expect(left).toBe(0);
  });

  it("projects the start line to the photo's mark on every region", () => {
    for (const id of REGION_IDS) {
      const profile = body.regions[id].profile;
      const cal = calibration(id, 0.5, [0.3, 0.7]);
      const frame = photoFrame(cal.photos[0]!, 1000, 2000, twistReach(profile))!;
      const p = projectPoint(frame, profile, 0.5, 0)!;
      expect(p.x).toBeCloseTo(500, 6);
      expect(p.y).toBeCloseTo(1800, 6);
    }
  });

  it("reads a missing region as the left arm", () => {
    expect(projectionRegion({})).toBe("arm-left");
    expect(projectionRegion({ region: "torso" })).toBe("torso");
  });
});
