import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import { layoutToTexture } from "../src/body/uv.ts";
import {
  addSample,
  appendStroke,
  applyStroke,
  defaultStrokeWidth,
  nextStrokeId,
  simplifyStroke,
  skinDistance,
  textureToLayout,
  type UV,
} from "../src/editor/stroke.ts";
import type { Layout } from "../src/layout/schema.ts";
import { layoutSchema } from "../src/layout/schema.ts";
import { hits, resolveElement } from "../src/layout/shapes.ts";
import { parseLayout, updateLayoutText } from "../src/layout/yamlDoc.ts";

const profile = buildProfile(PLACEHOLDERS);
const L = profile.length;
const baselineText = readFileSync(
  path.join(import.meta.dirname, "..", "config", "layouts", "v1-baseline.yaml"),
  "utf8",
);
function baseline(): Layout {
  const r = parseLayout(baselineText);
  if (!r.ok) throw new Error(r.error);
  return r.layout;
}

/** Dense samples along a straight path in (u, v), possibly across the seam (u given unwrapped). */
function samples(u0: number, v0: number, u1: number, v1: number, n = 200): UV[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    u: (((u0 + ((u1 - u0) * i) / n) % 1) + 1) % 1,
    v: v0 + ((v1 - v0) * i) / n,
  }));
}

describe("texture → layout coordinates", () => {
  it("inverts layoutToTexture all around the arm", () => {
    for (const u of [0, 0.1, 0.25, 0.4, 0.499, 0.501, 0.75, 0.9])
      for (const v of [0, 0.3, 0.7, 1]) {
        const t = layoutToTexture(profile, u, v);
        const back = textureToLayout(profile, t.x, t.y)!;
        expect(Math.abs(((back.u - u + 1.5) % 1) - 0.5)).toBeLessThan(1e-9);
        expect(back.v).toBeCloseTo(v, 12);
      }
  });

  it("refuses points beside the skin of a narrow row", () => {
    // At the wrist the row is narrower than the unwrap: its outer texture edge is not skin.
    expect(textureToLayout(profile, 0.01, 0)).toBeNull();
    expect(textureToLayout(profile, 0.5, 0)).toEqual({ u: 0, v: 0 });
  });
});

describe("stroke simplification", () => {
  it("reduces a straight stroke to its two ends", () => {
    const s = simplifyStroke(profile, samples(0.1, 0.2, 0.15, 0.6));
    expect(s).toEqual([
      { u: 0.1, v: 0.2 },
      { u: 0.15, v: 0.6 },
    ]);
  });

  it("keeps the corner of a bent stroke and stays within tolerance", () => {
    const drawn = [...samples(0.05, 0.1, 0.05, 0.4), ...samples(0.05, 0.4, 0.2, 0.5).slice(1)];
    const s = simplifyStroke(profile, drawn, 0.3);
    expect(s.length).toBe(3);
    expect(s[1]).toEqual({ u: 0.05, v: 0.4 });
  });

  it("handles a stroke across the inner seam without a detour round the arm", () => {
    // From u = 0.45 to 0.55 (passing 0.5): a short straight line, not one around the outer side.
    const s = simplifyStroke(profile, samples(0.45, 0.3, 0.55, 0.35));
    expect(s).toEqual([
      { u: 0.45, v: 0.3 },
      { u: 0.55, v: 0.35 },
    ]);
    // And across u = 0 / 1 (outer line) too.
    const t = simplifyStroke(profile, samples(-0.05, 0.3, 0.05, 0.6));
    expect(t).toEqual([
      { u: 0.95, v: 0.3 },
      { u: 0.05, v: 0.6 },
    ]);
    // The resulting line covers the skin it was drawn on (rendered by the same rules).
    const line = resolveElement({ id: "x", type: "line", points: t, width_cm: 1 }, profile).shape;
    for (const p of samples(-0.05, 0.3, 0.05, 0.6, 20))
      expect(hits(line, p.u, p.v * L, profile.circumferenceAt(p.v * L))).toBe(true);
  });

  it("skips samples closer than the minimum step", () => {
    let pts: UV[] = [];
    pts = addSample(profile, pts, { u: 0, v: 0.5 });
    const same = addSample(profile, pts, { u: 0.001, v: 0.5 });
    expect(same).toBe(pts);
    expect(addSample(profile, pts, { u: 0, v: 0.51 })).toHaveLength(2);
    expect(skinDistance(profile, { u: 0.99, v: 0.5 }, { u: 0.01, v: 0.5 })).toBeCloseTo(
      0.02 * profile.circumferenceAt(0.5 * L),
      9,
    );
  });
});

