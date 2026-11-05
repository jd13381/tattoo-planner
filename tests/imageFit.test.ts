import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { measuredValues, PLACEHOLDERS, resolveInputs } from "../src/body/inputs.ts";
import { parseMeasurements } from "../src/config/loadMeasurements.ts";
import { buildProfile } from "../src/body/profile.ts";
import {
  croppedAspect,
  defaultFilter,
  effectiveCrop,
  elementAspects,
  fitContain,
  imageSettings,
  uprightToSource,
} from "../src/layout/imageFit.ts";
import type { FigureLike, Layout } from "../src/layout/schema.ts";
import { classify, resolveElement } from "../src/layout/shapes.ts";
import { parseLayout, updateLayoutText } from "../src/layout/yamlDoc.ts";

const profile = buildProfile(PLACEHOLDERS);
const baselineText = readFileSync(
  path.join(import.meta.dirname, "..", "config", "layouts", "v1-baseline.yaml"),
  "utf8",
);

const fig = (over: Partial<FigureLike> = {}): FigureLike => ({
  id: "f",
  type: "figure",
  position: { u: 0, v: 0.1 },
  size_cm: { h: 20 },
  ...over,
});

describe("reference fields in the layout schema", () => {
  it("accepts crop, quarter turns, flip, feather and filter", () => {
    const text = baselineText.replace(
      "    red_accents: true\n",
      "    red_accents: true\n    crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }\n    image_rotation_deg: 90\n    flip: true\n    feather_cm: 0.5\n    filter: hatching\n",
    );
    const r = parseLayout(text);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.layout.elements.find((e) => e.id === "medusa")).toMatchObject({
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
        image_rotation_deg: 90,
        filter: "hatching",
      });
  });

  it("rejects crops outside the image, odd turns and unknown filters", () => {
    const put = (line: string) =>
      parseLayout(baselineText.replace("    red_accents: true\n", `    ${line}\n`));
    expect(put("crop: { x: 0.6, y: 0, w: 0.5, h: 1 }")).toMatchObject({ ok: false });
    expect(put("crop: { x: 0, y: 0, w: 0, h: 1 }")).toMatchObject({ ok: false });
    expect(put("image_rotation_deg: 45")).toMatchObject({ ok: false });
    expect(put("filter: sepia")).toMatchObject({ ok: false });
    expect(put("feather_cm: -1")).toMatchObject({ ok: false });
  });

  it("writes a new crop in flow style and keeps comments", () => {
    const r = parseLayout(baselineText);
    if (!r.ok) throw new Error(r.error);
    const layout: Layout = {
      ...r.layout,
      elements: r.layout.elements.map((e) =>
        e.id === "medusa" ? { ...e, crop: { x: 0.25, y: 0, w: 0.5, h: 0.75 }, filter: "none" as const } : e,
      ),
    };
    const out = updateLayoutText(baselineText, layout);
    expect(out).toContain("crop: { x: 0.25, y: 0, w: 0.5, h: 0.75 }");
    expect(out).toContain("filter: none");
    expect(out).toContain("# Added at Jan's request");
    expect(parseLayout(out)).toEqual({ ok: true, layout });
  });
});

