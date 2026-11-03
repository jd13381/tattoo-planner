import { describe, expect, it } from "vitest";
import {
  bandRepeatPx,
  inkMeasure,
  mulberry32,
  type PatternParams,
  type Shape,
} from "../src/render/patterns/geometry.ts";
import {
  fallbackPainter,
  getPattern,
  isKnownPattern,
  PATTERNS,
  patternShapes,
  seedFromId,
} from "../src/render/patterns/index.ts";

const PX = 20;
const FILLERS = ["snake-scales", "hatching", "starfield"];
const BANDS = ["meander", "lotus", "lotus-frieze"];

const filler = (density: number, seed = 42): PatternParams => ({
  x: 13,
  y: 7,
  w: 14 * PX,
  h: 10 * PX,
  pxPerCm: PX,
  density,
  seed,
});

const band = (ringCm?: number, h = 2): PatternParams => ({
  x: 5,
  y: 11,
  w: (ringCm ?? 23.3) * PX,
  h: h * PX,
  pxPerCm: PX,
  density: 1,
  seed: 7,
  ringCm,
});

/** Minimal recording stand-in for CanvasRenderingContext2D: path points, styles and calls. */
function recordingContext() {
  const calls: string[] = [];
  const points: { x: number; y: number; pad: number }[] = [];
  const styles = new Set<string>();
  const state = { lineWidth: 1, globalAlpha: 1 };
  let pending: { x: number; y: number; r: number }[] = [];
  const ctx = {
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
    },
    set strokeStyle(v: string) {
      styles.add(v);
    },
    set fillStyle(v: string) {
      styles.add(v);
    },
    lineCap: "butt",
    lineJoin: "miter",
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => {
      calls.push("beginPath");
      pending = [];
    },
    closePath: () => calls.push("closePath"),
    moveTo: (x: number, y: number) => pending.push({ x, y, r: 0 }),
    lineTo: (x: number, y: number) => pending.push({ x, y, r: 0 }),
    arc: (x: number, y: number, r: number) => pending.push({ x, y, r }),
    stroke: () => {
      calls.push("stroke");
      for (const q of pending) points.push({ x: q.x, y: q.y, pad: state.lineWidth / 2 + q.r });
    },
    fill: () => {
      calls.push("fill");
      for (const q of pending) points.push({ x: q.x, y: q.y, pad: q.r });
    },
    fillRect: () => calls.push("fillRect"),
    clearRect: () => calls.push("clearRect"),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, points, styles };
}

/** Where strokes cross a vertical line x, as sorted y values. */
function crossingsAt(shapes: Shape[], x: number): number[] {
  const ys: number[] = [];
  for (const s of shapes) {
    if (s.kind !== "stroke") continue;
    for (const q of s.points) if (Math.abs(q.x - x) < 1e-6) ys.push(Math.round(q.y * 1000) / 1000);
  }
  return [...new Set(ys)].sort((a, b) => a - b);
}

