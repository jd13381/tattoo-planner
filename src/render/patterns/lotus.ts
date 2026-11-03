// Lotus / papyrus frieze (PROJECT_BRIEF.md §7, Egyptian side): open lotus flowers alternating with
// papyrus umbels on short stems, linked by hanging garland arcs, between two thin border lines.
import { bandFrame } from "./band.ts";
import { quad, type Generator, type Pt, type Shape } from "./geometry.ts";

/** Module (one lotus + one papyrus) width as a multiple of the field height. */
const MODULE_OVER_FIELD = 1.5;

const mirror = (pts: Pt[], cx: number): Pt[] => pts.map((q) => ({ x: 2 * cx - q.x, y: q.y }));
const join = (a: Pt[], b: Pt[]): Pt[] => [...a, ...b.slice(1)];

/** Open lotus seen from the side: central petal, two flaring side petals, two small sepals. */
export function lotusFlower(cx: number, base: number, top: number, halfW: number, width: number): Shape[] {
  const H = base - top;
  const calyx = base - 0.36 * H;
  const neck = halfW * 0.12;
  const s = (points: Pt[], w = width): Shape => ({ kind: "stroke", points, width: w });

  // Central petal: pointed, from both sides of the calyx to the tip.
  const centreLeft = quad(
    { x: cx - neck, y: calyx },
    { x: cx - halfW * 0.42, y: calyx - H * 0.38 },
    { x: cx, y: top },
  );
  // Side petal: inner edge rises close to the centre, outer edge bows out to a flared tip.
  const tip = { x: cx - halfW * 0.92, y: top + H * 0.12 };
  const sideInner = quad({ x: cx - neck, y: calyx }, { x: cx - halfW * 0.35, y: top + H * 0.2 }, tip);
  const sideOuter = quad({ x: cx - neck, y: calyx }, { x: cx - halfW * 0.85, y: calyx - H * 0.05 }, tip);
  // Sepal: a short curl from the calyx outwards.
  const sepal = quad(
    { x: cx - neck, y: calyx + H * 0.02 },
    { x: cx - halfW * 0.4, y: calyx + H * 0.02 },
    { x: cx - halfW * 0.55, y: calyx - H * 0.16 },
  );
  // Centre rib line of the middle petal (engraving detail).
  const rib: Pt[] = [
    { x: cx, y: calyx - H * 0.08 },
    { x: cx, y: top + H * 0.22 },
  ];
  return [
    s([
      { x: cx, y: base },
      { x: cx, y: calyx },
    ]),
    s(join([...centreLeft].reverse(), mirror(centreLeft, cx))),
    s(sideInner),
    s(sideOuter),
    s(mirror(sideInner, cx)),
    s(mirror(sideOuter, cx)),
    s(sepal),
    s(mirror(sepal, cx)),
    s(rib, width * 0.6),
  ];
}

/** Papyrus umbel: a fan on a stem, with a domed top and a few rays. */
export function papyrus(cx: number, base: number, top: number, halfW: number, width: number): Shape[] {
  const H = base - top;
  const calyx = base - 0.4 * H;
  const neck = halfW * 0.1;
  const corner = { x: cx - halfW * 0.78, y: top + H * 0.14 };
  const s = (points: Pt[], w = width): Shape => ({ kind: "stroke", points, width: w });
  const side = quad({ x: cx - neck, y: calyx }, { x: cx - halfW * 0.25, y: calyx - H * 0.2 }, corner);
  const dome = quad(corner, { x: cx, y: top - H * 0.12 }, { x: 2 * cx - corner.x, y: corner.y }, 16);
  const rays: Shape[] = [-0.45, 0, 0.45].map((f) => {
    const end = { x: cx + f * halfW * 0.8, y: top + H * (0.12 + 0.03 * Math.abs(f)) };
    return s([{ x: cx, y: calyx - H * 0.04 }, end], width * 0.6);
  });
  // Bract: a small V under the umbel.
  const bract: Pt[] = [
    { x: cx - halfW * 0.22, y: calyx - H * 0.02 },
    { x: cx, y: calyx + H * 0.1 },
    { x: cx + halfW * 0.22, y: calyx - H * 0.02 },
  ];
  return [
    s([
      { x: cx, y: base },
      { x: cx, y: calyx },
    ]),
    s(join(join([...side].reverse(), dome), mirror(side, cx))),
    s(bract),
    ...rays,
  ];
}

export const lotus: Generator = (p) => {
  const f = bandFrame(p, MODULE_OVER_FIELD);
  const shapes: Shape[] = [...f.borders];
  const half = f.repeat / 2;
  const motifHalfW = half * 0.42;
  const H = f.bottom - f.top;
  for (const x0 of f.modules) {
    const a = x0 + half / 2;
    const b = x0 + (3 * half) / 2;
    shapes.push(...lotusFlower(a, f.bottom, f.top, motifHalfW, f.line));
    shapes.push(...papyrus(b, f.bottom, f.top + H * 0.12, motifHalfW * 0.9, f.line));
    // Garland arcs linking each stem to the next, hanging towards the base line.
    const link = f.bottom - H * 0.3;
    for (const [from, to] of [
      [a, b],
      [b, a + f.repeat],
    ] as const) {
      shapes.push({
        kind: "stroke",
        points: quad(
          { x: from, y: link },
          { x: (from + to) / 2, y: f.bottom + H * 0.22 },
          { x: to, y: link },
          14,
        ),
        width: f.line * 0.75,
      });
    }
  }
  return shapes;
};
