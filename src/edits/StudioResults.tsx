// Result views of the Image studio (ImageEditPage.tsx): the version strip of a session, a result tile
// for the attempts grid and the focus view with before and after side by side. UI only; the rules
// live in session.ts and studio.ts.
import { assetImageUrl } from "../assets/types.ts";
import { versionLabel } from "./session.ts";
import { elapsedLabel, formatUsd, hasInput, hasResult } from "./studio.ts";
import { jobUrl, type EditJob } from "./types.ts";

export function resultUrl(job: EditJob): string {
  return job.kept ? assetImageUrl(job.kept.id) : `${jobUrl(job.id, "output")}?v=${job.finishedAt ?? ""}`;
}

export const STATE_LABEL: Record<EditJob["state"], string> = {
  running: "Working…",
  done: "Ready",
  failed: "Failed",
  cancelled: "Stopped",
  kept: "Saved",
  discarded: "Discarded",
};

const STATE_TONE: Record<EditJob["state"], string> = {
  running: "info",
  done: "plain",
  failed: "error",
  cancelled: "muted",
  kept: "ok",
  discarded: "muted",
};

/** What a result tile can do: stop a running edit, or make the result the next version. */
export type AttemptActions = {
  busy: boolean;
  /** Set when the result is already a version (its index): no pick button then. */
  versionIndex: number | null;
  onPick: () => void;
  onCancel: () => void;
};

function JobMeta({ job }: { job: EditJob }) {
  return (
    <p className="mono faint tile-meta">
      {job.tools.at(-1)} · {elapsedLabel(job)}
      {job.costUsd !== undefined && ` · ≈ ${formatUsd(job.costUsd)}`}
    </p>
  );
}

function AttemptButtons({ job, busy, versionIndex, onPick, onCancel }: { job: EditJob } & AttemptActions) {
  if (job.state === "running")
    return (
      <div className="tile-actions">
        <button type="button" className="small-button" onClick={onCancel} disabled={busy}>
          Stop
        </button>
      </div>
    );
  if (versionIndex !== null)
    return (
      <div className="tile-actions">
        <span className="chip ok">is {versionLabel(versionIndex)}</span>
      </div>
    );
  if (!hasResult(job)) return null;
  return (
    <div className="tile-actions">
      <button type="button" className="primary small-button" onClick={onPick} disabled={busy}>
        Continue with this
      </button>
    </div>
  );
}

function JobLog({ job }: { job: EditJob }) {
  if (job.log.length === 0 && job.state !== "running") return null;
  return (
    <details className="edit-log small" open={job.state === "running"}>
      <summary>
        Progress <span className="mono">{job.log.length}</span>
      </summary>
      <ol>
        {job.log.slice(-60).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </details>
  );
}

function JobNotes({ job }: { job: EditJob }) {
  return (
    <>
      {job.summary && job.state !== "running" && <p className="tile-text">{job.summary}</p>}
      {job.error && <p className="tile-text error-text">{job.error}</p>}
    </>
  );
}

export function JobTile({
  job,
  label,
  onFocus,
  ...actions
}: { job: EditJob; label: string; onFocus: () => void } & AttemptActions) {
  const result = hasResult(job);
  const picked = actions.versionIndex !== null;
  return (
    <li className={`studio-tile ${job.state}${picked ? " picked" : ""}`}>
      <div className="tile-head">
        <span className="tile-label">{label}</span>
        <span className="spacer" />
        <span className={`chip ${STATE_TONE[job.state]}`}>{STATE_LABEL[job.state]}</span>
      </div>
      {result ? (
        <button type="button" className="tile-image checker" onClick={onFocus} title="Show large">
          <img src={resultUrl(job)} alt="Result" loading="lazy" />
          {job.output && (
            <span className="tile-dims mono">
              {job.output.width} × {job.output.height}
              {job.output.alpha ? " · alpha" : ""}
            </span>
          )}
        </button>
      ) : (
        <div className={`tile-image tile-placeholder ${job.state}`}>
          {job.state === "running" ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span>{job.engine === "openai" ? "GPT Image is working…" : "Claude is working…"}</span>
              <span className="mono">{elapsedLabel(job)}</span>
              {job.log.at(-1) && <span className="faint tile-last-log">{job.log.at(-1)}</span>}
            </>
          ) : (
            <span className="faint">{STATE_LABEL[job.state]}</span>
          )}
        </div>
      )}
      <p className="tile-text tile-prompt" title={job.instructions.join("\n→ ")}>
        {job.instructions.at(-1) ?? ""}
      </p>
      <JobMeta job={job} />
      <JobNotes job={job} />
      <AttemptButtons job={job} {...actions} />
      <JobLog job={job} />
    </li>
  );
}

