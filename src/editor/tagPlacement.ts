// Where an element's name tag sits on the 2D sheet. The tag hangs on a corner of the element's
// bounding box, outside it (as a frame name does in a design tool), and avoids the cm labels the
// grid draws next to the centre line. All values are SVG units of the unwrap editor (cm, y down).

export type TagRect = { x: number; y: number; w: number; h: number };

/** An element's bounding box on the sheet. */
export type TagBounds = { left: number; right: number; top: number; bottom: number };

export type TagCorner = "above-left" | "above-right" | "below-left" | "below-right";

export type TagPlacement = TagRect & { corner: TagCorner };

/**
 * The areas the grid's ring labels ("20 cm") take: one every 10 cm, right of the centre line, just
 * above its ring (src/render/cmGrid.ts draws them at x + 0.4 cm, 0.25 cm above the line, 0.9 cm tall).
 */
export function scaleLabelZones(lengthCm: number): TagRect[] {
  const zones: TagRect[] = [];
  for (let y = 0; y <= lengthCm + 1e-9; y += 10)
    zones.push({ x: 0.2, y: lengthCm - y - 1.3, w: 3.6, h: 1.3 });
  return zones;
}

export function intersects(a: TagRect, b: TagRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const ORDER: readonly TagCorner[] = ["above-left", "above-right", "below-left", "below-right"];

function at(corner: TagCorner, box: TagBounds, size: { w: number; h: number }, gap: number): TagRect {
  // A tag wider than its box still starts at the box's left edge (or ends at its right edge).
  const x = corner.endsWith("left") ? box.left : box.right - size.w;
  const y = corner.startsWith("above") ? box.top - gap - size.h : box.bottom + gap;
  return { x, y, w: size.w, h: size.h };
}

/**
 * The tag's rectangle: above the box's left corner when that is free, else the first of above right,
 * below left, below right that touches none of the `avoid` areas (above left when all of them do).
 */
export function placeTag(
  box: TagBounds,
  size: { w: number; h: number },
  gap: number,
  avoid: readonly TagRect[] = [],
): TagPlacement {
  for (const corner of ORDER) {
    const rect = at(corner, box, size, gap);
    if (!avoid.some((zone) => intersects(rect, zone))) return { ...rect, corner };
  }
  return { ...at("above-left", box, size, gap), corner: "above-left" };
}
