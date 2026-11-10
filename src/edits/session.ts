// Framework-free rules of an Image studio editing session (docs/adr/0010-editing-sessions.md): a
// source (v0) and a linear stack of versions v1 … vN, each the result of one job. Every run starts from
// the last version; picking a result makes it the next version; picking a result of an earlier
// version drops the versions after it. Used by the dev server (which owns the sessions) and the page.
import type { Asset } from "../assets/manifest.ts";
import { rootAssetId } from "./edit.ts";
import type { EditJob, EditSession } from "./types.ts";

/** "v0", "v1", … */
export function versionLabel(index: number): string {
  return `v${index}`;
}

/**
 * Index of the version a job started from: 0 when it ran on the source, k when it ran on the result
 * of `versions[k-1]`. Null when its source is no longer part of the stack (dropped by an earlier pick).
 */
export function parentIndex(versions: readonly string[], job: Pick<EditJob, "fromJob">): number | null {
  if (job.fromJob === undefined) return 0;
  const i = versions.indexOf(job.fromJob);
  return i === -1 ? null : i + 1;
}

/** The jobs of a session, in the order they were started. */
export function sessionJobs(jobs: readonly EditJob[], sessionId: string): EditJob[] {
  return jobs
    .filter((j) => j.session === sessionId)
    .toSorted((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}

/** The attempts made from version `index`, oldest first. */
export function attemptsFrom(session: EditSession, jobs: readonly EditJob[], index: number): EditJob[] {
  return sessionJobs(jobs, session.id).filter((j) => parentIndex(session.versions, j) === index);
}

export type PickResult =
  | { ok: true; versions: string[]; /** Versions that the pick removes from the stack. */ dropped: number }
  | { ok: false; message: string };

/** Makes a job's result the version after the one it started from; later versions are dropped. */
export function pickVersion(
  versions: readonly string[],
  job: Pick<EditJob, "id" | "fromJob" | "state">,
): PickResult {
  if (job.state !== "done" && job.state !== "kept")
    return { ok: false, message: "only a finished result can become a version" };
  const k = parentIndex(versions, job);
  if (k === null) return { ok: false, message: "the image this result started from is no longer a version" };
  if (versions[k] === job.id) return { ok: true, versions: [...versions], dropped: 0 };
  return { ok: true, versions: [...versions.slice(0, k), job.id], dropped: versions.length - k };
}

/** Keeps v0 … v`index` and drops the later versions ("Continue from vK"). */
export function truncateVersions(versions: readonly string[], index: number): string[] {
  return versions.slice(0, Math.max(0, Math.min(index, versions.length)));
}

/** What the next run of a session starts from. */
export type RunSource =
  | { kind: "asset"; assetId: string }
  | { kind: "job"; jobId: string }
  | { kind: "blank"; create: NonNullable<EditSession["create"]> };

export function runSource(session: EditSession): RunSource {
  const last = session.versions.at(-1);
  if (last !== undefined) return { kind: "job", jobId: last };
  if (session.mode === "create" && session.create) return { kind: "blank", create: session.create };
  if (session.assetId !== undefined) return { kind: "asset", assetId: session.assetId };
  throw new Error(`session ${session.id} has no source`);
}

/** The open session on an image, if any (at most one per image). */
export function sessionForAsset(sessions: readonly EditSession[], assetId: string): EditSession | null {
  return sessions.find((s) => s.mode === "edit" && s.assetId === assetId) ?? null;
}

/** What closing a session without saving would lose. */
export function unsavedWork(
  session: EditSession,
  jobs: readonly EditJob[],
): { versions: number; results: number; running: number } {
  const own = sessionJobs(jobs, session.id);
  const byId = new Map(own.map((j) => [j.id, j]));
  const versions = session.versions.filter((id) => byId.get(id)?.state !== "kept").length;
  const inStack = new Set(session.versions);
  const results = own.filter((j) => !inStack.has(j.id) && j.state === "done").length;
  const running = own.filter((j) => j.state === "running").length;
  return { versions, results, running };
}

/** Question before "Close" (null when nothing would be lost). */
export function closeQuestion(work: ReturnType<typeof unsavedWork>): string | null {
  const parts = [
    work.versions > 0 && `${work.versions} unsaved version${work.versions === 1 ? "" : "s"}`,
    work.results > 0 && `${work.results} other result${work.results === 1 ? "" : "s"}`,
    work.running > 0 && `${work.running} running edit${work.running === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length === 0 ? null : `Close without saving? This drops ${parts.join(", ")}.`;
}

/** Question before a pick or "Continue from" that drops later versions (null when none are dropped). */
export function dropQuestion(fromIndex: number, lastIndex: number): string | null {
  if (lastIndex < fromIndex) return null;
  // Plain words, as everywhere in the studio (src/edits/studioWords.ts): "Version 2", "Versions 1 to 3".
  const range = fromIndex === lastIndex ? `Version ${fromIndex}` : `Versions ${fromIndex} to ${lastIndex}`;
  return `${range} will be dropped from this session. Continue?`;
}

/** The image and its saved edits ("Versions of medusa"): the original first, then by id. */
export function familyOf<T extends Pick<Asset, "id" | "derived_from">>(
  assets: readonly T[],
  id: string,
): T[] {
  const asset = assets.find((a) => a.id === id);
  if (!asset) return [];
  const root = rootAssetId(asset);
  return assets
    .filter((a) => rootAssetId(a) === root)
    .toSorted((a, b) =>
      a.id === root ? -1 : b.id === root ? 1 : a.id.localeCompare(b.id, "en", { numeric: true }),
    );
}
