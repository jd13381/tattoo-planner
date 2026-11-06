// Size and position of the "Change image" picker (src/assets/ImagePicker.tsx): as large as the
// window allows up to a comfortable maximum, beside the button that opened it.

/** Largest picker, px: about five 140 px thumbnails across and four rows down. */
export const PICKER_MAX = { width: 760, height: 680 } as const;
export const PICKER_MARGIN = 8;

export type Box = { left: number; top: number; width: number; height: number };

/**
 * The picker's box for an anchor (the button's rectangle) in a viewport of vw × vh: it shrinks to fit
 * the window, sits left of the anchor when there is room (the inspector is on the right), else right
 * of it, else as far right as fits, and its top follows the anchor within the window.
 */
export function pickerBox(anchor: { left: number; right: number; top: number }, vw: number, vh: number): Box {
  const m = PICKER_MARGIN;
  const width = Math.max(0, Math.min(PICKER_MAX.width, vw - 2 * m));
  const height = Math.max(0, Math.min(PICKER_MAX.height, vh - 2 * m));
  let left = anchor.left - width - m;
  if (left < m) left = anchor.right + m;
  left = Math.max(m, Math.min(left, vw - width - m));
  const top = Math.max(m, Math.min(anchor.top - 40, vh - height - m));
  return { left, top, width, height };
}
