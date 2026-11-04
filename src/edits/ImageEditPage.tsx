// "Image studio" tab. Edit: pick a reference image, say what to change, and let either `claude -p` on
// this Mac do it with local tools (ADR 0007) or GPT Image redraw it (ADR 0008). Create: describe a new
// motif or pattern and let GPT Image draw it (ADR 0009). With GPT Image, assets can be attached as
// reference images. Results are previews until kept; keeping writes a new image into edits/ or
// generated/ and a new manifest entry, originals stay untouched. UI only: the rules live in edit.ts,
// openai.ts, studio.ts and the server.
//
// Layout (full-bleed workspace): asset browser | canvas (source, variants grid, focus view) | inspector.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { facets, filterAssets, NO_FILTER, type AssetFilter } from "../assets/filter.ts";
import { announceManifestChanged, useAssetListing } from "../assets/useAssets.ts";
import { assetImageUrl, type AssetInfo } from "../assets/types.ts";
import { rootAssetId, showInStudio, staleJobs } from "./edit.ts";
import { FocusView, JobTile } from "./StudioResults.tsx";
import {
  artboardAspect,
  formatUsd,
  hasResult,
  runEstimate,
  runLabel,
  spentUsd,
  splitRound,
  stepId,
} from "./studio.ts";
import {
  CREATE_BACKGROUNDS,
  CREATE_SIZES,
  EDIT_PRESETS,
  EDITS_ENDPOINT,
  jobUrl,
  MAX_VARIANTS_PER_RUN,
  type CreateBackground,
  type CreateSize,
  type EditEngine,
  type EditJob,
  type EditMode,
  type EditOverview,
  type EditRequest,
} from "./types.ts";