/** One result large: before and after side by side, with the full prompt chain and the actions. */
export function FocusView({ job, ...actions }: { job: EditJob } & AttemptActions) {
  const withInput = hasInput(job);
  return (
    <div className="studio-focus">
      <div className={`focus-pair${withInput ? "" : " single"}`}>
        {withInput && (
          <figure>
            <div className="checker">
              <img src={jobUrl(job.id, "input")} alt="Before" />
            </div>
            <figcaption>
              <span className="tile-label">Before</span>
            </figcaption>
          </figure>
        )}
        <figure>
          <div className="checker">
            <img src={resultUrl(job)} alt="After" />
          </div>
          <figcaption>
            <span className="tile-label">{withInput ? "After" : "New"}</span>
            {job.output && (
              <span className="mono faint">
                {job.output.width} × {job.output.height} px{job.output.alpha ? " · transparent" : ""}
              </span>
            )}
          </figcaption>
        </figure>
      </div>
      <div className="float focus-info">
        <div className="tile-head">
          <span className={`chip ${STATE_TONE[job.state]}`}>{STATE_LABEL[job.state]}</span>
          <JobMeta job={job} />
        </div>
        <ol className="edit-instructions">
          {job.instructions.map((s, i) => (
            <li key={i} className={i < job.instructions.length - 1 ? "faint" : ""}>
              {s}
            </li>
          ))}
        </ol>
        <JobNotes job={job} />
        <AttemptButtons job={job} {...actions} />
      </div>
    </div>
  );
}

export type StripVersion = {
  index: number;
  /** Image of the version; null for the blank artboard of a new image (v0). */
  src: string | null;
  /** Manifest id when the version is saved. */
  saved?: string;
  title: string;
};

/** The session's versions v0 … vN; the last one is where the next run starts. */
export function VersionStrip({
  versions,
  viewing,
  onView,
}: {
  versions: readonly StripVersion[];
  viewing: number;
  onView: (index: number) => void;
}) {
  const last = versions.length - 1;
  return (
    <ol className="studio-strip" aria-label="Versions">
      {versions.map((v) => (
        <li key={v.index} className={v.index === last ? "is-current" : undefined}>
          {v.index > 0 && (
            <span className="strip-arrow" aria-hidden="true">
              →
            </span>
          )}
          <button
            type="button"
            className={`strip-item${v.index === viewing ? " viewing" : ""}`}
            aria-pressed={v.index === viewing}
            title={v.title}
            onClick={() => onView(v.index)}
          >
            <span className="strip-thumb checker">
              {v.src ? <img src={v.src} alt="" /> : <span className="faint">blank</span>}
            </span>
            <span className="strip-label">
              <span className="mono">{versionLabel(v.index)}</span>
              {v.saved ? (
                <span className="strip-saved" title={`Saved as ${v.saved}`}>
                  saved
                </span>
              ) : v.index === 0 ? (
                <span className="faint">source</span>
              ) : null}
            </span>
            {v.index === last && <span className="strip-next">Next run starts here</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}
