# ADR 0023: Projection v2: ink only, edited photos, a simpler camera step

- Status: accepted (2026-11-06, decided by Claude under Jan's autonomy rule; see docs/claude-decisions.md, "Projection v2")
- Context: ADR 0006 (forward model, patch), ADR 0014 (guided wizard; this ADR amends its steps), ADR 0010 and 0013 (Image studio sessions and built-in operations)

## Problem

Jan, after projecting his back tattoo: "Die Projection funktioniert ganz gut, wenn man sich Mühe gibt, aber sie nimmt Teile des Körpers mit." The patch divides each photo by a local skin brightness (a max filter over 1.5 cm), which evens out exposure but not the shading of a real back: highlights push the max up, so the skin beside them turns grey, and shoulder blades, the spine and the flanks came out on the 3D body. He wants a step, linked to the Image studio, to clean the tattoo's picture, with or without GPT.

And: "Die Wahl der Perspektive ist sinnvoll, aber verwirrend." The Side step showed eight cross-section drawings labelled "out lat in med", a fine-tune slider over the whole turn and a "twisted" switch.

## Decision

**A Clean up step after the photo steps, before Check and save.** Two ways, combinable:

1. **Ink only (built in, no key)**, a `cleanup:` block in the projection file: `flatten_cm` (default 4), `strength` (0..1, default 0.5), `keep_color` (default false). After the photos are blended (ADR 0006), `src/render/inkOnly.ts` estimates the skin's own brightness at every patch pixel: the mean of the pixels around it that are not ink, over a window of `flatten_cm`, refined twice so the ink drops out of the estimate, on a coarse grid; a solid fill wider than the window falls back to a three times wider window, then to the mean of all skin. Each pixel is divided by it, so bare skin is 1 in light and in shadow alike. The darkness that is left is cut by `strength` (a smoothstep starting between 5 % and 35 % below the skin): pores, hair and shadow edges drop out. The ink amount becomes the patch's alpha (times the old seen-ness alpha), the tone its grey (darkened towards solid black with the strength, so 1 is line art), and with `keep_color` the colour per channel against a per-channel skin estimate (so the skin's colour cast goes and red ink stays red; the darkest channel decides what is ink). The patch keeps being drawn with multiply, so only ink darkens the planner's skin. The footprint (blockout, metrics) follows the ink.
2. **An edited photo**, `cleaned: <file>` on a photo: "Edit in Image studio" parks the wizard's answers in memory (the Settings tab unmounts), opens the studio on that photo (or its edit in use) with the new built-in **Tattoo ink only** picked and the GPT prompt preset **Tattoo ink only** filled in, and a banner with "Back to the projection". Saving there (Save & close, ADR 0010) writes `edits/<photo>-edit-N.png` with `derived_from` the photo. Back in the wizard, the newest edit saved since is picked for that photo; a select lists the photo's edits and "The photo itself". The patch then samples the edit instead of the photo; the points stay in the photo's frame (the edit is stretched onto it, a warning shows when its proportions differ by more than 2 %), transparent parts of the edit count as white skin, not as unseen. Both photo and edit are loaded; a missing edit falls back to the photo with a note.

New tattoos start with ink only on; a file without the new keys renders exactly as before, and opening one in the wizard keeps them off, so saving changes nothing (Jan's Anubis round-trip test still holds). The keys are optional and written in place (comments kept).

**"Where was the camera?" replaces the Side step's drawings.** A small picture of the person seen from above, facing the viewer (front at the bottom, so their left is on the right, like someone standing in front of you), the body part highlighted, a camera on a ring round it that can be dragged (or turned with the arrow keys) and snaps to the four sides; under it four big buttons with plain names (arm: Inner side / palm side, Outer side / back of the hand, Thumb side, Little-finger side; leg: Front, Back, Outer side, Inner side; torso: Front, Back, Left side, Right side), ordered as the picture shows them; then "A little from the side?" (±45° from the chosen side, labelled with the neighbouring sides). The model's grid stays on the photo as the live check; its key names the sides in the same words. "Twisted" moved under **Advanced**, with the same picker for the far end. Arms are drawn hanging with the palms forward, the convention of the brief's four views (F2). The mapping lives in `src/projection/sides.ts`; a test checks it against the model's own cross-section for every region and side (which side lands on the photo's right).

## Alternatives

- **Cleaning each photo in photo space** before projecting: the window would be in pixels, not cm, and the photo's background next to the skin counts as ink; in patch space only skin inside the outline is seen and the window is in cm.
- **A stronger local white (larger max filter)**: highlights still win a max; a mean of non-ink skin is robust to them.
- **Segmentation or a learnt "tattoo vs. skin" model**: a download and unreliable on tattooed skin (as in ADR 0014); the GPT path covers hard cases.
- **Storing the cleaned patch** instead of settings: a binary in the data folder per change; the settings rebuild it in milliseconds.
- **Camera step as a draggable 3D model**: needs the region's place in the 3D body and a second WebGL view; the top-down picture says the same with no 3D.

## Limits

- The built-in studio operation works on the whole photo: a dark background right next to the skin stays as a grey seam (outside the outline the projection ignores it).
- A generative clean-up may move or redraw lines and changes the image size; the warning and the before/after view are the check, nothing re-registers the edit to the photo.
- The parked answers live in memory: a reload while in the studio loses them, as it loses the wizard's answers today.
- The Advanced page shows no controls for `cleanup` and `cleaned`; they are kept there and can be edited in the YAML.
