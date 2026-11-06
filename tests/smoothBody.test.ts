// Smooth transitions between measuring stations and between the torso and its neutral neighbours
// (docs/adr/0022): station values unchanged, no overshoot, no step in slope at a station or a join.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBody, type ResolvedBody } from "../src/body/body.ts";
import { monotoneCubic, type Knot } from "../src/body/interpolate.ts";
import { applyPlacement } from "../src/body/placement.ts";
import type { Loft } from "../src/body/profile.ts";
import { REGION_IDS } from "../src/body/regions.ts";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";

const H = 1e-5;
const slopeLeft = (f: (x: number) => number, x: number) => (f(x) - f(x - H)) / H;
const slopeRight = (f: (x: number) => number, x: number) => (f(x + H) - f(x)) / H;
const curvLeft = (f: (x: number) => number, x: number, h = 1e-3) =>
  (f(x) - 2 * f(x - h) + f(x - 2 * h)) / h / h;
const curvRight = (f: (x: number) => number, x: number, h = 1e-3) =>
  (f(x) - 2 * f(x + h) + f(x + 2 * h)) / h / h;

/** A slope step smaller than this (per cm) is invisible: a few hundredths of a millimetre per cm. */
const C1_TOLERANCE = 1e-3;

function expectThroughKnotsWithoutOvershoot(f: (x: number) => number, knots: Knot[]) {
  for (const k of knots) expect(f(k.x)).toBeCloseTo(k.y, 9);
  for (let i = 0; i + 1 < knots.length; i++) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    const lo = Math.min(a.y, b.y) - 1e-9;
    const hi = Math.max(a.y, b.y) + 1e-9;
    for (let t = 0; t <= 1; t += 1 / 64) {
      const y = f(a.x + t * (b.x - a.x));
      expect(y).toBeGreaterThanOrEqual(lo);
      expect(y).toBeLessThanOrEqual(hi);
    }
  }
}

function expectC1(f: (x: number) => number, xs: number[]) {
  for (const x of xs) expect(Math.abs(slopeRight(f, x) - slopeLeft(f, x))).toBeLessThan(C1_TOLERANCE);
}

describe("monotone spline", () => {
  // A pseudo-random generator, so the cases are the same in every run.
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  it("keeps every knot, never overshoots and has no step in slope, on random data", () => {
    for (let run = 0; run < 50; run++) {
      const knots: Knot[] = [];
      let x = 0;
      for (let i = 0; i < 3 + Math.floor(random() * 6); i++) {
        knots.push({ x, y: 10 + 30 * random() });
        x += 1 + 15 * random();
      }
      const f = monotoneCubic(knots);
      expectThroughKnotsWithoutOvershoot(f, knots);
      expectC1(
        f,
        knots.slice(1, -1).map((k) => k.x),
      );
    }
  });

  it("is C2 at the knots of gently varying monotone data, where the filter has nothing to limit", () => {
    const knots = [0, 4, 9, 13, 20, 26].map((x) => ({ x, y: 20 + 0.02 * x * x }));
    const f = monotoneCubic(knots);
    for (const k of knots.slice(1, -1)) {
      expect(Math.abs(curvRight(f, k.x) - curvLeft(f, k.x))).toBeLessThan(0.01);
    }
  });

  it("is flat at a measured maximum and at a clamped end", () => {
    const f = monotoneCubic(
      [
        { x: 0, y: 25 },
        { x: 10, y: 29 },
        { x: 18, y: 27 },
        { x: 30, y: 33 },
      ],
      { endSlope: 0 },
    );
    expect(Math.abs(slopeRight(f, 10))).toBeLessThan(C1_TOLERANCE);
    expect(Math.abs(slopeLeft(f, 30))).toBeLessThan(C1_TOLERANCE);
  });
});

function parsed(text: string) {
  const r = parseMeasurements(text);
  if (!r.ok) throw new Error(r.error);
  return r.measurements;
}

