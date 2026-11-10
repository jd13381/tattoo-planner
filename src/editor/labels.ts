// The words the Layout tab uses for the layout file's terms. The YAML keys stay as they are
// (PROJECT_BRIEF.md §11); only what the user reads is plain language.
import type { ElementType, ImageFilter } from "../layout/schema.ts";

/** An element type as a noun: "Existing tattoo". */
export const KIND_LABEL: Record<ElementType, string> = {
  figure: "Figure",
  existing: "Existing tattoo",
  band: "Band",
  line: "Line",
};

/** One line on what each element type is, for the tool rail and the empty inspector. */
export const KIND_HELP: Record<ElementType, string> = {
  figure: "A planned motif, with a reference image.",
  existing: "A tattoo you already have, from a photo.",
  band: "A patterned ring around the limb.",
  line: "A freehand line, drawn on the 3D view.",
};

/** The same in a few words, where there is no room for the line above. */
export const KIND_SHORT: Record<ElementType, string> = {
  figure: "A planned motif",
  existing: "One you already have",
  band: "A patterned ring",
  line: "Drawn freehand in 3D",
};

const FILTER_LABEL: Record<string, string> = {
  none: "Original colours",
  grayscale: "Grayscale",
  hatching: "Hatching (engraving)",
};

/** An image filter's name in the inspector; an unknown one keeps its file name. */
export function filterLabel(filter: ImageFilter | string): string {
  return FILTER_LABEL[filter] ?? filter;
}

/** "1 figure", "2 bands": a count with its noun. */
export function countNoun(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What a variant holds, e.g. "2 figures, 1 band": only the types it has. */
export function elementSummary(types: readonly ElementType[]): string {
  const count = (t: ElementType) => types.filter((x) => x === t).length;
  const parts = [
    count("figure") > 0 ? countNoun(count("figure"), "figure") : null,
    count("existing") > 0 ? countNoun(count("existing"), "existing tattoo") : null,
    count("band") > 0 ? countNoun(count("band"), "band") : null,
    count("line") > 0 ? countNoun(count("line"), "line") : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : "No elements yet";
}
