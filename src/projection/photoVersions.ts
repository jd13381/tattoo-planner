// A body photo and its edits from the Image studio as one stack (docs/adr/0024-projection-workspace.md,
// "Picture and frame"): the photo picker shows each photo once with its versions on it, and picking a
// version keeps the original as the frame (`file`: the points are placed on it) and uses the edit's
// pixels (`cleaned`). Pure functions over manifest entries.
import { fileKey } from "../assets/manifestDoc.ts";
import type { PhotoPick } from "./draft.ts";

type AssetLike = { id: string; file: string; derived_from?: string; exists?: boolean };

/** An original photo and its saved edits, newest first. */
export type PhotoStack<A extends AssetLike> = { root: A; edits: A[] };

/** The original an image was made from (an edit of an edit names the original too, ADR 0010). */
export function rootOf<A extends AssetLike>(asset: A, byId: ReadonlyMap<string, A>): A {
  return (asset.derived_from && byId.get(asset.derived_from)) || asset;
}

/**
 * The stacks of these photos: each with every existing image whose `derived_from` names it, newest
 * first (the manifest lists edits in the order they were saved).
 */
export function photoStacks<A extends AssetLike>(roots: readonly A[], all: readonly A[]): PhotoStack<A>[] {
  return roots.map((root) => ({
    root,
    edits: all.filter((a) => a.derived_from === root.id && a.id !== root.id && a.exists !== false).reverse(),
  }));
}

/** Ids of every edit in the stacks (so the picker does not list them a second time). */
export function stackedIds<A extends AssetLike>(stacks: readonly PhotoStack<A>[]): Set<string> {
  return new Set(stacks.flatMap((s) => s.edits.map((e) => e.id)));
}

/** All versions of a stack, the original first. */
export const versionsOf = <A extends AssetLike>(stack: PhotoStack<A>): A[] => [stack.root, ...stack.edits];

/** The pick for a version: the original as the frame, the edit (if it is one) as the pixels. */
export function pickFor<A extends AssetLike>(stack: PhotoStack<A>, version: A): PhotoPick {
  return { file: stack.root.file, cleaned: version.id === stack.root.id ? null : version.file };
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && fileKey(a) === fileKey(b);

/** Index of the pick that uses this stack (its original as the frame, or one of its edits), or -1. */
export function pickIndex<A extends AssetLike>(stack: PhotoStack<A>, picks: readonly PhotoPick[]): number {
  return picks.findIndex(
    (p) => same(p.file, stack.root.file) || stack.edits.some((e) => same(p.file, e.file)),
  );
}

/** The version of the stack that is picked, or null when the stack is not picked. */
export function pickedVersion<A extends AssetLike>(stack: PhotoStack<A>, picks: readonly PhotoPick[]): A | null {
  const pick = picks[pickIndex(stack, picks)];
  if (!pick) return null;
  // An older file may name an edit as the photo itself; then that edit is what it shows.
  const shown = pick.cleaned ?? pick.file;
  return versionsOf(stack).find((v) => same(v.file, shown)) ?? stack.root;
}

/**
 * Clicking a version: picks the stack with it (at the end), switches a picked stack to it, or unpicks
 * the stack when this version is the one picked.
 */
export function togglePick<A extends AssetLike>(
  stack: PhotoStack<A>,
  version: A,
  picks: readonly PhotoPick[],
): PhotoPick[] {
  const i = pickIndex(stack, picks);
  if (i < 0) return [...picks, pickFor(stack, version)];
  if (pickedVersion(stack, picks)?.id === version.id) return picks.filter((_, k) => k !== i);
  // Another version of a picked photo: same place in the order. A frame that named an edit stays,
  // so its points stay valid; only the pixels change.
  const old = picks[i]!;
  const next = same(old.file, stack.root.file)
    ? pickFor(stack, version)
    : { file: old.file, cleaned: same(old.file, version.file) ? null : version.file };
  return picks.map((p, k) => (k === i ? next : p));
}
