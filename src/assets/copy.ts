// Texts of the Assets tab that depend on data: empty states, action summaries, pose labels. Pure,
// so the wording is tested and the page stays thin.
import { CATEGORY_LABELS, type AssetCategory, type SectionId, SECTION_LABELS } from "./category.ts";
import type { TrashMode } from "./types.ts";

export function images(n: number): string {
  return `${n} image${n === 1 ? "" : "s"}`;
}

/** What an empty section says, or null when it has nothing special to say. */
export function emptySectionText(section: SectionId): string | null {
  switch (section) {
    case "ideas":
    case "all":
      return "No ideas yet. Drop reference images here, or make one in the Image studio.";
    case "studio":
      return "Nothing made in the Image studio yet. Images you keep there show up here.";
    case "backgrounds":
      return "No backgrounds yet. Drop background images here.";
    case "measuring":
      return "No measuring photos yet. They help check your measurements. Drop photos of your arm here.";
    case "existing":
      return "No photos of existing tattoos yet. Add them here, then bring a tattoo onto the body in Settings → Projection.";
    case "unused":
      return "Every image is used in a layout or a projection.";
    case "hidden":
      return "No hidden images. Hide images you do not want in the pickers; their files stay.";
    case "missing":
      return "Every catalogued image has its file.";
  }
}

export function filterEmptyText(text: string, section: SectionId): string {
  return text.trim()
    ? `Nothing matches '${text.trim()}' in ${SECTION_LABELS[section]}.`
    : `Nothing matches the filter in ${SECTION_LABELS[section]}.`;
}

export function allHiddenText(n: number): string {
  return n === 1 ? "The only image here is hidden." : `All ${n} images here are hidden.`;
}

/** Title of the trash dialog. */
export function trashTitle(ids: readonly string[], mode: TrashMode | undefined): string {
  const what = ids.length === 1 ? ids[0]! : images(ids.length);
  return mode === "project" ? `Move ${what} to the project's trash folder?` : `Move ${what} to the Trash?`;
}

export function trashBody(n: number, mode: TrashMode | undefined): string {
  const one = n === 1;
  const where =
    mode === "project"
      ? `${one ? "It goes" : "They go"} to the .trash folder inside the project folder, where you can still find ${one ? "it" : "them"}.`
      : `${one ? "It goes" : "They go"} to the Trash, where you can put ${one ? "it" : "them"} back until you empty it.`;
  return `${one ? "The image leaves" : "The images leave"} the project and its catalogue. ${where} You can also undo this for a few seconds.`;
}

export type ActionKind = "hide" | "unhide" | "move" | "delete";

/** The toast after an action. */
export function actionToast(kind: ActionKind, n: number, target?: AssetCategory, mode?: TrashMode): string {
  switch (kind) {
    case "hide":
      return `Hid ${images(n)}`;
    case "unhide":
      return `${images(n)} shown again`;
    case "move":
      return `Moved ${images(n)} to ${target ? CATEGORY_LABELS[target] : "another section"}`;
    case "delete":
      return mode === "project"
        ? `Moved ${images(n)} to the project's trash`
        : `Moved ${images(n)} to the Trash`;
  }
}

const POSES = ["front", "back", "lateral", "medial", "inner", "outer", "side", "top"];

/** "Front" for arm-photos/front.JPG: a measuring photo's pose when its file name says it. */
export function poseLabel(file: string): string | null {
  const name = (file.split("/").pop() ?? "").toLowerCase().replace(/\.[^.]+$/, "");
  const word = POSES.find((p) => new RegExp(`(^|[^a-z])${p}([^a-z]|$)`).test(name));
  return word ? word[0]!.toUpperCase() + word.slice(1) : null;
}

/** File names a drop refuses before sending (the browser cannot show them). */
export function unsupportedDrop(name: string): string | null {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (["heic", "heif"].includes(ext)) return `${name}: HEIC cannot be shown; export it as JPEG or PNG`;
  if (["tif", "tiff", "bmp", "psd"].includes(ext))
    return `${name}: .${ext} cannot be shown; export it as JPEG or PNG`;
  return null;
}