const bodies: [string, ResolvedBody][] = [
  ["male sample", resolveBody(null)],
  ["female sample", resolveBody(parsed("body: female\nunits: cm\n"))],
  [
    "Jan's measured arm",
    resolveBody(
      parsed(readFileSync(path.join(import.meta.dirname, "..", "config", "measurements.yaml"), "utf8")),
    ),
  ],
];

describe.each(bodies)("every region of the %s", (_, body) => {
  it.each(REGION_IDS)("%s: stations kept, no overshoot, no step in slope", (id) => {
    const p = body.regions[id].profile;
    const knots = p.stations.map((st) => ({ x: st.s, y: st.circumference }));
    expectThroughKnotsWithoutOvershoot(p.circumferenceAt, knots);
    // Every station inside the region, including the last one before a stretch that stays constant
    // (the arm's shoulder tape, the leg's thigh top).
    const inner = p.stations.map((st) => st.s).filter((s) => s > H && s < p.length - H);
    expectC1(p.circumferenceAt, inner);
    expectC1(p.aspectAt, inner);
    for (const s of [0.25, 0.5, 0.75].map((f) => f * p.length)) expectC1(p.circumferenceAt, [s]);
    // The unwrap is as wide as the widest measured circumference.
    expect(p.maxCircumference).toBeCloseTo(Math.max(...knots.map((k) => k.y)), 6);
  });
});

/** Circumference and aspect of a loft just inside its start (s = 0) or end. */
function endOf(loft: Loft, end: "start" | "end") {
  const s = end === "start" ? 0 : loft.length;
  const step = end === "start" ? H : -H;
  const slope = (f: (s: number) => number) => (f(s + step) - f(s)) / step;
  return {
    c: loft.circumferenceAt(s),
    k: loft.aspectAt(s),
    dc: slope(loft.circumferenceAt),
    dk: slope(loft.aspectAt),
  };
}

describe.each(bodies)("the torso of the %s runs on into pelvis and neck", (_, body) => {
  const torso = body.regions.torso.profile;
  if (torso.kind !== "torso") throw new Error("not a torso");
  const pelvis = body.layout.lofts.find((l) => l.name === "pelvis")!;
  const neck = body.layout.lofts.find((l) => l.name === "neck")!;

  it("replaces the hip and neck ellipsoids by lofts", () => {
    expect(pelvis.shape).toBe(torso.pelvis);
    expect(neck.shape).toBe(torso.neck);
    expect(body.layout.parts.map((p) => p.name)).not.toContain("hips");
    expect(body.layout.parts.map((p) => p.name)).not.toContain("neck");
  });

  it("meets the torso at the waist and the neck base with the same section and slope", () => {
    for (const [a, b] of [
      [endOf(pelvis.shape, "end"), endOf(torso, "start")],
      [endOf(torso, "end"), endOf(neck.shape, "start")],
    ] as const) {
      expect(a.c).toBeCloseTo(b.c, 9);
      expect(a.k).toBeCloseTo(b.k, 9);
      expect(Math.abs(a.dc - b.dc)).toBeLessThan(C1_TOLERANCE);
      expect(Math.abs(a.dk - b.dk)).toBeLessThan(C1_TOLERANCE);
    }
  });

  it("places the pelvis below the waist line and the neck above the neck base", () => {
    const waist = applyPlacement(body.layout.placements.torso, [0, 0, 0]);
    const neckBase = applyPlacement(body.layout.placements.torso, [0, torso.length, 0]);
    expect(applyPlacement(pelvis.placement, [0, pelvis.shape.length, 0])).toEqual(waist);
    expect(applyPlacement(neck.placement, [0, 0, 0])).toEqual(neckBase);
    // The pelvis reaches below the hip crease, where the legs start, so no gap opens between them.
    const hip = applyPlacement(body.layout.placements["leg-left"], [
      0,
      body.regions["leg-left"].profile.length,
      0,
    ]);
    expect(applyPlacement(pelvis.placement, [0, 0, 0])[1]).toBeLessThan(hip[1]);
  });
});
