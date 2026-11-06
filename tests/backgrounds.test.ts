// Background layers (docs/adr/0019): schema, filler migration, YAML, area geometry, coverage, tiles,
// seams and compositing on small pixel buffers.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import { areaHits, layerCovers, resolveArea, resolveLayer } from "../src/layout/areas.ts";
import { fillerToLayer, migrateFillers } from "../src/layout/migrate.ts";
import type { BackgroundLayer, Layout } from "../src/layout/schema.ts";
import { BACKGROUND, classify } from "../src/layout/shapes.ts";
import { parseLayout, updateLayoutText } from "../src/layout/yamlDoc.ts";
import { coverage } from "../src/metrics/coverage.ts";
import { blockoutPixels, BLOCKOUT_COLORS } from "../src/render/blockout.ts";
import { parseCatalogue, standardBackgrounds, TILE_PATTERNS } from "../src/render/backgrounds/catalogue.ts";
import {
  compositeLayer,
  dilateAlpha,
  layerAlpha,
  patternS,
  pixelU,
  tileSampler,
  unwrapRows,
} from "../src/render/backgrounds/composite.ts";
import { periodicNoise, PROCEDURAL_NAMES, proceduralTile } from "../src/render/backgrounds/procedural.ts";
import { makeSeamless, seamCrossfade, seamRatio } from "../src/render/backgrounds/seam.ts";
import { emptyTile, paperToInk, parseHex, sampleTile, type Tile } from "../src/render/backgrounds/tile.ts";

const root = path.join(import.meta.dirname, "..");
const baselineText = readFileSync(path.join(root, "config", "layouts", "v1-baseline.yaml"), "utf8");
const profile = buildProfile(PLACEHOLDERS);

const layer = (over: Partial<BackgroundLayer> = {}): BackgroundLayer => ({
  id: "bg",
  source: { pattern: "clouds" },
  ...over,
});

