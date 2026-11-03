// Thin canvas layer: strokes and fills the shapes a generator produced, in the ink colour only,
// leaving everything else transparent so the skin shows through.
import type { Generator, Shape } from "./geometry.ts";
import { clipShapes } from "./geometry.ts";
import type { PatternPainter } from "./types.ts";

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], ink: string): void {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const baseAlpha = ctx.globalAlpha;
  for (const s of shapes) {
    ctx.globalAlpha = baseAlpha * (s.alpha ?? 1);
    ctx.beginPath();
    if (s.kind === "dot") {
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const [first, ...rest] = s.points;
    if (!first) continue;
    ctx.moveTo(first.x, first.y);
    for (const p of rest) ctx.lineTo(p.x, p.y);
    if (s.kind === "fill") {
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.lineWidth = s.width;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Turns a generator into a painter: generate, clip to the rectangle, draw. */
export function painterFrom(generate: Generator): PatternPainter {
  return (p) => {
    const { ctx, ink, ...params } = p;
    drawShapes(ctx, clipShapes(generate(params), p), ink);
  };
}
