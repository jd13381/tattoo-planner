// Maps SVG user units (cm) to pixels inside the element, as the browser does for
// viewBox + preserveAspectRatio="xMidYMid meet". Used to place the unwrap canvas behind the editor SVG.

export type Rect = { x: number; y: number; w: number; h: number };

/** Pixel rectangle (relative to the SVG's content box) covered by `target`, given in user units. */
export function imagePlacement(view: Rect, size: { w: number; h: number }, target: Rect): Rect {
  if (view.w <= 0 || view.h <= 0 || size.w <= 0 || size.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(size.w / view.w, size.h / view.h);
  const ox = (size.w - view.w * scale) / 2 - view.x * scale;
  const oy = (size.h - view.h * scale) / 2 - view.y * scale;
  return { x: ox + target.x * scale, y: oy + target.y * scale, w: target.w * scale, h: target.h * scale };
}
