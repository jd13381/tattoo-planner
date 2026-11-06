// Multi-selection of the Assets grid, as in Photos on the iPhone and the Mac: a click toggles in
// select mode, shift-click selects the range from the last clicked image, cmd/ctrl-click toggles
// (and enters select mode), Cmd+A selects what is visible. Pure state transitions; the grid is thin.

export type Selection = {
  /** Select mode is on: a click toggles instead of opening the detail. */
  active: boolean;
  /** Selected ids, in the order they were added. */
  ids: readonly string[];
  /** The last clicked id: shift-click selects from here. */
  anchor: string | null;
};

export const NO_SELECTION: Selection = { active: false, ids: [], anchor: null };

export function startSelecting(s: Selection): Selection {
  return s.active ? s : { ...s, active: true };
}

/** Leaves select mode and drops the selection. */
export function stopSelecting(): Selection {
  return NO_SELECTION;
}

export function isSelected(s: Selection, id: string): boolean {
  return s.ids.includes(id);
}

/** Adds or removes one id; enters select mode. */
export function toggle(s: Selection, id: string): Selection {
  const ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id];
  return { active: true, ids, anchor: id };
}

/**
 * Shift-click: selects every visible id between the anchor and `id` (inclusive), keeping what was
 * selected before. Without an anchor in view it toggles `id`.
 */
export function selectRange(s: Selection, visible: readonly string[], id: string): Selection {
  const from = s.anchor ? visible.indexOf(s.anchor) : -1;
  const to = visible.indexOf(id);
  if (from < 0 || to < 0) return toggle(s, id);
  const [a, b] = from <= to ? [from, to] : [to, from];
  const range = visible.slice(a, b + 1);
  const ids = [...s.ids, ...range.filter((x) => !s.ids.includes(x))];
  return { active: true, ids, anchor: id };
}

/** Cmd+A: every visible id; when all are selected already, none. */
export function selectAll(s: Selection, visible: readonly string[]): Selection {
  const all = visible.length > 0 && visible.every((id) => s.ids.includes(id));
  return { active: true, ids: all ? [] : [...visible], anchor: s.anchor };
}

/** Drops ids that no longer exist (after a delete or a reload); keeps select mode. */
export function prune(s: Selection, existing: readonly string[]): Selection {
  const keep = new Set(existing);
  const ids = s.ids.filter((id) => keep.has(id));
  const anchor = s.anchor && keep.has(s.anchor) ? s.anchor : null;
  return ids.length === s.ids.length && anchor === s.anchor ? s : { ...s, ids, anchor };
}

/** Selects exactly these ids (new cards after a drop), in select mode. */
export function selectOnly(ids: readonly string[]): Selection {
  return { active: true, ids: [...ids], anchor: ids.at(-1) ?? null };
}

/**
 * The id to focus after `removed` left the visible list: the next one after the first removed id,
 * else the one before, else null.
 */
export function focusAfterRemoval(visible: readonly string[], removed: readonly string[]): string | null {
  const gone = new Set(removed);
  const first = visible.findIndex((id) => gone.has(id));
  if (first < 0) return null;
  for (let i = first + 1; i < visible.length; i++) if (!gone.has(visible[i]!)) return visible[i]!;
  for (let i = first - 1; i >= 0; i--) if (!gone.has(visible[i]!)) return visible[i]!;
  return null;
}

/** Index of the card a grid arrow key moves to (columns: cards per row). */
export function moveFocus(
  index: number,
  count: number,
  columns: number,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End",
): number {
  if (count === 0) return -1;
  const cols = Math.max(1, columns);
  const next =
    key === "ArrowLeft"
      ? index - 1
      : key === "ArrowRight"
        ? index + 1
        : key === "ArrowUp"
          ? index - cols
          : key === "ArrowDown"
            ? index + cols
            : key === "Home"
              ? 0
              : count - 1;
  if (next < 0 || next >= count) return Math.min(Math.max(index, 0), count - 1);
  return next;
}
