// Guided projection of an existing tattoo (docs/adr/0014-guided-projection.md): the wizard's state, its
// steps and how its plain answers become a calibration (src/projection/schema.ts). No DOM, no React:
// ProjectionWizard.tsx only draws this.
//
// The user answers one question per step: name and region, which photos, then per photo the turn, the
// two silhouette edges, two marks at known distances and which side faces the camera. Everything else
// in a calibration (the patch area, the blend settings) is derived or kept from the saved file.
import { arcLengthInverse, semiAxes } from "../body/ellipse.ts";
import { U0_ANGLE } from "../body/geometry.ts";
import { REGIONS, type RegionId } from "../body/regions.ts";
import type { RegionProfile } from "../body/profile.ts";
import { wrapU } from "../body/uv.ts";
import { photoFrame, turnedToStored, type Vec } from "./model.ts";
import {
  projectionRegion,
  projectionSchema,
  type AlongMark,
  type PhotoCalibration,
  type PhotoPoint,
  type ProjectionCalibration,
} from "./schema.ts";

export type Turn = PhotoCalibration["turn"];

export type WizardPhoto = {
  file: string;
  turn: Turn;
  edges: { left: [PhotoPoint, PhotoPoint]; right: [PhotoPoint, PhotoPoint] };
  marks: [AlongMark, AlongMark];
  /** The u facing the camera at the region's start (u_view.wrist). */
  facing: number;
  /** Whether the limb is twisted, so that another side faces the camera at the far end. */
  twisted: boolean;
  /** The u facing the camera at the twist reference (u_view.elbow); used only when twisted. */
  facingFar: number;
  weight: number;
};

export type WizardDraft = {
  /** File name of the projection (lowercase letters, digits, dashes). */
  name: string;
  description: string;
  region: RegionId;
  photos: WizardPhoto[];
  /** The skin area the patch covers; null = fitted to the photos (`fitArea`). */
  area: { u: [number, number]; v: [number, number] } | null;
  /** The saved calibration this draft edits (its blend and resolution are kept), or null for a new one. */
  base: ProjectionCalibration | null;
};

export type PhotoTask = "turn" | "edges" | "marks" | "facing";
export const PHOTO_TASKS: readonly PhotoTask[] = ["turn", "edges", "marks", "facing"];

export type WizardStep =
  | { kind: "name" }
  | { kind: "photos" }
  | { kind: "photo"; photo: number; task: PhotoTask }
  | { kind: "preview" };

/** Every step of a draft, in order: name, photos, four tasks per photo, preview and save. */
export function wizardSteps(draft: Pick<WizardDraft, "photos">): WizardStep[] {
  const steps: WizardStep[] = [{ kind: "name" }, { kind: "photos" }];
  draft.photos.forEach((_, photo) => {
    for (const task of PHOTO_TASKS) steps.push({ kind: "photo", photo, task });
  });
  steps.push({ kind: "preview" });
  return steps;
}

export function sameStep(a: WizardStep, b: WizardStep): boolean {
  return (
    a.kind === b.kind &&
    (a.kind !== "photo" || (b.kind === "photo" && a.photo === b.photo && a.task === b.task))
  );
}

/** Index of a step in the draft's steps; a photo step past the last photo falls back to "photos". */
export function stepIndex(draft: Pick<WizardDraft, "photos">, step: WizardStep): number {
  const i = wizardSteps(draft).findIndex((s) => sameStep(s, step));
  return i >= 0 ? i : 1;
}

/** The step `delta` steps away (clamped to the first and the last). */
export function moveStep(draft: Pick<WizardDraft, "photos">, step: WizardStep, delta: number): WizardStep {
  const steps = wizardSteps(draft);
  const i = Math.min(steps.length - 1, Math.max(0, stepIndex(draft, step) + delta));
  return steps[i]!;
}

/** What the region's start line is called, for the marks. */
export function startLabel(region: RegionId): string {
  switch (REGIONS[region].kind) {
    case "arm":
      return "wrist crease";
    case "leg":
      return "ankle (just above the ankle bones)";
    case "torso":
      return "navel (waist line)";
  }
}

