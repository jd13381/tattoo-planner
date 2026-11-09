// The cm ruler on a calibrated photo (docs/adr/0024-projection-workspace.md): ticks along the body
// region every centimetre, just outside its left silhouette edge, labelled every 5 cm from the region's
// start. It follows the photo's marks, so a wrong distance shows as a ruler that does not match the
// tape in the photo. Pure maths in turned-photo pixels.
import { alongArm, silhouetteAt, type PhotoFrame, type Vec } from "./model.ts";

export type RulerTick = { cm: number; a: Vec; b: Vec; major: boolean };

/**
 * Ticks from the lowest to the highest whole cm the photo shows (its corners projected onto the axis),
 * clamped to 0 … `length`. `gap` and `size` are the distance from the edge and the tick length, px.
 */
export function rulerTicks(frame: PhotoFrame, length: number, gap: number, size: number): RulerTick[] {
  const corners: Vec[] = [
    { x: 0, y: 0 },
    { x: frame.width, y: 0 },
    { x: 0, y: frame.height },
    { x: frame.width, y: frame.height },
  ];
  const along = corners.map((c) => alongArm(frame, c));
  const from = Math.max(0, Math.ceil(Math.min(...along)));
  const to = Math.min(length, Math.floor(Math.max(...along)));
  const ticks: RulerTick[] = [];
  if (!(to - from < 400)) return ticks; // a degenerate frame (marks nearly together)
  for (let cm = from; cm <= to; cm++) {
    const sil = silhouetteAt(frame, cm);
    if (!sil) continue;
    const [l, r] = sil;
    const d = Math.hypot(l.x - r.x, l.y - r.y) || 1;
    const out = { x: (l.x - r.x) / d, y: (l.y - r.y) / d };
    const major = cm % 5 === 0;
    const len = major ? size * 1.8 : size;
    const a = { x: l.x + out.x * gap, y: l.y + out.y * gap };
    ticks.push({ cm, a, b: { x: a.x + out.x * len, y: a.y + out.y * len }, major });
  }
  return ticks;
}
