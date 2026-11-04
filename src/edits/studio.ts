// Framework-free view rules for the Image studio tab: which results form the current round, what the
// run button says, what a run costs and how large the artboard of a new image is. The page
// (ImageEditPage.tsx) only renders these.
import type { CreateSize, EditEngine, EditJob } from "./types.ts";

/** States that still need a look or a decision; the rest are history. */
const OPEN_STATES: ReadonlySet<EditJob["state"]> = new Set(["running", "done", "failed"]);

/**
 * Splits results (newest first, as the page lists them) into the open round, oldest first so that
 * variants read 1, 2, 3 from the left, and the earlier results (kept, discarded, stopped), newest first.
 */
export function splitRound(jobsNewestFirst: readonly EditJob[]): { open: EditJob[]; earlier: EditJob[] } {
  const open = jobsNewestFirst.filter((j) => OPEN_STATES.has(j.state)).toReversed();
  const earlier = jobsNewestFirst.filter((j) => !OPEN_STATES.has(j.state));
  return { open, earlier };
}

/** Whether a job has a result image to show. */
export function hasResult(job: EditJob): boolean {
  return job.state === "done" || job.state === "kept";
}

/** Whether a job has an image it started from (a new image has none until it is edited further). */
export function hasInput(job: EditJob): boolean {
  return !(job.created && job.fromJob === undefined);
}

/** Sum of the reported costs, or null when no job reported one. */
export function spentUsd(jobs: readonly EditJob[]): number | null {
  const costs = jobs.flatMap((j) => (j.costUsd === undefined ? [] : [j.costUsd]));
  return costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0);
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export type RunContext = {
  /** Mode "create" without a result to edit further. */
  creatingNew: boolean;
  /** Editing a result further. */
  refining: boolean;
  engine: EditEngine;
  /** Jobs one click starts. */
  count: number;
};

/** Text of the run button. */
export function runLabel(c: RunContext): string {
  if (c.creatingNew) return c.count > 1 ? `Create ${c.count} variants` : "Create with GPT Image";
  if (c.refining) return "Edit the result";
  if (c.engine === "openai") return c.count > 1 ? `Make ${c.count} variants` : "Edit with GPT Image";
  return "Edit with Claude";
}

/** The time and cost line under the run button. */
export function runEstimate(engine: EditEngine, count: number): string {
  return engine === "openai"
    ? `${count} × GPT Image · ~1 min · a few cents each`
    : "Claude Code on this Mac · 1–5 min · no API cost";
}

/** Width / height of the artboard drawn for a new image before it exists ("auto" shows a square). */
export function artboardAspect(size: CreateSize): number {
  if (size === "auto") return 1;
  const [w, h] = size.split("x").map(Number) as [number, number];
  return w / h;
}

/** Duration since start (or until finish) as "42 s" or "2 min 5 s". */
export function elapsedLabel(job: Pick<EditJob, "startedAt" | "finishedAt">, now = Date.now()): string {
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** The neighbour of `id` in `ids` (wrapping), for stepping through results in the focus view. */
export function stepId(ids: readonly string[], id: string, delta: 1 | -1): string | null {
  const i = ids.indexOf(id);
  if (i === -1 || ids.length === 0) return null;
  return ids[(i + delta + ids.length) % ids.length] ?? null;
}
