// "Image studio" tab. Edit: pick a reference image, start an editing session on it and say what to
// change; `claude -p` on this Mac does it with local tools (ADR 0007) or GPT Image redraws it (ADR 0008).
// Create: describe a new motif and let GPT Image draw it (ADR 0009). A session (ADR 0010) is a version
// strip v0 → v1 → …: every run starts from the last version, "Continue with this" makes a result the
// next version, "Save & close" writes the last version into edits/ (or generated/) as a new manifest
// entry and ends the session. Originals stay untouched. UI only: the rules live in session.ts,
// studio.ts, edit.ts, openai.ts and the server.
//
// Layout (full-bleed workspace): asset browser | canvas (version strip, attempts, focus view) | inspector.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { facets, filterAssets, NO_FILTER, type AssetFilter } from "../assets/filter.ts";
import { announceManifestChanged, useAssetListing } from "../assets/useAssets.ts";
import { assetImageUrl, type AssetInfo } from "../assets/types.ts";
import { showInStudio } from "./edit.ts";
import {
  attemptsFrom,
  closeQuestion,
  dropQuestion,
  familyOf,
  parentIndex,
  sessionForAsset,
  sessionJobs,
  unsavedWork,
  versionLabel,
} from "./session.ts";
import { FocusView, JobTile, resultUrl, VersionStrip, type StripVersion } from "./StudioResults.tsx";
import { artboardAspect, formatUsd, hasResult, runEstimate, runLabel, spentUsd, stepId } from "./studio.ts";
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
  type EditSession,
  type SessionRequest,
  sessionUrl,
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

type Backdrop = "light" | "dark";
const BACKDROP_KEY = "tattoo-planner:studio-backdrop";

