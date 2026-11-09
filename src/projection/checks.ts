// What a projection draft still needs, per photo and as a whole (docs/adr/0024-projection-workspace.md,
// "Checklist"): the inspector's checklist, the filmstrip's status dots and the Save button's to-do list
// come from here. Pure rules, no DOM.
//
// Three grades: "error" blocks saving (the calibration would be wrong or invalid), "todo" is something
// not done yet that saving does not need (an outline still where a new photo puts it), "done".
// "optional" items only inform.
import { REGIONS, type RegionId } from "../body/regions.ts";
import { shapeWarning } from "./cleanup.ts";
import {
  nameIssue,
  startLabel,
  toPhotoCalibration,
  untouched,
  type DraftPhoto,
  type ProjectionDraft,
  type Turn,
} from "./draft.ts";
import { photoFrame, turnedSize } from "./model.ts";
import type { PhotoPoint } from "./schema.ts";

export type CheckId = "outline" | "distances" | "facing" | "cleaned";
export type CheckState = "done" | "todo" | "error" | "optional";
export type PhotoCheck = { id: CheckId; label: string; state: CheckState; text: string };

/** Size of an image as stored (px, upright by its EXIF orientation), when known. */
export type StoredSize = (file: string) => { width: number; height: number } | null;

export const CHECK_LABELS: Record<CheckId, string> = {
  outline: "Outline",
  distances: "Two distances",
  facing: "Camera side",
  cleaned: "Clean up",
};

/** The limb or body in running text: "arm", "leg", "body". */
export const limbWord = (r: RegionId) => ({ arm: "arm", leg: "leg", torso: "body" })[REGIONS[r].kind];

/** The checklist of one photo, in the order the tools come. */
export function photoChecks(
  p: DraftPhoto,
  region: RegionId,
  sizeOf?: StoredSize,
  cleanupOn = false,
): PhotoCheck[] {
  const stored = sizeOf?.(p.file) ?? null;
  const size = stored ? turnedSize(stored.width, stored.height, p.turn) : { width: 1, height: 1 };
  const fresh = untouched(p);
  const check = (id: CheckId, state: CheckState, text: string): PhotoCheck => ({
    id,
    label: CHECK_LABELS[id],
    state,
    text,
  });
  const limb = limbWord(region);

  const edgeIssue = outlineIssue(p, size);
  const outline = edgeIssue
    ? check("outline", "error", edgeIssue)
    : fresh.edges
      ? check("outline", "todo", `Drag the four orange dots onto the ${limb}'s left and right edge.`)
      : check("outline", "done", "Left and right edge set.");

  const markIssue = marksIssue(p, size, region);
  const [a, b] = p.marks;
  const distances = markIssue
    ? check("distances", "error", markIssue)
    : fresh.marks
      ? check(
          "distances",
          "todo",
          `Drag the two red points onto spots whose distance from the ${startLabel(region)} you know.`,
        )
      : check("distances", "done", `${fmt(a.cm)} cm and ${fmt(b.cm)} cm.`);

  const facing = p.facingSet
    ? check("facing", "done", p.twisted ? "Set, twisted towards the far end." : "Set.")
    : check("facing", "todo", `Say which side of the ${limb} faces the camera.`);

  let cleaned: PhotoCheck;
  if (p.cleaned) {
    const warn = shapeWarning(sizeOf?.(p.file) ?? null, sizeOf?.(p.cleaned) ?? null);
    cleaned =
      warn && !p.cleanedFit && !p.cleanedOffset
        ? check("cleaned", "todo", "The edited version has another shape: check how it lies on the photo.")
        : check("cleaned", "done", `Uses the edited version ${fileName(p.cleaned)}.`);
  } else
    cleaned = check(
      "cleaned",
      "optional",
      cleanupOn ? "Ink only (built in)." : "The photo as it is, with its skin and shadows.",
    );
  return [outline, distances, facing, cleaned];
}

/** The status dot of a photo: red with an error, yellow while something is to do, else green. */
export function photoState(checks: readonly PhotoCheck[]): "error" | "todo" | "done" {
  if (checks.some((c) => c.state === "error")) return "error";
  if (checks.some((c) => c.state === "todo")) return "todo";
  return "done";
}

/**
 * Whether a photo can go into the live preview: its outline and both distances are set and valid
 * (the camera side may still be the default; the preview shows where that puts the tattoo).
 */
export function previewable(checks: readonly PhotoCheck[]): boolean {
  return checks.every((c) => (c.id === "outline" || c.id === "distances" ? c.state === "done" : true));
}

export type DraftIssue = {
  /** The photo it concerns (index), or null for the projection as a whole. */
  photo: number | null;
  check: CheckId | "name" | "photos";
  severity: "error" | "todo";
  text: string;
};

/** Everything still open, errors first: the Save button's to-do list. */
export function draftIssues(
  draft: ProjectionDraft,
  taken: readonly string[],
  sizeOf?: StoredSize,
): DraftIssue[] {
  const out: DraftIssue[] = [];
  const name = nameIssue(draft, taken);
  if (name) out.push({ photo: null, check: "name", severity: "error", text: name });
  if (draft.photos.length === 0)
    out.push({ photo: null, check: "photos", severity: "error", text: "Add at least one photo." });
  draft.photos.forEach((p, i) => {
    for (const c of photoChecks(p, draft.region, sizeOf, !!draft.cleanup))
      if (c.state === "error" || c.state === "todo")
        out.push({ photo: i, check: c.id, severity: c.state, text: c.text });
  });
  return out.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "error" ? -1 : 1));
}

const fmt = (cm: number) => (Math.round(cm * 10) / 10).toString();
const fileName = (f: string) => f.split("/").pop() ?? f;

function outlineIssue(p: DraftPhoto, size: { width: number; height: number }): string | null {
  const len = (l: [PhotoPoint, PhotoPoint]) =>
    Math.hypot((l[1].x - l[0].x) * size.width, (l[1].y - l[0].y) * size.height);
  if (len(p.edges.left) < 1e-3 * size.height || len(p.edges.right) < 1e-3 * size.height)
    return "Pull the two ends of each edge apart.";
  const mid = (l: [PhotoPoint, PhotoPoint]) => (l[0].x + l[1].x) / 2;
  if (mid(p.edges.left) >= mid(p.edges.right))
    return "The left edge must lie left of the right edge (swap them).";
  return null;
}

function marksIssue(p: DraftPhoto, size: { width: number; height: number }, region: RegionId): string | null {
  if (Math.abs(p.marks[1].cm - p.marks[0].cm) < 1) return "The two distances must be at least 1 cm apart.";
  if (p.marks.some((m) => m.cm < 0)) return `Distances are counted up from the ${startLabel(region)}.`;
  const frame = photoFrame(toPhotoCalibration(p), size.width, size.height, 1);
  if (!frame) return "Place the two points one above the other along the limb, not side by side.";
  // The model needs the region's start at the bottom of the photo (turn the photo).
  if (frame.axis.y >= 0)
    return "The point with the larger distance must lie higher up in the photo than the other one.";
  return null;
}

/** Turned size from a stored size, for callers that have the stored one. */
export function turnedSizeOf(sizeOf: StoredSize, file: string, turn: Turn) {
  const s = sizeOf(file);
  return s ? turnedSize(s.width, s.height, turn) : null;
}
