// The projection workspace's state (docs/adr/0024-projection-workspace.md): a draft of a calibration in
// the user's plain answers, and how it becomes a calibration (src/projection/schema.ts) and back. No
// DOM, no React: ProjectionWorkspace.tsx only draws this; checks.ts says what is still missing.
//
// Per photo the user sets the turn, the two silhouette edges, two marks at known distances and which
// side faces the camera. Everything else in a calibration (the patch area, the blend settings) is
// derived (area.ts) or kept from the saved file.
import { arcLengthInverse, semiAxes } from "../body/ellipse.ts";
import { U0_ANGLE } from "../body/geometry.ts";
import { REGIONS, type RegionId } from "../body/regions.ts";
import type { RegionProfile } from "../body/profile.ts";
import { wrapU } from "../body/uv.ts";
import { autoArea, type SkinArea } from "./area.ts";
import { storedErase, type EraseSettings } from "./erase.ts";
import { turnedToStored, type Vec } from "./model.ts";
import {
  DEFAULT_CLEANUP,
  projectionRegion,
  projectionSchema,
  type AlongMark,
  type CleanupSettings,
  type EditFit,
  type PhotoCalibration,
  type PhotoPoint,
  type ProjectionCalibration,
} from "./schema.ts";

export type Turn = PhotoCalibration["turn"];

export type DraftPhoto = {
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
  /** An edited version of the photo whose pixels are projected (`cleaned`, docs/adr/0023), or null. */
  cleaned: string | null;
  /** How the edited version lies on the photo when its shape differs (`cleaned_fit`). */
  cleanedFit: EditFit | null;
  /** Small shift of the edited version on the photo (`cleaned_offset`), turned photo 0..1; null = none. */
  cleanedOffset: PhotoPoint | null;
  /**
   * Whether the user has said where the camera was. Not stored: a saved photo has it, a new one starts
   * facing the seam side and asks (checks.ts).
   */
  facingSet: boolean;
};

export type ProjectionDraft = {
  /** File name of the projection (lowercase letters, digits, dashes). */
  name: string;
  description: string;
  region: RegionId;
  photos: DraftPhoto[];
  /** The skin area the patch covers when held ("Hold area"); null = automatic (area.ts `autoArea`). */
  area: SkinArea | null;
  /** The saved calibration this draft edits (its blend and resolution are kept), or null for a new one. */
  base: ProjectionCalibration | null;
  /** Ink only (docs/adr/0023); null = the photos' brightness as it is. */
  cleanup: CleanupSettings | null;
  /** The eraser (docs/adr/0023): speck removal and strokes, applied after ink only; null = nothing. */
  erase: EraseSettings | null;
};

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

export const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
export function newDraft(region: RegionId = "arm-left"): ProjectionDraft {
  return {
    name: "",
    description: "",
    region,
    photos: [],
    area: null,
    base: null,
    cleanup: { ...DEFAULT_CLEANUP },
    erase: null,
  };
}

/**
 * Starting values for a newly picked photo: two upright edges a little left and right of the middle,
 * the marks low and high in the middle. The distances of the marks are copied from the previous photo
 * (several photos of one tattoo usually show the same landmarks); without one they are the start line
 * (0 cm) and 15 cm.
 */
export function newPhoto(file: string, prev?: DraftPhoto, facing = 0.5): DraftPhoto {
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
    cleaned: null,
    cleanedFit: null,
    cleanedOffset: null,
    facingSet: false,
  };
}

/** A photo as picked: the photo (its frame and points) and the edited version whose pixels are used. */
export type PhotoPick = { file: string; cleaned: string | null };

/**
 * The draft with exactly these photos, in this order. Photos already set up keep their answers (the
 * picked version replaces their edit); new ones copy the distances of the photo before them.
 */
export function withPhotos(draft: ProjectionDraft, picks: readonly PhotoPick[]): ProjectionDraft {
  const known = new Map(draft.photos.map((p) => [p.file, p]));
  const photos: DraftPhoto[] = [];
  for (const { file, cleaned } of picks) {
    const old = known.get(file);
    if (old)
      photos.push(old.cleaned === cleaned ? old : { ...old, cleaned, cleanedFit: null, cleanedOffset: null });
    else photos.push({ ...newPhoto(file, photos.at(-1) ?? draft.photos.at(-1)), cleaned });
  }
  return { ...draft, photos };
}

/** The photos of a draft as picks (for the photo picker). */
export function picksOf(draft: Pick<ProjectionDraft, "photos">): PhotoPick[] {
  return draft.photos.map((p) => ({ file: p.file, cleaned: p.cleaned }));
}