/** What the twist reference is called (where `facingFar` applies). */
export function farLabel(region: RegionId): string {
  switch (REGIONS[region].kind) {
    case "arm":
      return "elbow";
    case "leg":
      return "knee";
    case "torso":
      return "neck";
  }
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A file name from free text: "Rose on the calf" → "rose-on-the-calf". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

/** `base`, or base-2, base-3 … when it is taken. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const root = base || "tattoo";
  if (!taken.includes(root)) return root;
  for (let i = 2; ; i++) if (!taken.includes(`${root}-${i}`)) return `${root}-${i}`;
}

/** A new, empty draft. */
export function newDraft(region: RegionId = "arm-left"): WizardDraft {
  return { name: "", description: "", region, photos: [], area: null, base: null };
}

/**
 * Starting values for a newly picked photo: two upright edges a little left and right of the middle,
 * the marks low and high in the middle. The distances of the marks are copied from the previous photo
 * (several photos of one tattoo usually show the same landmarks); without one they are the start line
 * (0 cm) and 15 cm.
 */
export function newPhoto(file: string, prev?: WizardPhoto, facing = 0.5): WizardPhoto {
  return {
    file,
    turn: 0,
    edges: {
      left: [
        { x: 0.36, y: 0.15 },
        { x: 0.36, y: 0.85 },
      ],
      right: [
        { x: 0.64, y: 0.15 },
        { x: 0.64, y: 0.85 },
      ],
    },
    marks: [
      { x: 0.5, y: 0.8, cm: prev?.marks[0].cm ?? 0 },
      { x: 0.5, y: 0.25, cm: prev?.marks[1].cm ?? 15 },
    ],
    facing,
    twisted: false,
    facingFar: facing,
    weight: 1,
  };
}

/** The draft with exactly these photos, in this order; photos already set up keep their answers. */
export function withPhotos(draft: WizardDraft, files: readonly string[]): WizardDraft {
  const known = new Map(draft.photos.map((p) => [p.file, p]));
  const photos: WizardPhoto[] = [];
  for (const file of files)
    photos.push(known.get(file) ?? newPhoto(file, photos.at(-1) ?? draft.photos.at(-1)));
  return { ...draft, photos };
}

/** Where a point of the stored photo (0..1) lies in the photo turned by `turn`. */
export function storedToTurned(x: number, y: number, turn: Turn): Vec {
  return turnedToStored(x, y, ((360 - turn) % 360) as Turn);
}

/**
 * The photo shown with another turn: every point moves with the picture, so it stays on the same spot
 * of the skin. Points nobody has moved yet stay where they are on the screen.
 */
export function turnPhoto(photo: WizardPhoto, turn: Turn): WizardPhoto {
  if (turn === photo.turn) return photo;
  // Points still at their starting places belong to the screen, not to the picture: they stay.
  const fresh = newPhoto(photo.file);
  const untouched =
    JSON.stringify(photo.edges) === JSON.stringify(fresh.edges) &&
    JSON.stringify(photo.marks.map(({ x, y }) => ({ x, y }))) ===
      JSON.stringify(fresh.marks.map(({ x, y }) => ({ x, y })));
  if (untouched) return { ...photo, turn };
  const move = <P extends PhotoPoint>(p: P): P => {
    const s = turnedToStored(p.x, p.y, photo.turn);
    const t = storedToTurned(s.x, s.y, turn);
    return { ...p, x: round4(t.x), y: round4(t.y) };
  };
  return {
    ...photo,
    turn,
    edges: {
      left: [move(photo.edges.left[0]), move(photo.edges.left[1])],
      right: [move(photo.edges.right[0]), move(photo.edges.right[1])],
    },
    marks: [move(photo.marks[0]), move(photo.marks[1])],
  };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** One schematic orientation the user can click: the u facing the camera and its name. */
export type FacingOption = { u: number; label: string };

/** Eight orientations around the region, named after its centre lines (src/body/regions.ts). */
export function facingOptions(region: RegionId): FacingOption[] {
  const lines = REGIONS[region].lines;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return Array.from({ length: 8 }, (_, k) => {
    const u = k / 8;
    const label =
      k % 2 === 0 ? cap(lines[k / 2]!) : `Between ${lines[(k - 1) / 2]!} and ${lines[((k + 1) / 2) % 4]!}`;
    return { u, label };
  });
}

/**
 * A cross-section of the region as the camera sees it from above, for the orientation thumbnails:
 * the outline and its four centre lines, in units of the larger semi-axis, x = the photo's right,
 * y = towards the camera (down in the thumbnail). Same maths as sectionView in model.ts.
 */
export function sectionSketch(
  region: RegionId,
  uView: number,
  aspect = REGIONS[region].kind === "torso" ? 1.5 : 1.25,
): { outline: Vec[]; lines: { u: number; label: string; p: Vec }[] } {
  const def = REGIONS[region];
  const { a, b } = semiAxes(2 * Math.PI, aspect);
  const start = U0_ANGLE[def.kind];
  const plain = arcLengthInverse(a, b, start, 360);
  const angleAt = (u: number) => (def.mirrored ? 2 * start - plain(wrapU(u)) : plain(wrapU(u)));
  const pv = angleAt(uView);
  const nl = Math.hypot(b * Math.cos(pv), a * Math.sin(pv));
  const n = { x: (b * Math.cos(pv)) / nl, z: (a * Math.sin(pv)) / nl };
  const r = { x: n.z, z: -n.x };
  const scale = Math.max(a, b);
  const at = (u: number): Vec => {
    const phi = angleAt(u);
    const p = { x: a * Math.cos(phi), z: b * Math.sin(phi) };
    return { x: (p.x * r.x + p.z * r.z) / scale, y: (p.x * n.x + p.z * n.z) / scale };
  };
  return {
    outline: Array.from({ length: 64 }, (_, k) => at(k / 64)),
    lines: def.short.map((label, k) => ({ u: k / 4, label, p: at(k / 4) })),
  };
}

/** The orientation closest to u (wrapping round). */
export function nearestFacing(region: RegionId, u: number): FacingOption {
  const opts = facingOptions(region);
  const d = (o: FacingOption) => Math.abs(wrapU(u - o.u + 0.5) - 0.5);
  return opts.reduce((best, o) => (d(o) < d(best) ? o : best));
}

/**
 * The skin area the photos can show: every side within a quarter turn of a facing direction, around
 * the region; along it from 1 cm below the lowest mark to 2 cm above the highest. The marks usually
 * are the start line and the top of the tattoo, so this covers the tattoo without asking for it.
 */
export function fitArea(
  draft: Pick<WizardDraft, "photos">,
  profile: Pick<RegionProfile, "length">,
): { u: [number, number]; v: [number, number] } {
  const facings = draft.photos.flatMap((p) => (p.twisted ? [p.facing, p.facingFar] : [p.facing]));
  const u = coveringArc(facings.length ? facings : [0.5], 0.25);
  const cms = draft.photos.flatMap((p) => p.marks.map((m) => m.cm));
  const lo = Math.max(0, Math.min(...(cms.length ? cms : [0])) - 1);
  const hi = Math.min(profile.length, Math.max(...(cms.length ? cms : [10])) + 2);
  const v0 = round4(lo / profile.length);
  const v1 = round4(Math.max(hi, lo + 1) / profile.length);
  return { u, v: [v0, Math.min(1, v1)] };
}

/**
 * The shortest u range (u0 < u1, at most once around) covering ±half around every centre. Found as the
 * complement of the largest gap between the covered arcs; u0 may be negative (a range across u = 0).
 */
export function coveringArc(centres: readonly number[], half: number): [number, number] {
  const N = 720;
  const covered = new Uint8Array(N);
  for (const c of centres)
    for (let k = 0; k < N; k++) {
      const u = k / N;
      if (Math.abs(wrapU(u - c + 0.5) - 0.5) <= half + 1e-9) covered[k] = 1;
    }
  // Largest run of uncovered samples, wrapping round.
  let bestLen = 0;
  let bestStart = -1;
  for (let k = 0; k < N; k++) {
    if (covered[k] || covered[(k - 1 + N) % N] === 0) continue;
    let len = 0;
    while (len < N && !covered[(k + len) % N]) len++;
    if (len > bestLen) {
      bestLen = len;
      bestStart = k;
    }
  }
  if (bestStart < 0) {
    const c = wrapU(centres[0] ?? 0.5);
    return [round4(c - 0.5), round4(c + 0.5)];
  }
  // Covered from the end of the gap round to its start.
  const u0 = (bestStart + bestLen) / N;
  const end = (bestStart - 1 + N) % N; // the last covered sample
  const u1 = end / N + (end / N < u0 ? 1 : 0);
  // Keep u0 in -0.5…0.5 so ranges read naturally (0.1…0.78, or -0.2…0.3 across the u = 0 line).
  const shift = u0 > 0.5 ? -1 : 0;
  return [round4(u0 + shift), round4(u1 + shift)];
}

/** The draft as a calibration, or why it is not one yet. */
export function toCalibration(
  draft: WizardDraft,
  profile: Pick<RegionProfile, "length">,
): { ok: true; calibration: ProjectionCalibration } | { ok: false; error: string } {
  const area = draft.area ?? fitArea(draft, profile);
  const base = draft.base;
  const raw = {
    name: draft.name,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    // Left out for the left arm, so files written before regions existed stay as they are.
    ...(draft.region !== "arm-left" || base?.region ? { region: draft.region } : {}),
    patch: {
      u: area.u,
      v: area.v,
      px_per_cm: base?.patch.px_per_cm ?? 20,
      feather_cm: base?.patch.feather_cm ?? 0.5,
    },
    blend: base?.blend ?? {},
    photos: draft.photos.map((p) => toPhotoCalibration(p)),
  };
  const r = projectionSchema.safeParse(raw);
  if (r.success) return { ok: true, calibration: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

export function toPhotoCalibration(p: WizardPhoto): PhotoCalibration {
  return {
    file: p.file,
    turn: p.turn,
    edges: p.edges,
    along: p.marks,
    u_view: { wrist: round4(p.facing), elbow: round4(p.twisted ? p.facingFar : p.facing) },
    weight: p.weight,
  };
}

/** A saved calibration as a draft, so the wizard can open it prefilled. */
export function fromCalibration(cal: ProjectionCalibration): WizardDraft {
  return {
    name: cal.name,
    description: cal.description ?? "",
    region: projectionRegion(cal),
    photos: cal.photos.map((p) => ({
      file: p.file,
      turn: p.turn,
      edges: structuredClone(p.edges),
      marks: structuredClone(p.along),
      facing: p.u_view.wrist,
      twisted: Math.abs(p.u_view.elbow - p.u_view.wrist) > 1e-6,
      facingFar: p.u_view.elbow,
      weight: p.weight,
    })),
    area: { u: [...cal.patch.u], v: [...cal.patch.v] },
    base: cal,
  };
}

export type StepContext = {
  /** Projection names already in use (for a new projection). */
  taken: readonly string[];
  /** Size of each photo as turned (px), when known; marks are checked in true proportions. */
  sizeOf?: (file: string, turn: Turn) => { width: number; height: number } | null;
  profile?: RegionProfile;
};

/** Why the user cannot go on from this step yet, in plain words; null = ready. */
export function stepIssue(draft: WizardDraft, step: WizardStep, ctx: StepContext): string | null {
  switch (step.kind) {
    case "name": {
      if (!draft.name) return "Give the tattoo a name.";
      if (!NAME.test(draft.name)) return "Use letters, digits and dashes for the name.";
      if (!draft.base && ctx.taken.includes(draft.name)) return `"${draft.name}" exists already.`;
      return null;
    }
    case "photos":
      return draft.photos.length === 0 ? "Pick at least one photo." : null;
    case "photo": {
      const p = draft.photos[step.photo];
      if (!p) return "This photo is no longer picked.";
      return photoIssue(p, step.task, ctx, draft.region);
    }
    case "preview": {
      for (const [i, p] of draft.photos.entries())
        for (const task of PHOTO_TASKS) {
          const issue = photoIssue(p, task, ctx, draft.region);
          if (issue) return `Photo ${i + 1}: ${issue}`;
        }
      if (ctx.profile) {
        const r = toCalibration(draft, ctx.profile);
        if (!r.ok) return r.error;
      }
      return stepIssue(draft, { kind: "name" }, ctx);
    }
  }
}

function photoIssue(p: WizardPhoto, task: PhotoTask, ctx: StepContext, region: RegionId): string | null {
  const size = ctx.sizeOf?.(p.file, p.turn) ?? { width: 1, height: 1 };
  switch (task) {
    case "turn":
    case "facing":
      return null;
    case "edges": {
      const len = (l: [PhotoPoint, PhotoPoint]) =>
        Math.hypot((l[1].x - l[0].x) * size.width, (l[1].y - l[0].y) * size.height);
      if (len(p.edges.left) < 1e-3 * size.height || len(p.edges.right) < 1e-3 * size.height)
        return "Pull the two ends of each edge apart.";
      const mid = (l: [PhotoPoint, PhotoPoint]) => (l[0].x + l[1].x) / 2;
      if (mid(p.edges.left) >= mid(p.edges.right))
        return "The left edge must lie left of the right edge (swap them).";
      return null;
    }
    case "marks": {
      if (Math.abs(p.marks[1].cm - p.marks[0].cm) < 1)
        return "The two distances must be at least 1 cm apart.";
      if (p.marks.some((m) => m.cm < 0)) return `Distances are counted up from the ${startLabel(region)}.`;
      const frame = photoFrame(toPhotoCalibration(p), size.width, size.height, 1);
      if (!frame) return "Place the two points one above the other along the limb, not side by side.";
      // The model needs the region's start at the bottom of the photo (the turn step).
      if (frame.axis.y >= 0)
        return "The point with the larger distance must lie higher up in the photo than the other one.";
      return null;
    }
  }
}

/** Short title of a step for the step list. */
export function stepTitle(step: WizardStep): string {
  switch (step.kind) {
    case "name":
      return "Name and body part";
    case "photos":
      return "Photos";
    case "preview":
      return "Check and save";
    case "photo":
      return { turn: "Turn", edges: "Outline", marks: "Distances", facing: "Side" }[step.task];
  }
}
