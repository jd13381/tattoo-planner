import { describe, expect, it } from "vitest";
import { PLACEHOLDERS } from "../src/body/inputs.ts";
import { buildProfile } from "../src/body/profile.ts";
import {
  applyResize,
  formatSize,
  handlePoint,
  HANDLES,
  resizeBox,
  resizeCursor,
  resizeOptions,
  skinAt,
  svgToSkin,
  type Box,
  type Handle,
  type ResizeOptions,
} from "../src/editor/resize.ts";
import type { LayoutElement } from "../src/layout/schema.ts";

const box: Box = { cx: 0, cy: 20, w: 10, h: 20, rot: 0 };
const free: ResizeOptions = { keepAspect: false, fromCentre: false, snap: 0 };
const aspect: ResizeOptions = { keepAspect: true, fromCentre: false, snap: 0 };
const TR: Handle = { x: 1, y: 1 };
const BL: Handle = { x: -1, y: -1 };
const R: Handle = { x: 1, y: 0 };
const T: Handle = { x: 0, y: 1 };

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("resizeBox", () => {
  it("does nothing without movement, for every handle and both modes", () => {
    for (const h of HANDLES)
      for (const o of [free, aspect]) {
        const r = resizeBox(box, h, 0, 0, o);
        expect(r.w).toBeCloseTo(10, 9);
        expect(r.h).toBeCloseTo(20, 9);
        close({ x: r.cx, y: r.cy }, { x: 0, y: 20 });
      }
  });

  it("keeps the opposite corner fixed (SVG y grows downwards)", () => {
    // Top-right corner at (5, 10); drag it 2 right and 4 up.
    const r = resizeBox(box, TR, 2, -4, free);
    expect(r.w).toBeCloseTo(12, 9);
    expect(r.h).toBeCloseTo(24, 9);
    close(handlePoint(r, BL), handlePoint(box, BL));
    close(handlePoint(r, TR), { x: 7, y: 6 });
  });

  it("resizes around the centre with fromCentre", () => {
    const r = resizeBox(box, TR, 2, -4, { ...free, fromCentre: true });
    expect(r.w).toBeCloseTo(14, 9);
    expect(r.h).toBeCloseTo(28, 9);
    close({ x: r.cx, y: r.cy }, { x: 0, y: 20 });
  });

  it("keeps the aspect ratio on corners by projecting onto the diagonal", () => {
    const r = resizeBox(box, TR, 5, 0, aspect);
    expect(r.w / r.h).toBeCloseTo(0.5, 9);
    // Projection of (5, 0) onto the diagonal (10, 20): s = 1 + 50 / 500.
    expect(r.h).toBeCloseTo(22, 9);
    close(handlePoint(r, BL), handlePoint(box, BL));
  });

  it("stretches one side with a free edge handle and keeps the opposite edge", () => {
    const r = resizeBox(box, R, 3, 7, free);
    expect(r.w).toBeCloseTo(13, 9);
    expect(r.h).toBeCloseTo(20, 9);
    expect(r.cx).toBeCloseTo(1.5, 9);
    expect(r.cy).toBeCloseTo(20, 9);
  });

  it("scales the whole box from an edge with the aspect kept, cross axis centred", () => {
    const r = resizeBox(box, T, 0, -10, aspect);
    expect(r.h).toBeCloseTo(30, 9);
    expect(r.w).toBeCloseTo(15, 9);
    // The bottom edge stays at y = 30; the x centre is unchanged.
    expect(r.cy + r.h / 2).toBeCloseTo(30, 9);
    expect(r.cx).toBeCloseTo(0, 9);
  });

  it("works in the box's own frame when rotated", () => {
    // Turned 90° counter-clockwise: the top edge faces left on screen.
    const b: Box = { ...box, rot: Math.PI / 2 };
    const r = resizeBox(b, T, -4, 0, free);
    expect(r.h).toBeCloseTo(24, 9);
    expect(r.w).toBeCloseTo(10, 9);
    close(handlePoint(r, { x: 0, y: -1 }), handlePoint(b, { x: 0, y: -1 }));
    // A 30° turn and a corner with the aspect kept: the opposite corner stays put.
    const b30: Box = { ...box, rot: Math.PI / 6 };
    const r30 = resizeBox(b30, TR, 1.7, -2.3, aspect);
    expect(r30.w / r30.h).toBeCloseTo(0.5, 9);
    expect(r30.h).toBeGreaterThan(20);
    close(handlePoint(r30, BL), handlePoint(b30, BL));
  });

  it("never flips and respects the minimum size", () => {
    const r = resizeBox(box, TR, -50, 50, free);
    expect(r.w).toBe(1);
    expect(r.h).toBe(1);
    close(handlePoint(r, BL), handlePoint(box, BL));
    const a = resizeBox(box, TR, -50, 50, aspect);
    expect(a.w).toBeCloseTo(1, 9);
    expect(a.h).toBeCloseTo(2, 9);
    const m = resizeBox(box, TR, -50, 50, { ...free, min: 3 });
    expect([m.w, m.h]).toEqual([3, 3]);
  });

  it("snaps to 0.5 cm: every moved side when free, the driving side when the aspect is kept", () => {
    const r = resizeBox(box, TR, 0.6, -0.9, { ...free, snap: 0.5 });
    expect(r.w).toBe(10.5);
    expect(r.h).toBe(21);
    const a = resizeBox({ ...box, w: 9.9, h: 18 }, TR, 0.3, -0.4, { ...aspect, snap: 0.5 });
    expect(a.h).toBeCloseTo(18.5, 9);
    expect(a.w).toBeCloseTo(9.9 * (18.5 / 18), 9);
    const e = resizeBox(box, R, 0.8, 0, { ...aspect, snap: 0.5 });
    expect(e.w).toBeCloseTo(11, 9);
    expect(e.h).toBeCloseTo(22, 9);
    // An off-grid size does not jump when the handle is grabbed: it holds until half a step.
    const derived = { ...box, w: 9.9, h: 18 };
    expect(resizeBox(derived, R, 0.1, 0, { ...free, snap: 0.5 }).w).toBe(9.9);
    expect(resizeBox(derived, R, 0.3, 0, { ...free, snap: 0.5 }).w).toBe(10);
    expect(resizeBox(derived, TR, 0.05, -0.1, { ...aspect, snap: 0.5 }).h).toBeCloseTo(18, 9);
    // At the minimum the driving side is rounded up to the next snap step.
    const tiny = resizeBox({ ...box, w: 3, h: 7 }, TR, -50, 50, { ...aspect, snap: 0.5 });
    expect(tiny.w).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(tiny.h).toBeCloseTo(2.5, 9);
  });
});

