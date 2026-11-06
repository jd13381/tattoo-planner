import { describe, expect, it } from "vitest";
import { resolveBody } from "../src/body/body.ts";
import { surfacePoint } from "../src/body/geometry.ts";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile, type RegionProfile } from "../src/body/profile.ts";
import { MAIN_LINES, REGION_IDS } from "../src/body/regions.ts";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";
import { wrapDelta } from "../src/layout/shapes.ts";
import { gridLines } from "../src/render/cmGrid.ts";

const profile = buildProfile(PLACEHOLDERS);

describe("cm grid", () => {
  const lines = gridLines(profile);

  it("draws a ring every cm from wrist to shoulder, bold every 5 cm", () => {
    const rings = lines.filter((l) => l.points.length === 2);
    expect(rings).toHaveLength(61);
    expect(rings.filter((l) => l.weight === "major")).toHaveLength(13);
  });

  it("keeps lengthwise lines on the skin", () => {
    for (const line of lines.filter((l) => l.points.length > 2 && l.weight !== "axis")) {
      for (const p of line.points)
        expect(Math.abs(p.x)).toBeLessThanOrEqual(profile.circumferenceAt(p.y) / 2 + 1e-9);
    }
  });

  it("marks the four centre lines, with the inner seam on both edges", () => {
    const axes = lines.filter((l) => l.weight === "axis").map((l) => l.label);
    expect(axes).toEqual(["outer", "lateral", "medial", "inner", "inner"]);
  });

  it("keeps the lines on the outer half of the arm where they were (cm from the outer line)", () => {
    const outer = lines.filter(
      (l) => l.points.length > 2 && l.weight !== "axis" && Math.abs(l.points[0]!.x) < 3,
    );
    expect(outer.length).toBe(4);
    for (const line of outer) for (const p of line.points) expect(p.x).toBe(line.points[0]!.x);
  });
});

function parseOk(text: string) {
  const r = parseMeasurements(text);
  if (!r.ok) throw new Error(r.error);
  return r.measurements;
}

/** Distance along the ring (cm) of (x, y) from the nearer of the region's two main lines. */
function fromMainLine(p: RegionProfile, centerU: number, x: number, y: number) {
  const c = p.circumferenceAt(y);
  const u = centerU + x / c;
  const [d0, d1] = MAIN_LINES[p.kind].map((a) => wrapDelta(u - a) * c);
  return Math.min(Math.abs(d0!), Math.abs(d1!));
}

describe("cm grid on every region (2026-11-06: skewed torso lines)", () => {
  const bodies = { male: resolveBody(null), female: resolveBody(parseOk("body: female\nunits: cm\n")) };

  for (const [name, body] of Object.entries(bodies)) {
    for (const id of REGION_IDS) {
      const p = body.regions[id].profile;
      for (const centerU of new Set([0, ...MAIN_LINES[p.kind]])) {
        it(`${name} ${id}, centred on u = ${centerU}: lengthwise lines keep their distance from a main line`, () => {
          const lengthwise = gridLines(p, 1, 5, centerU).filter(
            (l) => l.points.length > 2 && l.weight !== "axis",
          );
          expect(lengthwise.length).toBeGreaterThan(0);
          for (const line of lengthwise) {
            const dist = line.points.map(({ x, y }) => fromMainLine(p, centerU, x, y));
            expect(Math.max(...dist) - Math.min(...dist)).toBeLessThan(1e-6);
            for (const pt of line.points)
              expect(Math.abs(pt.x)).toBeLessThanOrEqual(p.circumferenceAt(pt.y) / 2 + 1e-9);
          }
        });
      }
    }
  }

  it("keeps a torso line 5 cm from the spine at 5 cm on the 3D cross-sections all the way up", () => {
    const p = bodies.male.regions.torso.profile;
    const line = gridLines(p).find(
      (l) =>
        l.points.length > 20 &&
        Math.abs(
          wrapDelta(l.points[0]!.x / p.circumferenceAt(l.points[0]!.y) - 0.75) *
            p.circumferenceAt(l.points[0]!.y) -
            5,
        ) < 1e-6,
    );
    expect(line).toBeDefined();
    let lowest = Infinity;
    let highest = -Infinity;
    for (const { x, y } of line!.points) {
      // Arc length along the 3D ring from the spine (u = 0.75) to the line's point.
      const du = wrapDelta(x / p.circumferenceAt(y) - 0.75);
      let len = 0;
      let prev = surfacePoint(p, 0.75, y).position;
      const n = 200;
      for (let i = 1; i <= n; i++) {
        const q = surfacePoint(p, 0.75 + (du * i) / n, y).position;
        len += Math.hypot(q[0] - prev[0], q[2] - prev[2]);
        prev = q;
      }
      lowest = Math.min(lowest, len);
      highest = Math.max(highest, len);
    }
    expect(lowest).toBeGreaterThan(4.98);
    expect(highest).toBeLessThan(5.02);
  });
});

describe("torso unwrap stays cm-true across changing cross-sections", () => {
  const p = resolveBody(null).regions.torso.profile;

  it("puts a fraction of the ring at the same length of the 3D perimeter on every row", () => {
    for (let s = 0; s <= p.length; s += p.length / 20) {
      const c = p.circumferenceAt(s);
      for (const u of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
        const a = surfacePoint(p, u, s).position;
        const b = surfacePoint(p, u + 0.005, s).position;
        expect(Math.hypot(b[0] - a[0], b[2] - a[2]) / (0.005 * c)).toBeCloseTo(1, 3);
      }
    }
  });

  it("keeps a constant-u line from wandering sideways between neighbouring rings", () => {
    // The front line (u = 0.25) and the spine (u = 0.75) sit on the symmetry plane x = 0 at every height.
    for (let s = 0; s <= p.length; s += 0.5) {
      expect(Math.abs(surfacePoint(p, 0.25, s).position[0])).toBeLessThan(1e-3);
      expect(Math.abs(surfacePoint(p, 0.75, s).position[0])).toBeLessThan(1e-3);
    }
  });
});
