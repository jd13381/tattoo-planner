// The one-line summary under the Compare toolbar: how many elements differ and how the open skin of
// the whole arm changes from A to B ("3 elements differ · open skin 59 % → 52 %").
import { sharePct, type Coverage } from "../metrics/coverage.ts";
import type { LayoutDiff } from "./diff.ts";

export type CompareSummary = {
  /** Elements only in A, only in B, or in both with different values. */
  differing: number;
  /** Whole-arm open skin in whole percent, as the coverage tables show it; null without coverage. */
  open: { a: number; b: number } | null;
  text: string;
};

export function compareSummary(
  diff: LayoutDiff,
  covA: Coverage | null,
  covB: Coverage | null,
): CompareSummary {
  const differing = diff.onlyA.length + diff.onlyB.length + diff.changed.length;
  const parts = [
    differing === 0 ? "Same elements" : `${differing} element${differing === 1 ? " differs" : "s differ"}`,
  ];
  const open = covA && covB ? { a: sharePct(covA.total, "open"), b: sharePct(covB.total, "open") } : null;
  if (open)
    parts.push(open.a === open.b ? `open skin ${open.a} % in both` : `open skin ${open.a} % → ${open.b} %`);
  return { differing, open, text: parts.join(" · ") };
}