describe("resizeOptions", () => {
  const none = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
  it("keeps the aspect on corners, frees edges, and Shift swaps both", () => {
    expect(resizeOptions(TR, none).keepAspect).toBe(true);
    expect(resizeOptions(R, none).keepAspect).toBe(false);
    expect(resizeOptions(TR, { ...none, shiftKey: true }).keepAspect).toBe(false);
    expect(resizeOptions(R, { ...none, shiftKey: true }).keepAspect).toBe(true);
  });
  it("resizes from the centre with Alt and turns snapping off with Ctrl or Cmd", () => {
    expect(resizeOptions(TR, { ...none, altKey: true }).fromCentre).toBe(true);
    expect(resizeOptions(TR, none).snap).toBe(0.5);
    expect(resizeOptions(TR, { ...none, metaKey: true }).snap).toBe(0);
    expect(resizeOptions(TR, { ...none, ctrlKey: true }).snap).toBe(0);
  });
});

describe("resizeCursor", () => {
  it("picks the cursor along the handle's direction on screen", () => {
    expect(resizeCursor(TR, 0)).toBe("nesw-resize");
    expect(resizeCursor({ x: -1, y: 1 }, 0)).toBe("nwse-resize");
    expect(resizeCursor(R, 0)).toBe("ew-resize");
    expect(resizeCursor(T, 0)).toBe("ns-resize");
    expect(resizeCursor(R, Math.PI / 2)).toBe("ns-resize");
    expect(resizeCursor(TR, Math.PI / 4)).toBe("ns-resize");
    expect(resizeCursor(R, Math.PI / 4)).toBe("nesw-resize");
    expect(resizeCursor(R, -Math.PI / 4)).toBe("nwse-resize");
  });
});