/** Running limits per engine; the server enforces the same numbers. */
const MAX_RUNNING: Record<EditEngine, number> = { claude: 2, openai: 4 };
/** Reference images per request; the server enforces the same number (MAX_REFERENCES). */
const MAX_REFS = 4;
const VARIANT_CHOICES = Array.from({ length: MAX_VARIANTS_PER_RUN }, (_, i) => i + 1);

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
  const [filter, setFilter] = useState<AssetFilter>(NO_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [refineFrom, setRefineFrom] = useState<EditJob | null>(null);
  const [engine, setEngine] = useState<EditEngine>("claude");
  const [variants, setVariants] = useState(2);
  const [mode, setMode] = useState<EditMode>("edit");
  const [references, setReferences] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [size, setSize] = useState<CreateSize>("1024x1024");
  const [background, setBackground] = useState<CreateBackground>("transparent");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Canvas view: the job shown large (focus view), whether the grid shows the source, the backdrop.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(true);
  const [backdrop, setBackdrop] = useState<"light" | "dark">("light");

  const assets = useMemo(
    () => (listing?.status === "ok" ? listing.assets.filter((a) => a.exists && showInStudio(a)) : []),
    [listing],
  );
  const kinds = useMemo(() => facets(assets.map((a) => a.kind)), [assets]);
  const tags = useMemo(() => facets(assets.flatMap((a) => a.tags)), [assets]);
  const shown = useMemo(() => filterAssets(assets, filter), [assets, filter]);
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const root = selected ? rootAssetId(selected) : null;
  // A new image (create, not yet edited further) is always drawn by GPT Image.
  const creatingNew = mode === "create" && !refineFrom;
  const activeEngine: EditEngine = creatingNew ? "openai" : engine;
  const jobs = (overview?.jobs ?? [])
    .filter((j) => (mode === "create" ? !!j.created : !j.created && j.assetId === root))
    .toReversed();
  const { open: openJobs, earlier } = splitRound(jobs);
  const focusJob = jobs.find((j) => j.id === focusId) ?? null;
  const availability = activeEngine === "openai" ? overview?.generative : overview?.availability;
  const runningCount =
    overview?.jobs.filter((j) => j.state === "running" && j.engine === activeEngine).length ?? 0;
  const count =
    activeEngine === "openai" ? Math.max(1, Math.min(variants, MAX_RUNNING.openai - runningCount)) : 1;
  const usesRefs = activeEngine === "openai";
  const spent = spentUsd(jobs);
  const toggleReference = (id: string) =>
    setReferences((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length < MAX_REFS ? [...r, id] : r));
  const switchMode = (m: EditMode) => {
    setMode(m);
    setRefineFrom(null);
    setActionError(null);
    setFocusId(null);
  };

  const select = (a: AssetInfo) => {
    setSelectedId(a.id);
    setRefineFrom(null);
    setActionError(null);
    setFocusId(null);
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
      if (!creatingNew && !refineFrom && !selected) return;
      const body: EditRequest = {
        instruction,
        engine: activeEngine,
        ...(creatingNew
          ? { mode: "create", name, size, background }
          : refineFrom
            ? { fromJob: refineFrom.id }
            : { assetId: selected!.id }),
        ...(usesRefs && references.length > 0 ? { references } : {}),
      };
      // Each generative variant is its own request and its own result.
      const started = await Promise.all(
        Array.from({ length: count }, () => call<EditJob>(EDITS_ENDPOINT, "POST", body)),
      );
      // "Edit further" starts a new round from one result: the other unkept results of the last
      // round no longer apply (the new jobs already hold their own copy of the chosen image).
      if (refineFrom) {
        const stale = staleJobs(overview?.jobs ?? [], refineFrom.assetId, new Set(started.map((j) => j.id)));
        await Promise.all(stale.map((id) => call(jobUrl(id, "discard"), "POST")));
      }
      setInstruction("");
      setRefineFrom(null);
      setFocusId(null);
    });

  const keep = (job: EditJob) =>
    act(async () => {
      await call<EditJob>(jobUrl(job.id, "keep"), "POST");
      announceManifestChanged();
      reload();
    });

  const actionsFor = (job: EditJob) => ({
    busy,
    onKeep: () => void keep(job),
    onDiscard: () => void act(() => call(jobUrl(job.id, "discard"), "POST")),
    onCancel: () => void act(() => call(jobUrl(job.id, "cancel"), "POST")),
    onRefine: () => {
      setRefineFrom(job);
      setInstruction("");
      setFocusId(null);
      document.getElementById("edit-instruction")?.focus();
    },
  });

  // Focus view: Esc goes back to the grid, ← / → step through the results with an image.
  const focusIds = jobs.filter(hasResult).map((j) => j.id);
  const focusKey = focusIds.join(" ");
  useEffect(() => {
    if (!focusId) return;
    const ids = focusKey.split(" ");
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select") || t.isContentEditable)) return;
      if (e.key === "Escape") setFocusId(null);
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next = stepId(ids, focusId, e.key === "ArrowRight" ? 1 : -1);
        if (next) setFocusId(next);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, focusKey]);

  if (!listing)
    return (
      <div className="studio studio-blank">
        <p className="muted">Loading the image list…</p>
      </div>
    );
  // Without a readable data folder there is nothing to pick: one empty state instead of three columns.
  if (listing.status !== "ok")
    return (
      <div className="studio studio-blank">
        <section className="empty">
          <h2>{listing.status === "unset" ? "No images to edit" : "The image list cannot be read"}</h2>
          <p>
            {listing.status === "unset" ? (
              <>
                Reference images live in the data folder, and <code>TATTOO_DATA_DIR</code> is not set. Once it
                is, pick an image here and describe the change; Claude Code edits it on this Mac, or GPT Image
                redraws it.
              </>
            ) : (
              listing.message
            )}
          </p>
          <a className="button primary" href="#data">
            Set up the data folder
          </a>
        </section>
      </div>
    );

  const canRun =
    (creatingNew || !!refineFrom || !!selected) &&
    !!instruction.trim() &&
    !busy &&
    availability?.enabled === true &&
    runningCount < MAX_RUNNING[activeEngine];
  const engineLabel = availability?.enabled
    ? "claude" in availability
      ? availability.claude
      : availability.model
    : null;
  // What the edit starts from: a result being edited further, or the picked image.
  const sourceSrc = refineFrom
    ? `${jobUrl(refineFrom.id, "output")}?v=${refineFrom.finishedAt ?? ""}`
    : selected && mode === "edit"
      ? assetImageUrl(selected.id)
      : null;
  const sourceCaption = refineFrom
    ? "Result being edited further"
    : selected
      ? [selected.file, selected.derived_from && `edit of ${selected.derived_from}`]
          .filter(Boolean)
          .join(" · ")
      : "";

  // ── Left: asset browser ──
  let browser: ReactNode;
  if (assets.length === 0)
    browser = (
      <div className="studio-assets-empty">
        <p className="muted small">
          No images in the manifest yet. Run <code>npm run assets:scan</code> after adding files to the data
          folder, then Reload.
        </p>
      </div>
    );
  else
    browser = (
      <>
        <div className="studio-filters">
          <input
            type="search"
            placeholder="Search id, notes, source"
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            aria-label="Search images"
          />
          <select
            value={filter.kind}
            onChange={(e) => setFilter({ ...filter, kind: e.target.value })}
            aria-label="Kind"
          >
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.value} ({k.count})
              </option>
            ))}
          </select>
          <select
            value={filter.tag}
            onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
            aria-label="Tag"
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value} ({t.count})
              </option>
            ))}
          </select>
        </div>
        <p className="studio-assets-hint faint">
          {mode === "edit"
            ? usesRefs
              ? "Click to edit · corner button adds a reference"
              : "Click an image to edit it"
            : `Click to add as reference · up to ${MAX_REFS}`}
        </p>
        {shown.length === 0 ? (
          <p className="muted small studio-assets-none">No image matches the filter.</p>
        ) : (
          <ul className="studio-thumbs">
            {shown.map((a) => {
              const refIndex = references.indexOf(a.id);
              const isRef = refIndex !== -1;
              const current = mode === "edit" ? a.id === selectedId : isRef;
              return (
                <li key={a.id} className={isRef ? "is-ref" : undefined}>
                  <button
                    type="button"
                    className={`studio-thumb${current ? " current" : ""}`}
                    aria-pressed={current}
                    title={[a.id, a.file, a.notes].filter(Boolean).join("\n")}
                    onClick={() => (mode === "edit" ? select(a) : toggleReference(a.id))}
                  >
                    <img src={assetImageUrl(a.id)} alt="" loading="lazy" decoding="async" />
                    <span className="studio-thumb-id">{a.id}</span>
                  </button>
                  {usesRefs && mode === "edit" && (
                    <button
                      type="button"
                      className={`ref-badge${isRef ? " on" : ""}`}
                      aria-pressed={isRef}
                      aria-label={isRef ? `Remove reference ${a.id}` : `Add ${a.id} as a reference`}
                      disabled={!isRef && references.length >= MAX_REFS}
                      title="Send this image to GPT Image as a reference"
                      onClick={() => toggleReference(a.id)}
                    >
                      {isRef ? refIndex + 1 : "+"}
                    </button>
                  )}
                  {mode === "create" && isRef && (
                    <span className="ref-badge on" aria-hidden="true">
                      {refIndex + 1}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );

  // ── Centre: canvas ──
  let canvas: ReactNode;
  let barTitle: ReactNode;
  if (mode === "edit" && !selected) {
    barTitle = <span className="muted">No image picked</span>;
    canvas = (
      <div className="studio-center">
        <section className="empty studio-hint">
          <h2>Pick an image on the left</h2>
          <p>
            Then describe the change on the right. <strong>Local</strong> edits (remove the background, crop,
            contrast) run on this Mac with Claude Code and local tools and keep the pixels as they are.{" "}
            <strong>Generative</strong> edits (fewer snakes, move the skull, fill in behind a hand) are
            redrawn by GPT Image through the OpenAI API. The original stays as it is and each result is a
            preview until you keep it.
          </p>
        </section>
      </div>
    );
  } else {
    barTitle =
      mode === "create" ? (
        <>
          <strong>{refineFrom ? "Editing a new image" : name.trim() || "New image"}</strong>
          {!refineFrom && (
            <span className="faint mono">
              {size === "auto" ? "auto" : size.replace("x", " × ")} · {background}
            </span>
          )}
        </>
      ) : (
        <>
          <strong>{selected!.id}</strong>
          <span className="faint studio-bar-file">{sourceCaption}</span>
        </>
      );
    if (focusJob) {
      canvas = <FocusView job={focusJob} {...actionsFor(focusJob)} />;
    } else if (jobs.length === 0) {
      canvas = (
        <div className="studio-center">
          {sourceSrc ? (
            <figure className="studio-hero">
              <div className="checker">
                <img src={sourceSrc} alt="Image to edit" />
              </div>
              <figcaption>
                <span className="tile-label">{refineFrom ? "Source" : "Original"}</span>
                <span className="faint">Describe the change on the right, then run it.</span>
              </figcaption>
            </figure>
          ) : (
            <figure className="studio-artboard" style={{ "--aspect": artboardAspect(size) } as CSSProperties}>
              <div className={`artboard-frame${background === "transparent" ? " checker" : ""}`}>
                <span className="mono">{size === "auto" ? "auto size" : size.replace("x", " × ")}</span>
                <span className="faint">
                  {references.length > 0
                    ? `${references.length} reference${references.length === 1 ? "" : "s"} attached`
                    : "Describe the new image on the right"}
                </span>
              </div>
            </figure>
          )}
        </div>
      );
    } else {
      const tiles = openJobs.length;
      const withSource = showSource && !!sourceSrc;
      canvas = (
        <div className="studio-results">
          {(tiles > 0 || withSource) && (
            <ul
              className="studio-grid"
              style={{ "--n": Math.max(1, tiles + (withSource ? 1 : 0)) } as CSSProperties}
            >
              {withSource && (
                <li className="studio-tile source">
                  <div className="tile-head">
                    <span className="tile-label">{refineFrom ? "Source" : "Original"}</span>
                    <span className="faint small">before</span>
                  </div>
                  <div className="tile-image checker">
                    <img src={sourceSrc} alt="Before" />
                  </div>
                  <p className="tile-text faint">{sourceCaption}</p>
                </li>
              )}
              {openJobs.map((job, i) => (
                <JobTile
                  key={job.id}
                  job={job}
                  label={tiles > 1 ? `Variant ${i + 1}` : "Result"}
                  onFocus={() => setFocusId(job.id)}
                  {...actionsFor(job)}
                />
              ))}
            </ul>
          )}
          {earlier.length > 0 && (
            <>
              <h3 className="section-label studio-earlier-head">
                Earlier <span className="mono">{earlier.length}</span>
              </h3>
              <ul className="studio-grid compact">
                {earlier.map((job) => (
                  <JobTile
                    key={job.id}
                    job={job}
                    label={
                      job.state === "kept" ? "Kept" : job.state === "discarded" ? "Discarded" : "Stopped"
                    }
                    compact
                    onFocus={() => setFocusId(job.id)}
                    {...actionsFor(job)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      );
    }
  }

  const running = jobs.filter((j) => j.state === "running").length;
  const ready = jobs.filter((j) => j.state === "done").length;

  return (
    <div className={`studio backdrop-${backdrop}`}>
      <aside className="studio-assets" aria-label="Images">
        <div className="studio-col-head">
          <h2 className="float-title">{mode === "edit" ? "Images" : "References"}</h2>
          <span className="mono faint">
            {shown.length === assets.length ? assets.length : `${shown.length}/${assets.length}`}
          </span>
          <span className="spacer" />
          <button type="button" className="ghost small-button" onClick={reload} title="Re-read manifest.yaml">
            Reload
          </button>
        </div>
        <div className="studio-assets-body">{browser}</div>
      </aside>

      <section className="studio-stage" aria-label="Preview">
        <div className="float float-bar studio-bar">
          {focusJob ? (
            <>
              <button type="button" className="ghost" onClick={() => setFocusId(null)}>
                ← All results
              </button>
              <span className="toolbar-sep" />
              <strong className="studio-bar-title">
                {focusJob.kept?.id ?? focusJob.instructions.at(-1)}
              </strong>
              {focusIds.length > 1 && (
                <span className="button-pair">
                  <button
                    type="button"
                    className="ghost icon-button"
                    aria-label="Previous result"
                    onClick={() => setFocusId(stepId(focusIds, focusJob.id, -1))}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="ghost icon-button"
                    aria-label="Next result"
                    onClick={() => setFocusId(stepId(focusIds, focusJob.id, 1))}
                  >
                    ›
                  </button>
                </span>
              )}
            </>
          ) : (
            <span className="studio-bar-title">{barTitle}</span>
          )}
          <span className="spacer" />
          {!focusJob && jobs.length > 0 && sourceSrc && (
            <label className="inline small studio-switch">
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={showSource}
                onChange={(e) => setShowSource(e.target.checked)}
              />
              Before
            </label>
          )}
          <span className="segmented" role="group" aria-label="Backdrop">
            {(["light", "dark"] as const).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={backdrop === b}
                title={`${b === "light" ? "Light" : "Dark"} checkerboard behind the images`}
                onClick={() => setBackdrop(b)}
              >
                {b === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </span>
        </div>

        <div className="studio-canvas">{canvas}</div>

        <div className="float status-bar studio-status">
          <span>
            {jobs.length === 0 ? (
              "No results yet"
            ) : (
              <>
                <span className="mono">{jobs.length}</span> result{jobs.length === 1 ? "" : "s"}
                {running > 0 && (
                  <>
                    {" "}
                    · <span className="mono">{running}</span> running
                  </>
                )}
                {ready > 0 && (
                  <>
                    {" "}
                    · <span className="mono">{ready}</span> to review
                  </>
                )}
              </>
            )}
          </span>
          {spent !== null && (
            <span>
              spent ≈ <span className="mono">{formatUsd(spent)}</span>
            </span>
          )}
          <span className="spacer" />
          <span className="faint">
            {focusJob ? (
              <>
                <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> step ·{" "}
                <kbd className="kbd">Esc</kbd> back
              </>
            ) : jobs.some(hasResult) ? (
              "Click a result to see it large"
            ) : (
              ""
            )}
          </span>
        </div>
      </section>

      <aside className="studio-inspector" aria-label="Image studio">
        <div className="studio-col-head">
          <span className="segmented studio-mode" role="group" aria-label="Mode">
            {(["edit", "create"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? "active" : ""}
                aria-pressed={mode === m}
                onClick={() => switchMode(m)}
              >
                {m === "edit" ? "Edit" : "Create new"}
              </button>
            ))}
          </span>
        </div>

        <div className="studio-inspector-body">
          {(serviceError || (availability && !availability.enabled)) && (
            <div className="notices">
              {serviceError && <p className="notice error">{serviceError}</p>}
              {availability && !availability.enabled && <p className="notice warn">{availability.reason}</p>}
            </div>
          )}

          {mode === "edit" && (
            <InspectorSection title="Source">
              {selected ? (
                <div className="studio-source">
                  <div className="checker">
                    <img src={sourceSrc ?? assetImageUrl(selected.id)} alt="" />
                  </div>
                  <div className="studio-source-text">
                    <strong>{refineFrom ? "Result of the last edit" : selected.id}</strong>
                    <span className="faint">{refineFrom ? `from ${selected.id}` : sourceCaption}</span>
                  </div>
                </div>
              ) : (
                <p className="faint small">Pick an image on the left.</p>
              )}
            </InspectorSection>
          )}
          {mode === "create" && refineFrom && (
            <InspectorSection title="Source">
              <div className="studio-source">
                <div className="checker">
                  <img src={sourceSrc ?? ""} alt="" />
                </div>
                <div className="studio-source-text">
                  <strong>Result of the last run</strong>
                  <span className="faint">{refineFrom.created?.name}</span>
                </div>
              </div>
            </InspectorSection>
          )}

          <InspectorSection
            title="Engine"
            note={
              engineLabel ? (
                <span className="mono" title="Model or command that runs the edit">
                  {engineLabel}
                </span>
              ) : undefined
            }
          >
            {creatingNew ? (
              <div className="engine-options single">
                <span className="engine-option static">
                  <strong>GPT Image</strong>
                  <span>Draws a new image via the OpenAI API</span>
                </span>
              </div>
            ) : (
              <div className="engine-options" role="radiogroup" aria-label="Engine">
                {(
                  [
                    ["claude", "Local", "Claude on this Mac, keeps the pixels"],
                    ["openai", "Generative", "GPT Image, redraws"],
                  ] as const
                ).map(([value, title, sub]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={engine === value}
                    className={`engine-option${engine === value ? " on" : ""}`}
                    onClick={() => setEngine(value)}
                  >
                    <strong>{title}</strong>
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
            )}
          </InspectorSection>

          <InspectorSection title="Prompt">
            {!creatingNew && (
              <div className="edit-presets" role="group" aria-label="Presets">
                {EDIT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`chip plain${p.engine === "openai" ? " gen" : ""}`}
                    title={p.engine === "openai" ? "Generative: switches to GPT Image" : undefined}
                    onClick={() => {
                      setInstruction(p.instruction);
                      if (p.engine) setEngine(p.engine);
                    }}
                  >
                    {p.label.replace(" (generative)", "")}
                    {p.engine === "openai" && <span className="gen-tag">GPT</span>}
                  </button>
                ))}
              </div>
            )}
            <label className="sr-only" htmlFor="edit-instruction">
              {creatingNew ? "What should it show?" : "What should change?"}
            </label>
            <textarea
              id="edit-instruction"
              rows={6}
              value={instruction}
              maxLength={2000}
              placeholder={
                creatingNew
                  ? "What should it show? e.g. Ein rotes Dreieck als Rahmen, Linien wie im Referenzbild; or a dotwork pattern for the forearm."
                  : activeEngine === "openai"
                    ? "What should change? e.g. Mache ein rotes Dreieck drumherum wie im Referenzbild (German is fine)."
                    : "What should change? e.g. Remove the background and the text at the bottom; keep the snake's tail."
              }
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun) void start();
              }}
            />
            <span className="studio-charcount mono faint">{instruction.length} / 2000</span>
          </InspectorSection>

          {usesRefs && (
            <InspectorSection
              title="References"
              note={
                <span className="mono">
                  {references.length}/{MAX_REFS}
                </span>
              }
            >
              {references.length === 0 ? (
                <p className="faint small">
                  {mode === "create"
                    ? "Optional: click images on the left to send them along."
                    : "Optional: the + on an image on the left sends it along."}
                </p>
              ) : (
                <ul className="studio-refs" aria-label="Reference images">
                  {references.map((id, i) => (
                    <li key={id}>
                      <span className="ref-num mono">{i + 1}</span>
                      <img src={assetImageUrl(id)} alt="" />
                      <span className="studio-ref-id">{id}</span>
                      <button
                        type="button"
                        className="ghost icon-button small-button"
                        aria-label={`Remove reference ${id}`}
                        onClick={() => toggleReference(id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </InspectorSection>
          )}

          {(creatingNew || activeEngine === "openai") && (
            <InspectorSection title="Settings">
              <div className="props studio-props">
                {creatingNew && (
                  <>
                    <label>
                      Name
                      <input
                        type="text"
                        value={name}
                        maxLength={60}
                        placeholder="e.g. red triangle"
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label>
                      Format
                      <select value={size} onChange={(e) => setSize(e.target.value as CreateSize)}>
                        {CREATE_SIZES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Background
                      <select
                        value={background}
                        onChange={(e) => setBackground(e.target.value as CreateBackground)}
                      >
                        {CREATE_BACKGROUNDS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <div className="props-row">
                  <span id="variants-label">Variants</span>
                  <span className="segmented" role="group" aria-labelledby="variants-label">
                    {VARIANT_CHOICES.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="mono"
                        aria-pressed={variants === n}
                        onClick={() => setVariants(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </span>
                </div>
              </div>
            </InspectorSection>
          )}
        </div>

        <div className="studio-run">
          <p className="studio-estimate faint">
            <span>
              {runningCount >= MAX_RUNNING[activeEngine]
                ? `${MAX_RUNNING[activeEngine]} edits are running; wait for one.`
                : runEstimate(activeEngine, count)}
            </span>
            {runningCount > 0 && (
              <span className="mono">
                {runningCount}/{MAX_RUNNING[activeEngine]} running
              </span>
            )}
          </p>
          <button
            type="button"
            className="primary studio-run-button"
            disabled={!canRun}
            onClick={() => void start()}
          >
            {runLabel({ creatingNew, refining: !!refineFrom, engine: activeEngine, count })}
            <kbd className="kbd">⌘↵</kbd>
          </button>
          {refineFrom && (
            <button type="button" className="ghost studio-run-alt" onClick={() => setRefineFrom(null)}>
              {mode === "create" ? "Create a new one instead" : "Start from the original instead"}
            </button>
          )}
          {actionError && <p className="error-text small studio-run-error">{actionError}</p>}
        </div>
      </aside>
    </div>
  );
}

function InspectorSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="studio-section">
      <h3 className="props-head">
        {title}
        {note && <span className="props-head-note">{note}</span>}
      </h3>
      {children}
    </section>
  );
}