/** Dark by default (the whole planner is dark); Light stays one click away for black line work. */
function useBackdrop(): [Backdrop, (b: Backdrop) => void] {
  const [backdrop, setBackdrop] = useState<Backdrop>(() => {
    try {
      return localStorage.getItem(BACKDROP_KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const set = useCallback((b: Backdrop) => {
    setBackdrop(b);
    try {
      localStorage.setItem(BACKDROP_KEY, b);
    } catch {
      // per-viewer convenience only
    }
  }, []);
  return [backdrop, set];
}

/** `active`: the tab is shown; the page stays mounted while hidden, so its keys are off then. */
export function ImageEditPage({ active = true }: { active?: boolean }) {
  const { listing, reload, scanNote } = useAssetListing();
  const { overview, error: serviceError, refresh } = useEditOverview();
  // Coming back to the tab: fetch the jobs again (they may have finished while it was hidden).
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);
  const [filter, setFilter] = useState<AssetFilter>(NO_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [engine, setEngine] = useState<EditEngine>("claude");
  const [variants, setVariants] = useState(2);
  const [mode, setMode] = useState<EditMode>("edit");
  const [references, setReferences] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [size, setSize] = useState<CreateSize>("1024x1024");
  const [background, setBackground] = useState<CreateBackground>("transparent");
  const [createSessionId, setCreateSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Canvas view: the version whose attempts are shown (null: the last one), the job shown large.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useBackdrop();

  const assets = useMemo(
    () => (listing?.status === "ok" ? listing.assets.filter((a) => a.exists && showInStudio(a)) : []),
    [listing],
  );
  const kinds = useMemo(() => facets(assets.map((a) => a.kind)), [assets]);
  const tags = useMemo(() => facets(assets.flatMap((a) => a.tags)), [assets]);
  const shown = useMemo(() => filterAssets(assets, filter), [assets, filter]);
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const sessions = useMemo(() => overview?.sessions ?? [], [overview]);
  const allJobs = useMemo(() => overview?.jobs ?? [], [overview]);
  const editing = new Set(sessions.flatMap((s) => (s.mode === "edit" && s.assetId ? [s.assetId] : [])));
  const createSessions = sessions.filter((s) => s.mode === "create");

  // The session on screen: the one on the picked image, or the new image being made.
  const session: EditSession | null =
    mode === "edit"
      ? selected
        ? sessionForAsset(sessions, selected.id)
        : null
      : (createSessions.find((s) => s.id === createSessionId) ?? null);
  const own = session ? sessionJobs(allJobs, session.id) : [];
  const byId = new Map(own.map((j) => [j.id, j]));
  const last = session?.versions.length ?? 0;
  const view = viewIndex === null || viewIndex > last ? last : viewIndex;
  const attempts = session ? attemptsFrom(session, allJobs, view) : [];
  const focusJob = own.find((j) => j.id === focusId) ?? null;

  const creatingNew = session?.mode === "create" && last === 0;
  const activeEngine: EditEngine = creatingNew ? "openai" : engine;
  const availability = activeEngine === "openai" ? overview?.generative : overview?.availability;
  const runningCount = allJobs.filter((j) => j.state === "running" && j.engine === activeEngine).length;
  const count =
    activeEngine === "openai" ? Math.max(1, Math.min(variants, MAX_RUNNING.openai - runningCount)) : 1;
  const usesRefs = activeEngine === "openai" && !!session;
  const spent = spentUsd(own);

  const versionSrc = (k: number): string | null => {
    if (!session) return null;
    if (k === 0) return session.mode === "edit" && session.assetId ? assetImageUrl(session.assetId) : null;
    const job = byId.get(session.versions[k - 1]!);
    return job ? resultUrl(job) : null;
  };
  const strip: StripVersion[] = session
    ? Array.from({ length: last + 1 }, (_, k) => {
        const job = k === 0 ? undefined : byId.get(session.versions[k - 1]!);
        return {
          index: k,
          src: versionSrc(k),
          ...(job?.kept ? { saved: job.kept.id } : {}),
          title:
            k === 0
              ? (session.assetId ?? session.create?.name ?? "")
              : [job?.instructions.at(-1), job?.kept && `saved as ${job.kept.id}`].filter(Boolean).join("\n"),
        };
      })
    : [];
  const sessionTitle = session
    ? session.mode === "edit"
      ? (session.assetId ?? "")
      : session.create?.name || "new image"
    : "";

  const toggleReference = (id: string) =>
    setReferences((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length < MAX_REFS ? [...r, id] : r));
  const resetView = () => {
    setViewIndex(null);
    setFocusId(null);
    setActionError(null);
  };
  const switchMode = (m: EditMode) => {
    setMode(m);
    resetView();
  };
  const select = (a: AssetInfo) => {
    setSelectedId(a.id);
    resetView();
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

  const startSession = () =>
    act(async () => {
      const body: SessionRequest =
        mode === "create"
          ? { mode: "create", name, size, background }
          : { mode: "edit", assetId: selected!.id };
      const s = await call<EditSession>(`${EDITS_ENDPOINT}/sessions`, "POST", body);
      if (s.mode === "create") setCreateSessionId(s.id);
      setInstruction("");
      setFlash(null);
      resetView();
    });

  const run = (text = instruction) =>
    act(async () => {
      if (!session) return;
      const body: EditRequest = {
        session: session.id,
        instruction: text,
        engine: activeEngine,
        ...(usesRefs && references.length > 0 ? { references } : {}),
      };
      // Each generative variant is its own request and its own result.
      await Promise.all(Array.from({ length: count }, () => call<EditJob>(EDITS_ENDPOINT, "POST", body)));
      setViewIndex(null);
      setFocusId(null);
    });

  const pick = (job: EditJob) => {
    if (!session) return;
    const k = parentIndex(session.versions, job);
    if (k === null || session.versions[k] === job.id) return;
    const q = dropQuestion(k + 1, last);
    if (q && !window.confirm(q)) return;
    void act(async () => {
      await call(sessionUrl(session.id, "pick"), "POST", { job: job.id });
      setViewIndex(null);
      setFocusId(null);
    });
  };

  const continueFrom = (k: number) => {
    if (!session) return;
    const q = dropQuestion(k + 1, last);
    if (q && !window.confirm(q)) return;
    void act(async () => {
      await call(sessionUrl(session.id, "truncate"), "POST", { length: k });
      setViewIndex(null);
      setFocusId(null);
    });
  };

  const saved = (job: EditJob) => {
    announceManifestChanged();
    reload();
    setFlash(`Saved as ${job.kept?.id ?? "a new image"}`);
  };

  const saveVersion = (k: number) => {
    if (!session || k < 1) return;
    void act(async () =>
      saved(await call<EditJob>(sessionUrl(session.id, "save"), "POST", { job: session.versions[k - 1] })),
    );
  };

  const saveAndClose = () => {
    if (!session || last === 0) return;
    const work = unsavedWork(session, allJobs);
    if (
      work.running > 0 &&
      !window.confirm(`Stop ${work.running} running edit${work.running === 1 ? "" : "s"} and close?`)
    )
      return;
    void act(async () => {
      const top = byId.get(session.versions.at(-1)!);
      const job = top?.kept ? top : await call<EditJob>(sessionUrl(session.id, "save"), "POST", {});
      await call(sessionUrl(session.id, "close"), "POST");
      saved(job);
      setInstruction("");
      resetView();
      // Next round: the saved image is picked, one click on "Start editing" away.
      if (job.kept) {
        setMode("edit");
        setSelectedId(job.kept.id);
      }
      setCreateSessionId(null);
    });
  };

  const closeSession = () => {
    if (!session) return;
    const q = closeQuestion(unsavedWork(session, allJobs));
    if (q && !window.confirm(q)) return;
    void act(async () => {
      await call(sessionUrl(session.id, "close"), "POST");
      setCreateSessionId(null);
      setInstruction("");
      resetView();
    });
  };

  const actionsFor = (job: EditJob) => {
    const i = session ? session.versions.indexOf(job.id) : -1;
    return {
      busy,
      versionIndex: i === -1 ? null : i + 1,
      onPick: () => pick(job),
      onCancel: () => void act(() => call(jobUrl(job.id, "cancel"), "POST")),
    };
  };

  // Focus view: Esc goes back to the grid, ← / → step through the results of this version.
  const focusIds = attempts.filter(hasResult).map((j) => j.id);
  const focusKey = focusIds.join(" ");
  useEffect(() => {
    if (!focusId || !active) return;
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
  }, [focusId, focusKey, active]);

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

  const atLimit = runningCount >= MAX_RUNNING[activeEngine];
  const canRetry = !!session && !busy && availability?.enabled === true && !atLimit;
  const canRun = canRetry && !!instruction.trim();
  const engineLabel = availability?.enabled
    ? "claude" in availability
      ? availability.claude
      : availability.model
    : null;
  const lastAttempt = attempts.at(-1);

  // ── Left: asset browser ──
  let browser: ReactNode;
  if (assets.length === 0)
    browser = (
      <div className="studio-assets-empty">
        <p className="muted small">
          No images yet. Copy them into <code>refs/</code> (or <code>cards/</code>, <code>existing/</code>) in
          the data folder, then click Reload.
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
              ? "Click to pick · corner button adds a reference"
              : "Click an image to pick it"
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
                    title={[a.id, a.file, a.notes, editing.has(a.id) && "editing session open"]
                      .filter(Boolean)
                      .join("\n")}
                    onClick={() => (mode === "edit" ? select(a) : toggleReference(a.id))}
                  >
                    <img src={assetImageUrl(a.id)} alt="" loading="lazy" decoding="async" />
                    <span className="studio-thumb-id">{a.id}</span>
                    {editing.has(a.id) && (
                      <span className="thumb-session" aria-label="Editing session open">
                        editing
                      </span>
                    )}
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
  if (!session) {
    // Browse: no session open. The picked image (or the artboard of a new one) and its saved versions.
    if (mode === "edit" && !selected) {
      barTitle = <span className="muted">No image picked</span>;
      canvas = (
        <div className="studio-center">
          <section className="empty studio-hint">
            <h2>Pick an image on the left</h2>
            <p>
              Then click <strong>Start editing</strong>. In a session every run starts from the latest
              version; pick the result you like with <strong>Continue with this</strong>, and when it is
              right, <strong>Save &amp; close</strong> writes it as a new image. The original stays as it is.
            </p>
          </section>
        </div>
      );
    } else if (mode === "edit") {
      const family = familyOf(assets, selected!.id);
      barTitle = (
        <>
          <strong>{selected!.id}</strong>
          <span className="faint studio-bar-file">
            {[selected!.file, selected!.derived_from && `edit of ${selected!.derived_from}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </>
      );
      canvas = (
        <div className="studio-browse">
          <figure className="studio-hero">
            <div className="checker">
              <img src={assetImageUrl(selected!.id)} alt={selected!.id} />
            </div>
          </figure>
          {family.length > 1 && (
            <div className="float studio-family">
              <span className="tile-label">Versions of {family[0]!.id}</span>
              <ul>
                {family.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`family-item${a.id === selected!.id ? " current" : ""}`}
                      aria-pressed={a.id === selected!.id}
                      title={[a.id, a.notes].filter(Boolean).join("\n")}
                      onClick={() => select(a)}
                    >
                      <span className="checker">
                        <img src={assetImageUrl(a.id)} alt="" loading="lazy" />
                      </span>
                      <span className="mono">{a.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    } else {
      barTitle = (
        <>
          <strong>{name.trim() || "New image"}</strong>
          <span className="faint mono">
            {size === "auto" ? "auto" : size.replace("x", " × ")} · {background}
          </span>
        </>
      );
      canvas = (
        <div className="studio-center">
          <figure className="studio-artboard" style={{ "--aspect": artboardAspect(size) } as CSSProperties}>
            <div className={`artboard-frame${background === "transparent" ? " checker" : ""}`}>
              <span className="mono">{size === "auto" ? "auto size" : size.replace("x", " × ")}</span>
              <span className="faint">Name it on the right, then click New image</span>
            </div>
          </figure>
        </div>
      );
    }
  } else {
    barTitle = (
      <>
        <strong>
          {session.mode === "edit" ? "Editing" : "New image"} {sessionTitle}
        </strong>
        <span className="faint mono">
          {last === 0 ? "no version yet" : `${last} version${last === 1 ? "" : "s"}`}
        </span>
      </>
    );
    const viewSrc = versionSrc(view);
    const viewJob = view === 0 ? undefined : byId.get(session.versions[view - 1]!);
    const head = (
      <div className="studio-round-head">
        <span className="tile-label">
          {attempts.length === 0 ? versionLabel(view) : `Results from ${versionLabel(view)}`}
        </span>
        {view < last ? (
          <>
            <span className="faint small">
              Earlier version · the next run starts from {versionLabel(last)}
            </span>
            <span className="spacer" />
            <button type="button" className="small-button" disabled={busy} onClick={() => continueFrom(view)}>
              Continue from {versionLabel(view)}
            </button>
          </>
        ) : (
          <>
            <span className="faint small">The next run starts here</span>
            <span className="spacer" />
            {lastAttempt && (
              <button
                type="button"
                className="ghost small-button"
                disabled={!canRetry}
                title={`Run "${lastAttempt.instructions.at(-1) ?? ""}" again on ${versionLabel(view)}`}
                onClick={() => {
                  const text = lastAttempt.instructions.at(-1) ?? "";
                  setInstruction(text);
                  void run(text);
                }}
              >
                Try again
              </button>
            )}
          </>
        )}
        {viewJob && !viewJob.kept && (
          <button
            type="button"
            className="ghost small-button"
            disabled={busy}
            onClick={() => saveVersion(view)}
          >
            Save {versionLabel(view)}
          </button>
        )}
        {viewJob?.kept && <span className="chip ok">saved as {viewJob.kept.id}</span>}
      </div>
    );
    let main: ReactNode;
    if (focusJob) {
      main = <FocusView job={focusJob} {...actionsFor(focusJob)} />;
    } else if (attempts.length === 0) {
      main = (
        <div className="studio-center">
          {viewSrc ? (
            <figure className="studio-hero">
              <div className="checker">
                <img src={viewSrc} alt={versionLabel(view)} />
              </div>
              <figcaption>
                <span className="tile-label">{versionLabel(view)}</span>
                <span className="faint">
                  {view === last
                    ? "Describe the change on the right, then run it."
                    : "No other results from this version."}
                </span>
              </figcaption>
            </figure>
          ) : (
            <figure
              className="studio-artboard"
              style={{ "--aspect": artboardAspect(session.create?.size ?? "1024x1024") } as CSSProperties}
            >
              <div
                className={`artboard-frame${session.create?.background === "transparent" ? " checker" : ""}`}
              >
                <span className="mono">{session.create?.size.replace("x", " × ")}</span>
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
      main = (
        <ul
          className="studio-grid"
          style={{ "--n": Math.max(1, attempts.length + (viewSrc ? 1 : 0)) } as CSSProperties}
        >
          {viewSrc && (
            <li className="studio-tile source">
              <div className="tile-head">
                <span className="tile-label">{versionLabel(view)}</span>
                <span className="faint small">before</span>
              </div>
              <div className="tile-image checker">
                <img src={viewSrc} alt="Before" />
              </div>
              <p className="tile-text faint">
                {view === 0 ? sessionTitle : (viewJob?.instructions.at(-1) ?? "")}
              </p>
            </li>
          )}
          {attempts.map((job, i) => (
            <JobTile
              key={job.id}
              job={job}
              label={`Result ${i + 1}`}
              onFocus={() => setFocusId(job.id)}
              {...actionsFor(job)}
            />
          ))}
        </ul>
      );
    }
    canvas = (
      <div className="studio-session">
        <VersionStrip
          versions={strip}
          viewing={view}
          onView={(k) => {
            setViewIndex(k);
            setFocusId(null);
          }}
        />
        {head}
        <div className="studio-session-main">{main}</div>
      </div>
    );
  }

  const running = own.filter((j) => j.state === "running").length;
  const ready = own.filter((j) => j.state === "done" && !session?.versions.includes(j.id)).length;

  return (
    <div className={`studio backdrop-${backdrop}`}>
      <aside className="studio-assets" aria-label="Images">
        <div className="studio-col-head">
          <h2 className="float-title">{mode === "edit" ? "Images" : "References"}</h2>
          <span className="mono faint">
            {shown.length === assets.length ? assets.length : `${shown.length}/${assets.length}`}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="ghost small-button"
            onClick={reload}
            title="Look for new images in the data folder (as npm run assets:scan), then re-read manifest.yaml"
          >
            Reload
          </button>
        </div>
        {scanNote && <p className="studio-scan-note faint small">{scanNote}</p>}
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
              <strong className="studio-bar-title">{focusJob.instructions.at(-1)}</strong>
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
          <span className="segmented" role="group" aria-label="Backdrop">
            {(["dark", "light"] as const).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={backdrop === b}
                title={
                  b === "dark"
                    ? "Dark checkerboard behind the images"
                    : "Light checkerboard: shows black line work on a transparent background"
                }
                onClick={() => setBackdrop(b)}
              >
                {b === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </span>
          {session && (
            <>
              <span className="toolbar-sep" />
              <button type="button" className="ghost" disabled={busy} onClick={closeSession}>
                Close
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || last === 0}
                title={
                  last === 0
                    ? "Pick a result with “Continue with this” first"
                    : `Save ${versionLabel(last)} as a new image and end the session`
                }
                onClick={saveAndClose}
              >
                Save &amp; close
              </button>
            </>
          )}
        </div>

        <div className="studio-canvas">{canvas}</div>

        <div className="float status-bar studio-status">
          <span>
            {flash ? (
              <span className="ok-text">{flash}</span>
            ) : !session ? (
              sessions.length === 0 ? (
                "No editing session open"
              ) : (
                `${sessions.length} editing session${sessions.length === 1 ? "" : "s"} open`
              )
            ) : (
              <>
                <span className="mono">{own.length}</span> result{own.length === 1 ? "" : "s"}
                {running > 0 && (
                  <>
                    {" "}
                    · <span className="mono">{running}</span> running
                  </>
                )}
                {ready > 0 && (
                  <>
                    {" "}
                    · <span className="mono">{ready}</span> to choose from
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
            ) : session ? (
              "Unsaved versions are lost when npm run dev stops"
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
          {(serviceError || (session && availability && !availability.enabled)) && (
            <div className="notices">
              {serviceError && <p className="notice error">{serviceError}</p>}
              {session && availability && !availability.enabled && (
                <p className="notice warn">{availability.reason}</p>
              )}
            </div>
          )}

          {!session ? (
            <BrowseInspector
              mode={mode}
              selected={selected}
              name={name}
              size={size}
              background={background}
              onName={setName}
              onSize={setSize}
              onBackground={setBackground}
              openSessions={sessions}
              allJobs={allJobs}
              onResume={(s) => {
                resetView();
                if (s.mode === "create") {
                  setMode("create");
                  setCreateSessionId(s.id);
                } else {
                  setMode("edit");
                  setSelectedId(s.assetId ?? null);
                }
              }}
            />
          ) : (
            <>
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
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun) void run();
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

              {activeEngine === "openai" && (
                <InspectorSection title="Settings">
                  <div className="props studio-props">
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
            </>
          )}
        </div>

        <div className="studio-run">
          {session ? (
            <>
              <p className="studio-estimate faint">
                <span>
                  {atLimit
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
                onClick={() => void run()}
              >
                {runLabel({ creatingNew, version: last, engine: activeEngine, count })}
                <kbd className="kbd">⌘↵</kbd>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary studio-run-button"
              disabled={busy || (mode === "edit" && !selected)}
              onClick={() => void startSession()}
            >
              {mode === "edit" ? (selected ? `Start editing ${selected.id}` : "Start editing") : "New image"}
            </button>
          )}
          {actionError && <p className="error-text small studio-run-error">{actionError}</p>}
        </div>
      </aside>
    </div>
  );
}

/** Inspector without an open session: what "Start editing" works on, settings of a new image, and the
 * sessions still open elsewhere. */
function BrowseInspector(props: {
  mode: EditMode;
  selected: AssetInfo | null;
  name: string;
  size: CreateSize;
  background: CreateBackground;
  onName: (v: string) => void;
  onSize: (v: CreateSize) => void;
  onBackground: (v: CreateBackground) => void;
  openSessions: readonly EditSession[];
  allJobs: readonly EditJob[];
  onResume: (s: EditSession) => void;
}) {
  const { mode, selected, openSessions, allJobs, onResume } = props;
  return (
    <>
      {mode === "edit" ? (
        <InspectorSection title="Source">
          {selected ? (
            <div className="studio-source">
              <div className="checker">
                <img src={assetImageUrl(selected.id)} alt="" />
              </div>
              <div className="studio-source-text">
                <strong>{selected.id}</strong>
                <span className="faint">
                  {selected.derived_from ? `edit of ${selected.derived_from}` : selected.file}
                </span>
              </div>
            </div>
          ) : (
            <p className="faint small">Pick an image on the left.</p>
          )}
          <p className="faint small">
            Start editing opens a session on this image. Results stay previews; Save &amp; close writes the
            version you chose as a new image next to it.
          </p>
        </InspectorSection>
      ) : (
        <InspectorSection title="New image">
          <div className="props studio-props">
            <label>
              Name
              <input
                type="text"
                value={props.name}
                maxLength={60}
                placeholder="e.g. red triangle"
                onChange={(e) => props.onName(e.target.value)}
              />
            </label>
            <label>
              Format
              <select value={props.size} onChange={(e) => props.onSize(e.target.value as CreateSize)}>
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
                value={props.background}
                onChange={(e) => props.onBackground(e.target.value as CreateBackground)}
              >
                {CREATE_BACKGROUNDS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </InspectorSection>
      )}
      {openSessions.length > 0 && (
        <InspectorSection title="Open sessions" note={<span className="mono">{openSessions.length}</span>}>
          <ul className="studio-open-sessions">
            {openSessions.map((s) => {
              const n = s.versions.length;
              const results = sessionJobs(allJobs, s.id).length;
              return (
                <li key={s.id}>
                  <button type="button" className="ghost small-button" onClick={() => onResume(s)}>
                    <span>{s.mode === "edit" ? s.assetId : `new: ${s.create?.name || "image"}`}</span>
                    <span className="faint mono">
                      {n} version{n === 1 ? "" : "s"} · {results} result{results === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </InspectorSection>
      )}
    </>
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