describe("image fit", () => {
  it("prefers the element crop over the asset crop over the whole image", () => {
    const assetCrop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    const own = { x: 0, y: 0, w: 0.2, h: 0.2 };
    expect(effectiveCrop(fig(), {})).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(effectiveCrop(fig(), { crop: assetCrop })).toEqual(assetCrop);
    expect(effectiveCrop(fig({ crop: own }), { crop: assetCrop })).toEqual(own);
  });

  it("computes the upright aspect of a cut-out", () => {
    const dims = { width: 4000, height: 3000 };
    const crop = { x: 0.2, y: 0.4, w: 0.36, h: 0.2 }; // 1440 × 600 px
    expect(croppedAspect(dims, crop, 0)).toBeCloseTo(2.4);
    expect(croppedAspect(dims, crop, 90)).toBeCloseTo(1 / 2.4);
    expect(croppedAspect(dims, crop, 180)).toBeCloseTo(2.4);
    expect(croppedAspect(dims, crop, 270)).toBeCloseTo(1 / 2.4);
  });

  it("fits images inside the box without distortion", () => {
    expect(fitContain(12, 26, 0.5)).toEqual({ w: 12, h: 24 });
    expect(fitContain(12, 26, 0.4)).toEqual({ w: 10.4, h: 26 });
    expect(fitContain(10, 10, 0)).toEqual({ w: 10, h: 10 });
  });

  it("maps upright points back to the stored image for each turn", () => {
    const crop = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    // Top-left of the upright image.
    expect(uprightToSource(0, 0, crop, 0, false)).toEqual({ x: 0.5, y: 0.5 });
    // Turned clockwise: the upright top-left was the source's bottom-left.
    expect(uprightToSource(0, 0, crop, 90, false)).toEqual({ x: 0.5, y: 1 });
    expect(uprightToSource(0, 0, crop, 180, false)).toEqual({ x: 1, y: 1 });
    expect(uprightToSource(0, 0, crop, 270, false)).toEqual({ x: 1, y: 0.5 });
    expect(uprightToSource(0, 0, crop, 0, true)).toEqual({ x: 1, y: 0.5 });
  });

  it("defaults to grayscale on the forearm and colour above the elbow", () => {
    const below = fig({ position: { u: 0, v: (profile.elbowAt - 1) / profile.length } });
    const above = fig({ position: { u: 0, v: (profile.elbowAt + 1) / profile.length } });
    expect(defaultFilter(below, profile)).toBe("grayscale");
    expect(defaultFilter(above, profile)).toBe("none");
    expect(imageSettings({ ...above, filter: "hatching" }, profile).filter).toBe("hatching");
    expect(imageSettings(below, profile)).toMatchObject({ featherCm: 1, rotation: 0, flip: false });
  });

  it("takes the box width from the image when only the height is set", () => {
    const el = fig({ asset: "a", crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    const aspects = elementAspects([el], new Map([["a", {}]]), new Map([["a", { width: 400, height: 400 }]]));
    expect(aspects.get("f")).toBeCloseTo(0.5);
    const r = resolveElement(el, profile, undefined, aspects.get("f"));
    expect(r.shape).toMatchObject({ w: 10, h: 20 });
    expect(r.flags).toEqual([]);
    // An explicit width wins; without an image the old default stays.
    expect(resolveElement({ ...el, size_cm: { h: 20, w: 8 } }, profile, undefined, 0.5).shape).toMatchObject({
      w: 8,
    });
    expect(resolveElement(el, profile).flags).toEqual(["width assumed"]);
    // classify passes the aspects through, so metrics see the same box.
    const cls = classify({ name: "t", elements: [el] }, profile, 2, undefined, 0, aspects);
    expect(cls.resolved[0]!.shape).toMatchObject({ w: 10 });
  });
});

describe("Anubis in v1-baseline", () => {
  it("sits with its lowest point at the measured distance from the wrist", () => {
    const m = parseMeasurements(
      readFileSync(path.join(import.meta.dirname, "..", "config", "measurements.yaml"), "utf8"),
    );
    if (!m.ok) throw new Error(m.error);
    const arm = buildProfile(resolveInputs(measuredValues(m.measurements)).inputs);
    const r = parseLayout(baselineText);
    if (!r.ok) throw new Error(r.error);
    const anubis = r.layout.elements.find((e) => e.id === "anubis")!;
    const a = m.measurements.existing!.anubis;
    const { shape } = resolveElement(anubis, arm, { height: a.height, width: a.width });
    if (shape.kind !== "box") throw new Error("box expected");
    expect(shape.rot).toBe(0);
    expect(shape.cy - shape.h / 2).toBeCloseTo(a.distance_from_wrist!, 1);
    expect(anubis).toMatchObject({ image_rotation_deg: 90, crop: { w: expect.any(Number) } });
  });
});
