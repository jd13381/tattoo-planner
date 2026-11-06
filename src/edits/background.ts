// Tileable backgrounds from GPT Image (docs/adr/0019): the prompt that asks for a seamless tile, the
// Image studio's presets, and the manifest entry of a kept background. Shared by the Image studio's
// Background mode (server/editsApi.ts) and `npm run backgrounds:generate` (scripts/).
import type { Asset } from "../assets/manifest.ts";
import { BACKGROUND_KIND } from "../render/backgrounds/catalogue.ts";

/** Folder in the project where kept backgrounds are written (scanned as kind "background"). */
export const BACKGROUNDS_FOLDER = "backgrounds";
/** Tag added to every kept background. */
export const BACKGROUND_TAG = "background";
/** Backgrounds are always square and opaque: the seam fix and the tiling need a full tile. */
export const BACKGROUND_SIZE = "1024x1024";

/** Starting points for the Image studio's Background mode; Jan edits the text before sending. */
export const BACKGROUND_PRESETS: readonly { name: string; label: string; subject: string }[] = [
  {
    name: "clouds",
    label: "Clouds",
    subject: "puffy stylised clouds with clean outlines and soft grey shading underneath, loosely scattered",
  },
  {
    name: "stars",
    label: "Stars",
    subject: "a night-sky scatter of small four-pointed sparkle stars and fine dots of a few sizes",
  },
  {
    name: "smoke",
    label: "Smoke (dotwork)",
    subject: "drifting smoke made only of fine black stipple dots, dense in the swirls, fading to open skin",
  },
  {
    name: "waves",
    label: "Waves",
    subject: "Japanese-style wave lines (seigaiha and flowing crests) in black linework",
  },
  {
    name: "geometric",
    label: "Geometric",
    subject: "a fine-line geometric lattice of triangles and dots, like sacred-geometry fill work",
  },
  {
    name: "shadow",
    label: "Shadow gradient",
    subject: "soft black-and-grey whip shading with an uneven, organic density, no outlines",
  },
];

/**
 * The prompt for one seamless tile. `subject` is Jan's description (it may be German); the frame
 * asks for black and grey ink on white paper so the planner can turn the paper into skin.
 */
export function buildBackgroundPrompt(subject: string): string {
  return [
    "Create a seamless, tileable square texture for a tattoo background (fill work behind other tattoos).",
    `Subject: ${subject.trim()}`,
    "",
    "Requirements:",
    "- The image tiles without a visible seam: whatever leaves one edge continues on the opposite edge.",
    "- Even density across the whole square; no centre motif, no vignette, no border, no frame.",
    "- Black and grey tattoo ink only, on plain white paper. White means bare skin.",
    "- Flat and straight on: no perspective, no shadows of the paper, no skin, no body.",
    "- No text, no signature, no watermark.",
  ].join("\n");
}

/** The extra line for an edit of a background, so the result stays a tile. */
export const BACKGROUND_EDIT_LINE =
  "This image is a seamless, tileable tattoo background: keep it seamless, evenly dense and black and grey on white.";

/** Manifest entry for a kept background: kind "background", the prompt chain in the notes. */
export function backgroundAsset(
  variant: { id: string; file: string },
  instructions: string[],
  tools: readonly string[],
): Asset {
  const steps = instructions.map(
    (s, i) =>
      `${JSON.stringify(s.replace(/\s+/g, " ").trim().slice(0, 300))} (${tools[i] ?? "unknown tool"})`,
  );
  return {
    id: variant.id,
    file: variant.file,
    kind: BACKGROUND_KIND,
    notes: `Tileable background, seam fixed: ${steps.join(", then ")}`,
    tags: [BACKGROUND_TAG],
  };
}