describe("seeding", () => {
  it("hashes ids stably", () => {
    expect(seedFromId("scales-forearm")).toBe(seedFromId("scales-forearm"));
    expect(seedFromId("scales-forearm")).not.toBe(seedFromId("scales-upper"));
    expect(seedFromId("")).toBe(0x811c9dc5);
  });

  it("mulberry32 repeats for a seed and stays in [0, 1)", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("pattern geometry", () => {
  it.each([...FILLERS, ...BANDS])("%s is deterministic for a seed", (name) => {
    const p = BANDS.includes(name) ? band(24) : filler(0.6);
    expect(patternShapes(name, p)).toEqual(patternShapes(name, p));
    expect(patternShapes(name, p).length).toBeGreaterThan(0);
  });

  it.each(["snake-scales", "starfield"])("%s changes with the seed", (name) => {
    expect(patternShapes(name, filler(0.6, 1))).not.toEqual(patternShapes(name, filler(0.6, 2)));
  });

  it.each(FILLERS)("%s gets more ink as density rises, none at 0", (name) => {
    expect(patternShapes(name, filler(0))).toHaveLength(0);
    let prev = { strokeLength: 0, marks: 0 };
    for (const d of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) {
      const m = inkMeasure(patternShapes(name, filler(d)));
      expect(m.marks).toBeGreaterThanOrEqual(prev.marks);
      expect(m.strokeLength).toBeGreaterThanOrEqual(prev.strokeLength);
      prev = m;
    }
    const low = inkMeasure(patternShapes(name, filler(0.2)));
    const high = inkMeasure(patternShapes(name, filler(0.9)));
    expect(high.marks + high.strokeLength).toBeGreaterThan(1.5 * (low.marks + low.strokeLength));
  });

  it("keeps snake scales open at low density", () => {
    // At density 0.25 at most about a quarter of the scales are inked.
    const all = patternShapes("snake-scales", filler(1)).length;
    const few = patternShapes("snake-scales", filler(0.25)).length;
    expect(few).toBeLessThan(all * 0.3);
  });
});

describe("band repeat", () => {
  it("fits a whole number of repeats into the ring", () => {
    for (const ring of [16.9, 20, 23.3, 27.85, 38.4]) {
      for (const target of [0.8, 1.7, 2.5]) {
        const r = bandRepeatPx(target, PX, ring);
        const n = (ring * PX) / r;
        expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
        // The repeat stays close to the target (within half a module).
        expect(Math.abs(r / PX - target)).toBeLessThanOrEqual(target / 2 + 1e-9);
      }
    }
    expect(bandRepeatPx(2, PX)).toBe(2 * PX);
    expect(bandRepeatPx(30, PX, 20)).toBe(20 * PX);
  });

  it.each(BANDS)("%s meets itself at the seam when ringCm is given", (name) => {
    for (const ring of [17.3, 24, 31.7]) {
      const p = band(ring);
      const shapes = patternShapes(name, p);
      const left = crossingsAt(shapes, p.x);
      const right = crossingsAt(shapes, p.x + p.w);
      expect(left.length).toBeGreaterThan(0);
      expect(right).toEqual(left);
    }
  });
});

describe("painters", () => {
  const cases: [string, PatternParams][] = [
    ...FILLERS.map((n): [string, PatternParams] => [n, filler(0.8)]),
    ...BANDS.map((n): [string, PatternParams] => [n, band(22.5)]),
    ...BANDS.map((n): [string, PatternParams] => [n, band(undefined, 1)]),
    ["no-such-pattern", filler(0.5)],
  ];

  it.each(cases)("%s draws only inside its rectangle, in ink, without a background", (name, p) => {
    const rec = recordingContext();
    getPattern(name)({ ...p, ctx: rec.ctx, ink: "#123456" });
    expect(rec.points.length).toBeGreaterThan(0);
    for (const q of rec.points) {
      expect(q.x).toBeGreaterThanOrEqual(p.x - q.pad - 1e-6);
      expect(q.x).toBeLessThanOrEqual(p.x + p.w + q.pad + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(p.y - q.pad - 1e-6);
      expect(q.y).toBeLessThanOrEqual(p.y + p.h + q.pad + 1e-6);
      // Stroke overhang stays tiny: under a millimetre of skin.
      expect(q.pad).toBeLessThan(0.1 * PX);
    }
    expect([...rec.styles]).toEqual(["#123456"]);
    expect(rec.calls).not.toContain("fillRect");
    expect(rec.calls).not.toContain("clearRect");
    expect(rec.calls.filter((c) => c === "save")).toHaveLength(
      rec.calls.filter((c) => c === "restore").length,
    );
  });
});

describe("registry", () => {
  it("lists the patterns from the brief", () => {
    expect(Object.keys(PATTERNS).sort()).toEqual(
      ["hatching", "lotus", "lotus-frieze", "meander", "snake-scales", "starfield"].sort(),
    );
    for (const name of Object.keys(PATTERNS)) expect(isKnownPattern(name)).toBe(true);
  });

  it("falls back for unknown names, including object built-ins", () => {
    for (const name of ["smoke", "", "toString", "__proto__", "constructor"]) {
      expect(isKnownPattern(name)).toBe(false);
      expect(getPattern(name)).toBe(fallbackPainter);
    }
    expect(getPattern("meander")).toBe(PATTERNS.meander);
  });
});
