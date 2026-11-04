// "Edit images" tab: pick a reference image, say what to change, and let either `claude -p` on this
// Mac do it with local tools (ADR 0007) or GPT Image redraw it generatively (ADR 0008). Results are
// previews until kept; keeping writes a new image into edits/ and a new manifest entry, the original
// stays untouched. UI only: the rules live in edit.ts, openai.ts and the server.
import { useCallback, useEffect, useMemo, useState } from "react";
import { filterAssets, NO_FILTER } from "../assets/filter.ts";
import { announceManifestChanged, useAssetListing } from "../assets/useAssets.ts";
import { assetImageUrl, type AssetInfo } from "../assets/types.ts";
import { rootAssetId } from "./edit.ts";
import {
  EDIT_PRESETS,
  EDITS_ENDPOINT,
  jobUrl,
  MAX_VARIANTS_PER_RUN,
  type EditEngine,
  type EditJob,
  type EditOverview,
} from "./types.ts";

/** Running limits per engine; the server enforces the same numbers. */
const MAX_RUNNING: Record<EditEngine, number> = { claude: 2, openai: 4 };

async function call<T>(url: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}

function useEditOverview(): { overview: EditOverview | null; error: string | null; refresh: () => void } {
  const [overview, setOverview] = useState<EditOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const running = overview?.jobs.some((j) => j.state === "running") ?? false;
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      call<EditOverview>(EDITS_ENDPOINT).then(
        (o) => {
          if (cancelled) return;
          setOverview(o);
          setError(null);
        },
        (e: unknown) =>
          !cancelled &&
          setError(`Cannot reach the edit service (${String(e)}). It runs only under npm run dev.`),
      );
    void load();
    const timer = running ? setInterval(() => void load(), 1500) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [tick, running]);
  return { overview, error, refresh };
}

