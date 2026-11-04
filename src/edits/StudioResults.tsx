// Result views of the Image studio (ImageEditPage.tsx): a result tile for the variants grid and the
// focus view with before and after side by side. UI only; the rules live in studio.ts.
import { assetImageUrl } from "../assets/types.ts";
import { elapsedLabel, formatUsd, hasInput, hasResult } from "./studio.ts";
import { jobUrl, type EditJob } from "./types.ts";

export function resultUrl(job: EditJob): string {
  return job.kept ? assetImageUrl(job.kept.id) : `${jobUrl(job.id, "output")}?v=${job.finishedAt ?? ""}`;
}

export const STATE_LABEL: Record<EditJob["state"], string> = {
  running: "Working…",
  done: "Ready to review",
  failed: "Failed",
  cancelled: "Stopped",
  kept: "Kept",
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

export type JobActions = {
  busy: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  onRefine: () => void;
};

function JobMeta({ job }: { job: EditJob }) {
  return (
    <p className="mono faint tile-meta">
      {job.tools.at(-1)} · {elapsedLabel(job)}
      {job.costUsd !== undefined && ` · ≈ ${formatUsd(job.costUsd)}`}
    </p>
  );
}

function JobButtons({ job, busy, onKeep, onDiscard, onCancel, onRefine }: { job: EditJob } & JobActions) {
  return (
    <div className="tile-actions">
      {job.state === "running" && (
        <button type="button" className="small-button" onClick={onCancel} disabled={busy}>
          Stop
        </button>
      )}
      {job.state === "done" && (
        <button type="button" className="primary small-button" onClick={onKeep} disabled={busy}>
          Keep as new image
        </button>
      )}
      {hasResult(job) && (
        <button type="button" className="small-button" onClick={onRefine} disabled={busy}>
          Edit further
        </button>
      )}
      {job.state !== "running" && job.state !== "kept" && (
        <button type="button" className="ghost small-button" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
      )}
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
      {job.references && job.references.length > 0 && (
        <p className="tile-text faint">References: {job.references.join(", ")}</p>
      )}
      {job.summary && job.state !== "running" && <p className="tile-text">{job.summary}</p>}
      {job.error && <p className="tile-text error-text">{job.error}</p>}
      {job.kept && (
        <p className="tile-text">
          Saved as <code>{job.kept.id}</code> (<code>{job.kept.file}</code>). Assign it to a figure in the
          Layout tab’s Assets panel.
        </p>
      )}
    </>
  );
}

export function JobTile({
  job,
  label,
  compact = false,
  onFocus,
  ...actions
}: { job: EditJob; label: string; compact?: boolean; onFocus: () => void } & JobActions) {
  const result = hasResult(job);
  const prompt = job.instructions.at(-1) ?? "";
  return (
    <li className={`studio-tile ${job.state}${compact ? " compact" : ""}`}>
      <div className="tile-head">
        <span className="tile-label">{label}</span>
        <span className="spacer" />
        <span className={`chip ${STATE_TONE[job.state]}`}>{STATE_LABEL[job.state]}</span>
      </div>
      {result ? (
        <button type="button" className="tile-image checker" onClick={onFocus} title="Show large">
          <img src={resultUrl(job)} alt="After" loading="lazy" />
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
        {job.instructions.length > 1 && (
          <span className="faint">{job.instructions.length - 1} earlier · </span>
        )}
        {prompt}
      </p>
      <JobMeta job={job} />
      {!compact && <JobNotes job={job} />}
      {compact && job.kept && (
        <p className="tile-text faint">
          Saved as <code>{job.kept.id}</code>
        </p>
      )}
      <JobButtons job={job} {...actions} />
      {!compact && <JobLog job={job} />}
    </li>
  );
}

/** One result large: before and after side by side, with the full prompt chain and the actions. */
export function FocusView({ job, ...actions }: { job: EditJob } & JobActions) {
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
        <JobButtons job={job} {...actions} />
      </div>
    </div>
  );
}