/** Whether a photo's outline and marks are still where a new photo puts them. */
export function untouched(photo: Pick<DraftPhoto, "file" | "edges" | "marks">): {
  edges: boolean;
  marks: boolean;
} {
  const fresh = newPhoto(photo.file);
  return {
    edges: JSON.stringify(photo.edges) === JSON.stringify(fresh.edges),
    marks:
      JSON.stringify(photo.marks.map(({ x, y }) => ({ x, y }))) ===
      JSON.stringify(fresh.marks.map(({ x, y }) => ({ x, y }))),
  };
}

/** Where a point of the stored photo (0..1) lies in the photo turned by `turn`. */
export function storedToTurned(x: number, y: number, turn: Turn): Vec {
  return turnedToStored(x, y, ((360 - turn) % 360) as Turn);
}

/**
 * The photo shown with another turn: every point moves with the picture, so it stays on the same spot
 * of the skin. Points nobody has moved yet stay where they are on the screen.
 */
export function turnPhoto(photo: DraftPhoto, turn: Turn): DraftPhoto {
  if (turn === photo.turn) return photo;
  // Points still at their starting places belong to the screen, not to the picture: they stay.
  const fresh = untouched(photo);
  if (fresh.edges && fresh.marks) return { ...photo, turn };
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

/**
 * A cross-section of the region as the camera sees it from above (the model's own view, used to check
 * the camera picture of src/projection/sides.ts against the model): the outline and its four centre lines, in units of the larger semi-axis, x = the photo's right,
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

/** Size of a photo as turned (px), when known. */
export type SizeOf = (file: string, turn: Turn) => { width: number; height: number } | null;

/** The automatic area of a draft (area.ts), from the photos as far as their sizes are known. */
export function draftAutoArea(
  draft: Pick<ProjectionDraft, "photos">,
  profile: RegionProfile,
  sizeOf?: SizeOf,
): SkinArea | null {
  return autoArea(
    draft.photos.map((p) => ({ photo: toPhotoCalibration(p), size: sizeOf?.(p.file, p.turn) ?? null })),
    profile,
  );
}

/** The area the draft covers: held, else automatic, else (no usable photo yet) the region's lower third. */
export function draftArea(draft: ProjectionDraft, profile: RegionProfile, sizeOf?: SizeOf): SkinArea {
  return draft.area ?? draftAutoArea(draft, profile, sizeOf) ?? { u: [0.25, 0.75], v: [0, 0.3] };
}

/** The draft as a calibration, or why it is not one yet. */
export function toCalibration(
  draft: ProjectionDraft,
  profile: RegionProfile,
  sizeOf?: SizeOf,
): { ok: true; calibration: ProjectionCalibration } | { ok: false; error: string } {
  const area = draftArea(draft, profile, sizeOf);
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
    ...(draft.cleanup ? { cleanup: draft.cleanup } : {}),
    ...(storedErase(draft.erase) ? { erase: storedErase(draft.erase) } : {}),
    photos: draft.photos.map((p) => toPhotoCalibration(p)),
  };
  const r = projectionSchema.safeParse(raw);
  if (r.success) return { ok: true, calibration: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

export function toPhotoCalibration(p: DraftPhoto): PhotoCalibration {
  return {
    file: p.file,
    turn: p.turn,
    edges: p.edges,
    along: p.marks,
    u_view: { wrist: round4(p.facing), elbow: round4(p.twisted ? p.facingFar : p.facing) },
    weight: p.weight,
    ...(p.cleaned ? { cleaned: p.cleaned } : {}),
    ...(p.cleaned && p.cleanedFit ? { cleaned_fit: p.cleanedFit } : {}),
    ...(p.cleaned && p.cleanedOffset && (p.cleanedOffset.x !== 0 || p.cleanedOffset.y !== 0)
      ? { cleaned_offset: { x: round4(p.cleanedOffset.x), y: round4(p.cleanedOffset.y) } }
      : {}),
  };
}

/**
 * A saved calibration as a draft. Its area is held as saved; the workspace switches it to automatic
 * once the photo sizes are known when the saved area cuts off what the photos show (area.ts
 * `openingArea`).
 */
export function fromCalibration(cal: ProjectionCalibration): ProjectionDraft {
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
      cleaned: p.cleaned ?? null,
      cleanedFit: p.cleaned_fit ?? null,
      cleanedOffset: p.cleaned_offset ? { ...p.cleaned_offset } : null,
      facingSet: true,
    })),
    area: { u: [...cal.patch.u], v: [...cal.patch.v] },
    base: cal,
    cleanup: cal.cleanup ? { ...cal.cleanup } : null,
    erase: cal.erase ? structuredClone(cal.erase) : null,
  };
}

/** Why the name cannot be saved, in plain words; null = fine. */
export function nameIssue(
  draft: Pick<ProjectionDraft, "name" | "base">,
  taken: readonly string[],
): string | null {
  if (!draft.name) return "Give the tattoo a name.";
  if (!NAME.test(draft.name)) return "Use letters, digits and dashes for the name.";
  if (!draft.base && taken.includes(draft.name)) return `"${draft.name}" exists already.`;
  return null;
}