describe("background layer schema", () => {
  const base = "name: t\nelements: []\n";
  const parse = (backgrounds: unknown, elements: unknown[] = []) =>
    parseLayout(updateLayoutText(base, { name: "t", backgrounds, elements } as Layout));

  it("accepts the three sources, both cover modes and every shape", () => {
    const r = parse([
      layer({ id: "a", source: { pattern: "stars", density: 0.4, scale: 1.5, ink: "#333333" } }),
      layer({ id: "b", source: { standard: "clouds", tile_cm: 12, rotation_deg: 15 }, blend: "normal" }),
      layer({
        id: "c",
        source: { image: "my-bg", tile_cm: 9, offset_cm: { x: 1, y: 2 } },
        cover: "area",
        shapes: [
          { kind: "rect", u: 0.1, v: 0.3, w_cm: 5, h_cm: 4, rotation_deg: 10 },
          { kind: "ellipse", u: 0.5, v: 0.5, w_cm: 6, h_cm: 3 },
          {
            kind: "polygon",
            points: [
              { u: 0.4, v: 0.1 },
              { u: 0.6, v: 0.1 },
              { u: 0.5, v: 0.2 },
            ],
          },
          { kind: "span", u: [0.9, 0.1], v: [0.6, 0.8] },
        ],
        mask: [
          { radius_cm: 1, points: [{ u: 0.2, v: 0.5 }] },
          { erase: true, radius_cm: 0.5, points: [{ u: 0.2, v: 0.5 }] },
        ],
        feather_cm: 1,
        gap_cm: 0.3,
        opacity: 0.6,
      }),
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects ids shared with elements, unknown keys and upside-down spans", () => {
    const fig = { id: "a", type: "figure", position: { u: 0, v: 0.5 }, size_cm: { h: 5 } };
    expect(parse([layer({ id: "a" })], [fig])).toMatchObject({ ok: false });
    expect(parse([{ ...layer(), colour: "red" }])).toMatchObject({ ok: false });
    expect(
      parse([layer({ cover: "area", shapes: [{ kind: "span", u: [0, 0.2], v: [0.5, 0.4] }] })]),
    ).toMatchObject({ ok: false });
    expect(parse([layer({ source: { image: "x" } as never })])).toMatchObject({ ok: false }); // tile_cm missing
  });
});

describe("filler migration", () => {
  it("reads v1-baseline's filler as an area layer and drops it from the elements", () => {
    const r = parseLayout(baselineText);
    if (!r.ok) throw new Error(r.error);
    expect(r.converted).toEqual(["scales-forearm"]);
    expect(r.layout.elements.some((e) => e.id === "scales-forearm")).toBe(false);
    expect(r.layout.backgrounds).toEqual([
      {
        id: "scales-forearm",
        source: { pattern: "snake-scales", density: 0.3 },
        cover: "area",
        shapes: [{ kind: "span", u: [0.25, 0.35], v: [0.05, 0.45] }],
      },
    ]);
  });

  it("keeps locks and notes, and appends fillers above the file's own layers", () => {
    const raw = {
      name: "t",
      backgrounds: [layer({ id: "sky" })],
      elements: [
        {
          id: "f",
          type: "filler",
          pattern: "starfield",
          region: { u: [0, 1], v: [0, 0.5] },
          locked: true,
          notes: "n",
        },
        { id: "b", type: "band", pattern: "meander", v: 0.1, width_cm: 1 },
      ],
    };
    const m = migrateFillers(raw);
    const v = m.value as Layout;
    expect(v.backgrounds!.map((b) => b.id)).toEqual(["sky", "f"]);
    expect(v.backgrounds![1]).toMatchObject({ locked: true, notes: "n", source: { pattern: "starfield" } });
    expect(v.elements.map((e) => e.id)).toEqual(["b"]);
    expect(migrateFillers({ name: "x", elements: [] }).converted).toEqual([]);
    expect(migrateFillers("garbage").value).toBe("garbage");
    expect(
      fillerToLayer({
        id: "q",
        type: "filler",
        pattern: "hatching",
        region: { u: [0.1, 0.2], v: [0.3, 0.4] },
      }),
    ).toEqual({
      id: "q",
      source: { pattern: "hatching" },
      cover: "area",
      shapes: [{ kind: "span", u: [0.1, 0.2], v: [0.3, 0.4] }],
    });
  });

  it("writes the new form only on save: backgrounds before elements, filler gone, comments kept", () => {
    const r = parseLayout(baselineText);
    if (!r.ok) throw new Error(r.error);
    const out = updateLayoutText(baselineText, r.layout);
    expect(out).not.toContain("type: filler");
    expect(out.indexOf("backgrounds:")).toBeLessThan(out.indexOf("elements:"));
    expect(out).toContain("source: { pattern: snake-scales, density: 0.3 }");
    expect(out).toContain("- { kind: span, u: [ 0.25, 0.35 ], v: [ 0.05, 0.45 ] }");
    expect(out).toContain("# Added at Jan's request");
    const again = parseLayout(out);
    expect(again).toEqual({ ok: true, layout: r.layout });
    // Saving the new form again changes nothing.
    expect(updateLayoutText(out, r.layout)).toBe(out);
  });

  it("writes new layers in a stable key order with flow-style shapes and strokes", () => {
    const l: Layout = {
      name: "t",
      elements: [],
      backgrounds: [
        {
          gap_cm: 0.3,
          shapes: [{ kind: "rect", u: 0.5, v: 0.5, w_cm: 4, h_cm: 3 }],
          cover: "area",
          mask: [
            {
              radius_cm: 1,
              points: [
                { u: 0.1, v: 0.2 },
                { u: 0.12, v: 0.25 },
              ],
            },
          ],
          source: { pattern: "stars" },
          id: "sky",
        },
      ],
    };
    const out = updateLayoutText("name: t\nelements: []\n", l);
    const keys = [...out.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["source", "cover", "shapes", "mask", "gap_cm"]);
    expect(out).toContain("  - id: sky");
    expect(out).toContain("- { kind: rect, u: 0.5, v: 0.5, w_cm: 4, h_cm: 3 }");
    expect(out).toContain("points: [ { u: 0.1, v: 0.2 }, { u: 0.12, v: 0.25 } ]");
    // Removing every layer removes the key.
    expect(updateLayoutText(out, { ...l, backgrounds: [] })).not.toContain("backgrounds");
  });
});

describe("area geometry", () => {
  const y = 30;
  const c = profile.circumferenceAt(y);

  it("tests rects and ellipses in cm on the skin", () => {
    const rect = resolveArea({ kind: "rect", u: 0, v: y / profile.length, w_cm: 6, h_cm: 4 }, profile);
    expect(areaHits(rect, 2.9 / c, y + 1.9, c)).toBe(true);
    expect(areaHits(rect, 3.1 / c, y, c)).toBe(false);
    const ell = resolveArea({ kind: "ellipse", u: 0, v: y / profile.length, w_cm: 6, h_cm: 4 }, profile);
    expect(areaHits(ell, 2.9 / c, y, c)).toBe(true);
    expect(areaHits(ell, 2.9 / c, y + 1.9, c)).toBe(false); // the corner is outside the ellipse
  });

  it("closes polygons and spans across the seam", () => {
    const poly = resolveArea(
      {
        kind: "polygon",
        points: [
          { u: 0.45, v: 0.3 },
          { u: 0.55, v: 0.3 },
          { u: 0.55, v: 0.5 },
          { u: 0.45, v: 0.5 },
        ],
      },
      profile,
    );
    const L = profile.length;
    expect(areaHits(poly, 0.5, 0.4 * L, c)).toBe(true);
    expect(areaHits(poly, 0.0, 0.4 * L, c)).toBe(false);
    // Over the u = 0 / 1 wrap.
    const wrap = resolveArea(
      {
        kind: "polygon",
        points: [
          { u: 0.95, v: 0.3 },
          { u: 0.05, v: 0.3 },
          { u: 0.05, v: 0.5 },
          { u: 0.95, v: 0.5 },
        ],
      },
      profile,
    );
    expect(areaHits(wrap, 0.0, 0.4 * L, c)).toBe(true);
    expect(areaHits(wrap, 0.5, 0.4 * L, c)).toBe(false);
    const ring = resolveArea({ kind: "span", u: [0, 1], v: [0.3, 0.5] }, profile);
    expect(areaHits(ring, 0.37, 0.4 * L, c)).toBe(true);
  });

  it("applies brush strokes in order: paint adds, erase removes", () => {
    const v = y / profile.length;
    const r = resolveLayer(
      layer({
        cover: "area",
        shapes: [{ kind: "rect", u: 0, v, w_cm: 4, h_cm: 4 }],
        mask: [
          { erase: true, radius_cm: 1, points: [{ u: 0, v }] },
          { radius_cm: 0.5, points: [{ u: 0, v }] },
          {
            radius_cm: 1,
            points: [
              { u: 0.25, v },
              { u: 0.3, v },
            ],
          },
        ],
      }),
      profile,
    );
    expect(layerCovers(r, 0, y, c)).toBe(true); // erased, then painted again
    expect(layerCovers(r, 0.7 / c, y, c)).toBe(false); // erased
    expect(layerCovers(r, 1.8 / c, y, c)).toBe(true); // rect
    expect(layerCovers(r, 0.27, y, c)).toBe(true); // a stroke on its own
    expect(layerCovers(r, 0.5, y, c)).toBe(false);
    expect(layerCovers(resolveLayer(layer(), profile), 0.5, y, c)).toBe(true); // whole region
  });
});

describe("classification and coverage", () => {
  const span: BackgroundLayer = layer({
    cover: "area",
    shapes: [{ kind: "span", u: [0, 1], v: [0.2, 0.4] }],
  });

  it("marks background skin under no element and counts it in the metrics", () => {
    const l: Layout = {
      name: "t",
      backgrounds: [span],
      elements: [{ id: "f", type: "figure", position: { u: 0, v: 0.3 }, size_cm: { h: 4, w: 4 } }],
    };
    const cls = classify(l, profile, 3);
    const row = Math.floor((1 - 0.3) * profile.length * 3);
    const centre = Math.floor(cls.width / 2);
    expect(cls.cells[row * cls.width + centre]).toBe(1); // the figure covers the background
    expect(cls.cells[row * cls.width + centre + 15]).toBe(BACKGROUND);
    const cov = coverage(cls, profile);
    let ring = 0;
    for (let yy = 0.2 * profile.length; yy < 0.4 * profile.length; yy += 0.01)
      ring += profile.circumferenceAt(yy) * 0.01;
    expect(cov.total.byCategory.background + cov.total.byCategory.figure).toBeCloseTo(ring, -1);
    const px = blockoutPixels(cls);
    const k = (row * cls.width + centre + 15) * 4;
    expect([...px.slice(k, k + 3)]).toEqual(BLOCKOUT_COLORS.background);
  });

  it("leaves hidden layers out", () => {
    const cls = classify({ name: "t", backgrounds: [{ ...span, hidden: true }], elements: [] }, profile, 2);
    expect(coverage(cls, profile).total.byCategory.background).toBe(0);
  });
});

describe("tiles and seams", () => {
  it("samples tiles with wrap-around", () => {
    const t = emptyTile(2, 1);
    t.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
    const out = new Float32Array(4);
    sampleTile(t, 2, 0.5, out); // between the last and (wrapped) first pixel
    expect(out[0]).toBeCloseTo(127.5);
    expect(out[2]).toBeCloseTo(127.5);
    expect(parseHex("#abc", [0, 0, 0])).toEqual([170, 187, 204]);
    expect(parseHex("nonsense", [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("turns white paper into transparency", () => {
    const t = emptyTile(2, 1);
    t.data.set([255, 255, 255, 255, 0, 0, 0, 255]);
    const ink = paperToInk(t);
    expect(ink.data[3]).toBe(0);
    expect(ink.data[7]).toBe(255);
  });

  it("closes every ring with a cross-fade at the seam", () => {
    const c = 25;
    const end = seamCrossfade(c - 1e-6, c);
    const start = seamCrossfade(0, c);
    expect(end.w).toBeCloseTo(0.5);
    expect(start.w).toBeCloseTo(0.5);
    expect(end.s2).toBeCloseTo(-1e-6);
    expect(start.s2).toBeCloseTo(c);
    expect(seamCrossfade(c / 2, c).w).toBe(0);
  });

  it("makes a tile with a hard edge seamless (offset-and-blend)", () => {
    // A horizontal ramp: a hard jump from white to black at the wrap.
    const t: Tile = emptyTile(64, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const v = Math.round((x / 63) * 255) ^ ((y * 37) % 16);
        t.data.set([v, v, v, 255], (y * 64 + x) * 4);
      }
    expect(seamRatio(t)).toBeGreaterThan(5);
    const fixed = makeSeamless(t);
    expect(seamRatio(fixed)).toBeLessThan(2);
    // The middle is kept.
    const mid = (32 * 64 + 32) * 4;
    expect(fixed.data[mid]).toBe(t.data[mid]);
  });

  it("generates every procedural background seamless and deterministic", () => {
    for (const name of PROCEDURAL_NAMES) {
      const p = { density: 0.6, seed: 3, ink: [20, 20, 20], tileCm: 6, pxPerCm: 12 };
      const a = proceduralTile(name, p)!;
      expect(proceduralTile(name, p)!.data).toEqual(a.data);
      expect(seamRatio(a), name).toBeLessThan(2);
      let ink = 0;
      for (let k = 3; k < a.data.length; k += 4) ink += a.data[k]!;
      const sparse = proceduralTile(name, { ...p, density: 0.1 })!;
      let less = 0;
      for (let k = 3; k < sparse.data.length; k += 4) less += sparse.data[k]!;
      expect(ink, name).toBeGreaterThan(0);
      expect(less, name).toBeLessThanOrEqual(ink * 1.05);
    }
    expect(proceduralTile("nope", { density: 1, seed: 1, ink: [0, 0, 0], tileCm: 4, pxPerCm: 4 })).toBeNull();
    expect(periodicNoise(1, 0.3, 0.7, 4, 4)).toBeCloseTo(periodicNoise(1, 4.3, 8.7, 4, 4), 12);
  });
});

describe("compositing", () => {
  const ppc = 2;
  const g = unwrapRows(profile, ppc);
  /** A skin-coloured unwrap. */
  const skin = () => {
    const d = new Uint8ClampedArray(g.width * g.height * 4);
    for (let k = 0; k < g.width * g.height; k++) d.set([240, 230, 220, 255], k * 4);
    return d;
  };
  const black = (s: number, _y: number, out: Float32Array) => {
    void s;
    out[0] = out[1] = out[2] = 0;
    out[3] = 255;
  };
  const jMid = Math.floor(g.height / 2);
  const iMid = Math.floor(g.width / 2);

  it("darkens skin with multiply and leaves the knockout alone", () => {
    const dst = skin();
    const knock = new Float32Array(g.width * g.height);
    knock[jMid * g.width + iMid] = 1;
    compositeLayer(dst, g, { sample: black, opacity: 0.5, blend: "multiply", alpha: null, knockout: knock });
    const at = (j: number, i: number) => dst[(j * g.width + i) * 4]!;
    expect(at(jMid, iMid)).toBe(240); // knocked out
    expect(at(jMid, iMid + 3)).toBe(120); // half way to black
    expect(at(jMid, 0)).toBe(240); // outside the skin: untouched
  });

  it("grows the knockout by the gap, round the seam too", () => {
    const knock = new Float32Array(g.width * g.height);
    knock[jMid * g.width + g.i1[jMid]!] = 1; // the last skin pixel of the row
    const grown = dilateAlpha(knock, g, 2);
    expect(grown[jMid * g.width + g.i1[jMid]! - 2]).toBe(1);
    expect(grown[jMid * g.width + g.i0[jMid]! + 1]).toBe(1); // wrapped to the other edge
    expect(grown[(jMid + 2) * g.width + g.i1[jMid]!]).toBe(1);
    expect(grown[jMid * g.width + iMid]).toBe(0);
  });

  it("feathers an area's edge and keeps its middle solid", () => {
    const v = 0.5;
    const r = resolveLayer(
      layer({ cover: "area", shapes: [{ kind: "rect", u: 0, v, w_cm: 10, h_cm: 10 }] }),
      profile,
    );
    const hard = layerAlpha(r, g)!;
    const soft = layerAlpha(r, g, 1.5)!;
    const j = Math.floor((1 - v) * profile.length * ppc);
    expect(hard[j * g.width + iMid]).toBe(1);
    expect(soft[j * g.width + iMid]).toBeCloseTo(1, 5);
    // At the rect's edge (5 cm right of the centre) the soft edge is half way.
    const edge = iMid + Math.round(5 * ppc);
    expect(soft[j * g.width + edge]).toBeGreaterThan(0.2);
    expect(soft[j * g.width + edge]).toBeLessThan(0.8);
    expect(layerAlpha(resolveLayer(layer(), profile), g)).toBeNull();
  });

  it("lays patterns out from the seam line, whatever the editor centres", () => {
    const g5 = unwrapRows(profile, ppc, 0.5);
    const j = jMid;
    const i = iMid + 4;
    const u0 = pixelU(g, j, i);
    // The same skin point in the inner-centred image.
    const c = g.c[j]!;
    const s0 = patternS(g, u0, c);
    expect(patternS(g5, u0, c)).toBeCloseTo(s0, 9);
    // s grows to the right on screen.
    expect(patternS(g, pixelU(g, j, i + 1), c)).toBeGreaterThan(s0);
  });

  it("tiles a seamless image across the seam without a jump", () => {
    const tile = proceduralTile("waves", { density: 0.5, seed: 1, ink: [0, 0, 0], tileCm: 5, pxPerCm: 8 })!;
    const dst = skin();
    compositeLayer(dst, g, {
      sample: tileSampler(tile, 5),
      opacity: 1,
      blend: "multiply",
      alpha: null,
      knockout: null,
    });
    // Mean step between the two pixels either side of the seam vs between neighbours elsewhere.
    let seam = 0;
    let inner = 0;
    let n = 0;
    for (let j = 0; j < g.height; j++) {
      const a = g.i0[j]!;
      const b = g.i1[j]!;
      if (b - a < 10) continue;
      seam += Math.abs(dst[(j * g.width + a) * 4]! - dst[(j * g.width + b) * 4]!);
      inner += Math.abs(dst[(j * g.width + a + 5) * 4]! - dst[(j * g.width + a + 6) * 4]!);
      n++;
    }
    expect(seam / n).toBeLessThan((inner / n) * 1.5 + 8);
  });
});

describe("standard background catalogue", () => {
  it("parses the repo's catalogue and falls back to procedural versions without images", () => {
    const text = readFileSync(path.join(root, "assets", "backgrounds", "backgrounds.yaml"), "utf8");
    const r = parseCatalogue(text);
    if (!r.ok) throw new Error(r.error);
    const list = standardBackgrounds(r.catalogue, {});
    for (const p of TILE_PATTERNS) expect(list.some((s) => s.name === p.name)).toBe(true);
    expect(list.every((s) => s.imageUrl === null)).toBe(true);
    expect(list.find((s) => s.name === "wind-bars")?.fallback).toBe("waves");
    const withImage = standardBackgrounds(
      {
        version: 1,
        backgrounds: [{ name: "clouds", label: "Clouds", tile_cm: 10, prompt: "p", file: "clouds.png" }],
      },
      { "clouds.png": "/assets/clouds-123.png" },
    );
    expect(withImage[0]).toMatchObject({ name: "clouds", imageUrl: "/assets/clouds-123.png", tileCm: 10 });
    expect(parseCatalogue("version: 2\nbackgrounds: []\n").ok).toBe(false);
  });
});
