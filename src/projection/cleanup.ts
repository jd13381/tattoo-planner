// The wizard's "Clean up" step (docs/adr/0023-projection-cleanup.md): which edited versions of a photo
// the projection can use instead of the photo, and what the Image studio is asked to do. Pure rules;
// the hand-over between the tabs lives in studioLink.ts, the pixel work in src/render/inkOnly.ts.
import { fileKey } from "../assets/manifestDoc.ts";
import { INK_ONLY_INSTRUCTION } from "../edits/types.ts";

type AssetLike = { id: string; file: string; derived_from?: string; exists?: boolean };

/** The prompt preset for a generative clean-up of a tattoo photo. */
export const INK_ONLY_PROMPT = INK_ONLY_INSTRUCTION;

/**
 * The saved edits of a photo, newest first: every image whose `derived_from` names the photo's original
 * (an edit of an edit names the original too, ADR 0010), the photo itself left out.
 */
export function editsOf<A extends AssetLike>(photo: A | null, assets: readonly A[]): A[] {
  if (!photo) return [];
  const root = photo.derived_from ?? photo.id;
  return assets.filter((a) => a.derived_from === root && a.id !== photo.id).reverse();
}

/**
 * The edit to use after a trip to the Image studio: the newest edit that was not there before, or
 * null when nothing new was saved.
 */
export function newEdit<A extends AssetLike>(before: readonly string[], edits: readonly A[]): A | null {
  return edits.find((e) => !before.includes(e.id) && e.exists !== false) ?? null;
}

/** Whether `file` names one of the edits (case-insensitive, as photo paths are matched). */
export function isEditOf(file: string | null, edits: readonly AssetLike[]): boolean {
  return !!file && edits.some((e) => fileKey(e.file) === fileKey(file));
}

/** Proportions of the edit and the photo differ by more than this: the stretch would show. */
const SHAPE_TOLERANCE = 0.02;

/**
 * A warning when the edit has another shape than the photo (generative edits may change it); the
 * wizard then offers how to lay it on the photo (`cleaned_fit`).
 */
export function shapeWarning(
  photo: { width: number; height: number } | null,
  edit: { width: number; height: number } | null,
): string | null {
  if (!photo || !edit) return null;
  const a = photo.width / photo.height;
  const b = edit.width / edit.height;
  if (Math.abs(a / b - 1) <= SHAPE_TOLERANCE) return null;
  return `The edited image is ${edit.width} × ${edit.height} px, the photo ${photo.width} × ${photo.height} px: another shape, so the ink may sit off. Pick below how it lies on the photo and check that Before and After line up.`;
}