export function ImageEditPage() {
  const { listing, reload } = useAssetListing();
  const { overview, error: serviceError, refresh } = useEditOverview();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [refineFrom, setRefineFrom] = useState<EditJob | null>(null);
  const [engine, setEngine] = useState<EditEngine>("claude");
  const [variants, setVariants] = useState(2);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const assets = useMemo(
    () => (listing?.status === "ok" ? listing.assets.filter((a) => a.exists) : []),
    [listing],
  );
  const shown = useMemo(() => filterAssets(assets, { ...NO_FILTER, text: search }), [assets, search]);
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const root = selected ? rootAssetId(selected) : null;
  const jobs = (overview?.jobs ?? []).filter((j) => j.assetId === root).toReversed();
  const availability = engine === "openai" ? overview?.generative : overview?.availability;
  const runningCount = overview?.jobs.filter((j) => j.state === "running" && j.engine === engine).length ?? 0;
  const count = engine === "openai" ? Math.max(1, Math.min(variants, MAX_RUNNING.openai - runningCount)) : 1;

  const select = (a: AssetInfo) => {
    setSelectedId(a.id);
    setRefineFrom(null);
    setActionError(null);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const start = () =>
    act(async () => {
      if (!selected) return;
      const body = {
        assetId: selected.id,
        instruction,
        engine,
        ...(refineFrom ? { fromJob: refineFrom.id } : {}),
      };
      // Each generative variant is its own request and its own result.
      await Promise.all(Array.from({ length: count }, () => call<EditJob>(EDITS_ENDPOINT, "POST", body)));
      setInstruction("");
      setRefineFrom(null);
    });

  const keep = (job: EditJob) =>
    act(async () => {
      await call<EditJob>(jobUrl(job.id, "keep"), "POST");
      announceManifestChanged();
      reload();
    });

  if (!listing) return <p className="muted">Loading the image list…</p>;
  // Without a readable data folder there is nothing to pick: one empty state instead of two panels.
  if (listing.status !== "ok")
    return (
      <section className="empty">
        <h2>{listing.status === "unset" ? "No images to edit" : "The image list cannot be read"}</h2>
        <p>
          {listing.status === "unset" ? (
            <>
              Reference images live in the data folder, and <code>TATTOO_DATA_DIR</code> is not set. Once it
              is, pick an image here and describe the change; Claude Code edits it on this Mac.
            </>
          ) : (
            listing.message
          )}
        </p>
        <a className="button primary" href="#data">
          Set up the data folder
        </a>
      </section>
    );

  let picker: React.ReactNode;
  if (assets.length === 0)
    picker = (
      <div className="empty small">
        <p>
          No images in the manifest yet. Run <code>npm run assets:scan</code> after adding files to the data
          folder, then Reload.
        </p>
      </div>
    );
  else
    picker = (
      <>
        <input
          type="search"
          placeholder="Search id, notes, source"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search images"
        />
        <p className="faint small edit-count">
          {shown.length === assets.length ? `${assets.length} images` : `${shown.length} of ${assets.length}`}
        </p>
        {shown.length === 0 ? (
          <p className="muted small">No image matches “{search}”.</p>
        ) : (
          <ul className="asset-grid">
            {shown.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`asset-card${a.id === selectedId ? " current" : ""}`}
                  aria-pressed={a.id === selectedId}
                  title={[a.id, a.file, a.notes].filter(Boolean).join("\n")}
                  onClick={() => select(a)}
                >
                  <img src={assetImageUrl(a.id)} alt="" loading="lazy" decoding="async" />
                  <span className="asset-id">{a.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    );

  const canRun =
    !!selected &&
    !!instruction.trim() &&
    !busy &&
    availability?.enabled === true &&
    runningCount < MAX_RUNNING[engine];
  const engineLabel = availability?.enabled
    ? "claude" in availability
      ? availability.claude
      : availability.model
    : null;

  return (
    <div className="edit-page">
      <section className="panel edit-picker" aria-label="Images">
        <div className="panel-head">
          <h2>Images</h2>
          <button type="button" className="ghost" onClick={reload} title="Re-read manifest.yaml">
            Reload
          </button>
        </div>
        {picker}
      </section>

      <section className="panel edit-main" aria-label="Edit">
        <div className="panel-head">
          <h2>{selected ? selected.id : "Edit an image"}</h2>
          {engineLabel && (
            <span
              className="chip ok"
              title={
                engine === "openai"
                  ? "Generative edits via the OpenAI API"
                  : "Claude Code runs the edits on this Mac"
              }
            >
              {engineLabel}
            </span>
          )}
        </div>
        {(serviceError || (availability && !availability.enabled)) && (
          <div className="notices">
            {serviceError && <p className="notice error">{serviceError}</p>}
            {availability && !availability.enabled && <p className="notice warn">{availability.reason}</p>}
          </div>
        )}
        {!selected ? (
          <div className="empty small edit-hint">
            <h2>Pick an image on the left</h2>
            <p>
              Then describe the change. <strong>Local</strong> edits (remove the background, crop, contrast)
              run on this Mac with Claude Code and local tools and keep the pixels as they are.{" "}
              <strong>Generative</strong> edits (fewer snakes, move the skull, fill in behind a hand) are
              redrawn by GPT Image through the OpenAI API. The original stays as it is and each result is a
              preview until you keep it.
            </p>
          </div>
        ) : (
          <>
            <div className="edit-compose">
              <figure className="edit-source">
                <div className="checker">
                  <img
                    src={
                      refineFrom
                        ? `${jobUrl(refineFrom.id, "output")}?v=${refineFrom.finishedAt ?? ""}`
                        : assetImageUrl(selected.id)
                    }
                    alt="Image to edit"
                  />
                </div>
                <figcaption className="small muted">
                  {refineFrom ? "Editing the result of the edit below" : `${selected.file}`}
                  {selected.derived_from && !refineFrom && <> · edit of {selected.derived_from}</>}
                </figcaption>
              </figure>
              <div className="edit-form">
                <div className="edit-engine" role="radiogroup" aria-label="Engine">
                  <label>
                    <input
                      type="radio"
                      name="edit-engine"
                      checked={engine === "claude"}
                      onChange={() => setEngine("claude")}
                    />{" "}
                    Local (Claude, keeps the pixels)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="edit-engine"
                      checked={engine === "openai"}
                      onChange={() => setEngine("openai")}
                    />{" "}
                    Generative (GPT Image, redraws)
                  </label>
                  {engine === "openai" && (
                    <label className="small">
                      Variants{" "}
                      <select value={variants} onChange={(e) => setVariants(Number(e.target.value))}>
                        {Array.from({ length: MAX_VARIANTS_PER_RUN }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="edit-presets" role="group" aria-label="Presets">
                  {EDIT_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="chip"
                      title={p.engine === "openai" ? "Generative: switches to GPT Image" : undefined}
                      onClick={() => {
                        setInstruction(p.instruction);
                        if (p.engine) setEngine(p.engine);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <label className="section-label" htmlFor="edit-instruction">
                  What should change?
                </label>
                <textarea
                  id="edit-instruction"
                  rows={5}
                  value={instruction}
                  maxLength={2000}
                  placeholder={
                    engine === "openai"
                      ? "e.g. Fewer snakes in the hair, and the skull separate from the face (German is fine)."
                      : "e.g. Remove the background and the text at the bottom; keep the snake's tail."
                  }
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun) void start();
                  }}
                />
                <div className="toolbar">
                  <button type="button" className="primary" disabled={!canRun} onClick={() => void start()}>
                    {refineFrom
                      ? "Edit the result"
                      : engine === "openai"
                        ? count > 1
                          ? `Make ${count} variants`
                          : "Edit with GPT Image"
                        : "Edit with Claude"}
                  </button>
                  {refineFrom && (
                    <button type="button" onClick={() => setRefineFrom(null)}>
                      Start from the original instead
                    </button>
                  )}
                  <span className="muted small">
                    {runningCount >= MAX_RUNNING[engine]
                      ? `${MAX_RUNNING[engine]} edits are running; wait for one.`
                      : engine === "openai"
                        ? "⌘/Ctrl + Enter · about 1 min · a few cents each"
                        : "⌘/Ctrl + Enter · takes 1–5 min"}
                  </span>
                </div>
                {actionError && <p className="error-text small">{actionError}</p>}
              </div>
            </div>

            {jobs.length > 0 && <h3 className="section-label edit-results-head">Results ({jobs.length})</h3>}
            <ul className="edit-jobs">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  busy={busy}
                  onKeep={() => void keep(job)}
                  onDiscard={() => void act(() => call(jobUrl(job.id, "discard"), "POST"))}
                  onCancel={() => void act(() => call(jobUrl(job.id, "cancel"), "POST"))}
                  onRefine={() => {
                    setRefineFrom(job);
                    setInstruction("");
                    document.getElementById("edit-instruction")?.focus();
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

const STATE_LABEL: Record<EditJob["state"], string> = {
  running: "Working…",
  done: "Ready to review",
  failed: "Failed",
  cancelled: "Stopped",
  kept: "Kept",
  discarded: "Discarded",
};

function elapsed(job: EditJob): string {
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function JobCard({
  job,
  busy,
  onKeep,
  onDiscard,
  onCancel,
  onRefine,
}: {
  job: EditJob;
  busy: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  onRefine: () => void;
}) {
  const hasResult = job.state === "done" || job.state === "kept";
  const resultSrc = job.kept
    ? assetImageUrl(job.kept.id)
    : `${jobUrl(job.id, "output")}?v=${job.finishedAt ?? ""}`;
  return (
    <li className={`card edit-job ${job.state}`}>
      <div className="edit-job-head">
        <strong>
          {job.state === "running"
            ? job.engine === "openai"
              ? "GPT Image is working…"
              : "Claude is working…"
            : STATE_LABEL[job.state]}
        </strong>
        <span className="muted small">
          {job.tools.at(-1)} · {elapsed(job)}
          {job.costUsd !== undefined && ` · ≈ $${job.costUsd.toFixed(2)}`}
        </span>
      </div>
      <ol className="edit-instructions small">
        {job.instructions.map((s, i) => (
          <li key={i} className={i < job.instructions.length - 1 ? "muted" : ""}>
            {s}
          </li>
        ))}
      </ol>
      {hasResult && (
        <div className="edit-compare">
          <figure>
            <div className="checker">
              <img src={jobUrl(job.id, "input")} alt="Before" loading="lazy" />
            </div>
            <figcaption className="small muted">before</figcaption>
          </figure>
          <figure>
            <div className="checker">
              <img src={resultSrc} alt="After" />
            </div>
            <figcaption className="small muted">
              after
              {job.output &&
                ` · ${job.output.width} × ${job.output.height} px${job.output.alpha ? " · transparent" : ""}`}
            </figcaption>
          </figure>
        </div>
      )}
      {job.summary && job.state !== "running" && <p className="small">{job.summary}</p>}
      {job.error && <p className="small error-text">{job.error}</p>}
      {job.kept && (
        <p className="small">
          Saved as <code>{job.kept.id}</code> (<code>{job.kept.file}</code>). Assign it to a figure in the
          Layout tab’s Assets panel.
        </p>
      )}
      {(job.log.length > 0 || job.state === "running") && (
        <details className="edit-log small" open={job.state === "running"}>
          <summary>Progress ({job.log.length})</summary>
          <ol>
            {job.log.slice(-60).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </details>
      )}
      <div className="toolbar">
        {job.state === "running" && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Stop
          </button>
        )}
        {job.state === "done" && (
          <button type="button" className="primary" onClick={onKeep} disabled={busy}>
            Keep as new image
          </button>
        )}
        {hasResult && (
          <button type="button" onClick={onRefine} disabled={busy}>
            Edit further
          </button>
        )}
        {job.state !== "running" && job.state !== "kept" && (
          <button type="button" className="ghost" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
        )}
      </div>
    </li>
  );
}