describe("applying a stroke to a layout", () => {
  it("adds a new red line with the width of red-stroke-1, valid and saved as YAML", () => {
    const l = baseline();
    const r = applyStroke(profile, l, samples(0.3, 0.5, 0.35, 0.8), null)!;
    const el = r.layout.elements[r.index]!;
    expect(r.index).toBe(l.elements.length);
    expect(el).toEqual({
      id: "red-stroke-2",
      type: "line",
      color: "red",
      points: [
        { u: 0.3, v: 0.5 },
        { u: 0.35, v: 0.8 },
      ],
      width_cm: 1.5,
    });
    expect(layoutSchema.safeParse(r.layout).success).toBe(true);
    const text = updateLayoutText(baselineText, r.layout);
    expect(text).toContain("points: [ { u: 0.05, v: 0.0 }"); // red-stroke-1 untouched
    expect(text).toMatch(
      /id: red-stroke-2\n {4}type: line\n {4}color: red\n {4}points: \[ \{ u: 0.3, v: 0.5 \}/,
    );
    expect(parseLayout(text)).toEqual({ ok: true, layout: r.layout });
  });

  it("appends to a selected line at the nearer end and keeps its points", () => {
    const l = baseline();
    const i = l.elements.findIndex((e) => e.id === "red-stroke-1");
    // Drawn from near the top end (u 0.10, v 1.0) downwards: joined after it, reversed.
    const r = applyStroke(profile, l, samples(0.3, 0.7, 0.11, 0.99), i)!;
    expect(r.index).toBe(i);
    const el = r.layout.elements[i]!;
    expect(el.type === "line" && el.points).toEqual([
      { u: 0.05, v: 0 },
      { u: 0.15, v: 0.4 },
      { u: 0.1, v: 1 },
      { u: 0.11, v: 0.99 },
      { u: 0.3, v: 0.7 },
    ]);
    expect(r.layout.elements).toHaveLength(l.elements.length);
  });

  it("joins at whichever ends are closest", () => {
    const line = [
      { u: 0, v: 0.2 },
      { u: 0, v: 0.4 },
    ];
    expect(
      appendStroke(profile, line, [
        { u: 0, v: 0.1 },
        { u: 0, v: 0.18 },
      ]),
    ).toEqual([{ u: 0, v: 0.1 }, { u: 0, v: 0.18 }, ...line]);
    expect(
      appendStroke(profile, line, [
        { u: 0, v: 0.6 },
        { u: 0, v: 0.42 },
      ]),
    ).toEqual([...line, { u: 0, v: 0.42 }, { u: 0, v: 0.6 }]);
  });

  it("drops a click and picks free ids and the default width", () => {
    expect(
      applyStroke(
        profile,
        baseline(),
        [
          { u: 0, v: 0.5 },
          { u: 0.001, v: 0.5 },
        ],
        null,
      ),
    ).toBeNull();
    expect(nextStrokeId(["red-stroke-1", "red-stroke-3"])).toBe("red-stroke-2");
    expect(defaultStrokeWidth({ name: "x", elements: [] })).toBe(1.5);
  });
});

describe("YAML of a new element", () => {
  it("starts with id and type even when the schema puts type first", () => {
    const l = baseline();
    const r = applyStroke(profile, l, samples(0.3, 0.5, 0.35, 0.8), null)!;
    const parsed = layoutSchema.parse(r.layout); // as the dev server sees it: type before id
    expect(Object.keys(parsed.elements.at(-1)!)[0]).toBe("type");
    expect(updateLayoutText(baselineText, parsed)).toContain(
      "  - id: red-stroke-2\n    type: line\n    color: red\n",
    );
  });
});