describe("formatSize", () => {
  it("prints width × height with one decimal", () => {
    expect(formatSize(9.9, 18)).toBe("9.9 × 18.0 cm");
  });
});

describe("svgToSkin", () => {
  const profile = buildProfile(PLACEHOLDERS);
  it("inverts the editor's skin → SVG mapping, also across the seam", () => {
    const L = profile.length;
    for (const [centerU, u, v] of [
      [0, 0.1, 0.72],
      [0, 0.9, 0.3],
      [0.5, 0.45, 0.5],
      [0.5, 0.55, 0.8],
    ] as const) {
      const y = v * L;
      const d = ((u - centerU + 1.5) % 1) - 0.5;
      const x = -d * profile.circumferenceAt(y);
      const p = svgToSkin(profile, centerU, x, L - y);
      expect(p.u).toBeCloseTo(u, 9);
      expect(p.v).toBeCloseTo(v, 9);
    }
  });
});

describe("skinAt", () => {
  const profile = buildProfile(PLACEHOLDERS);
  const L = profile.length;
  it("returns the skin point on the sheet and null beside or beyond it", () => {
    const half = profile.circumferenceAt(L / 2) / 2;
    expect(skinAt(profile, 0, 0, L / 2)).toEqual(svgToSkin(profile, 0, 0, L / 2));
    expect(skinAt(profile, 0, half * 0.9, L / 2)).not.toBeNull();
    expect(skinAt(profile, 0, half * 1.1, L / 2)).toBeNull();
    expect(skinAt(profile, 0, 0, -0.5)).toBeNull();
    expect(skinAt(profile, 0, 0, L + 0.5)).toBeNull();
  });
});

describe("applyResize", () => {
  const medusa: LayoutElement = {
    id: "medusa",
    type: "figure",
    position: { u: 0.1, v: 0.72 },
    size_cm: { h: 18 },
  };
  const b: Box = { cx: 0, cy: 0, w: 10.476, h: 19.04, rot: 0 };

  it("changes only the height of a figure whose width follows it when the aspect is kept", () => {
    const r = applyResize(medusa, b, { keepAspect: true, widthDerived: true });
    expect(r).toEqual({ ...medusa, size_cm: { h: 19 } });
  });

  it("stores the width once the aspect changes, and whenever the width is stored", () => {
    expect(applyResize(medusa, b, { keepAspect: false, widthDerived: true })).toMatchObject({
      size_cm: { h: 19, w: 10.5 },
    });
    const withW: LayoutElement = { ...medusa, size_cm: { h: 18, w: 9 } };
    expect(applyResize(withW, b, { keepAspect: true, widthDerived: false })).toMatchObject({
      size_cm: { h: 19, w: 10.5 },
    });
  });

  it("moves the centre when given, rounded and wrapped like a move", () => {
    const r = applyResize(medusa, b, {
      keepAspect: true,
      widthDerived: true,
      position: { u: -0.02, v: 0.71234 },
    });
    expect(r).toMatchObject({ position: { u: 0.98, v: 0.712 } });
    const same = applyResize(medusa, b, { keepAspect: true, widthDerived: true });
    expect(same.type === "figure" && same.position).toBe(medusa.position);
  });

  it("leaves other element types alone", () => {
    const band: LayoutElement = { id: "b", type: "band", pattern: "meander", v: 0.5, width_cm: 2 };
    expect(applyResize(band, b, { keepAspect: true, widthDerived: true })).toBe(band);
  });
});
