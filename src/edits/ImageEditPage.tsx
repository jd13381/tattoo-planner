// "Image studio" tab. Edit: pick a reference image and change it with a built-in operation (run here in
// the page, ADR 0013) or let GPT Image redraw it (ADR 0008). Create: describe a new motif and let GPT
// Image draw it (ADR 0009). The first run on an image opens its editing session (ADR 0010): a version
// strip v0 → v1 → …; every run starts from the last version. A built-in operation becomes the next
// version at once; for generative results "Continue with this" picks one. "Save & close" writes the
// last version into edits/ (or generated/) as a new manifest entry and ends the session. Originals stay
// untouched. UI only: the rules live in session.ts, studio.ts, builtin.ts, edit.ts, openai.ts and the
// server.
//
// Layout (full-bleed workspace): asset browser | canvas (version strip, attempts, focus view) | inspector.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { facets, filterAssets, NO_FILTER, type AssetFilter } from "../assets/filter.ts";
import { announceManifestChanged, useAssetListing } from "../assets/useAssets.ts";
import { assetImageUrl, type AssetInfo } from "../assets/types.ts";
import { BuiltinPanel, BuiltinPreview } from "./BuiltinPanel.tsx";
import {
  applyBuiltin,
  builtinOp,
  defaultParams,
  describeStep,
  type BuiltinOpId,
  type BuiltinParams,
} from "./builtin.ts";
import { CATEGORY_LABELS, type AssetCategory } from "../assets/category.ts";
import { useResolvedTheme } from "../ui/useTheme.ts";
import { showInStudio } from "./edit.ts";
import { BACKGROUND_PRESETS } from "./background.ts";
import { encodePng, loadPixels } from "./pixelsDom.ts";
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
import {
  FocusView,
  JobTile,
  resultUrl,
  TiledPreview,
  VersionStrip,
  type StripVersion,
} from "./StudioResults.tsx";
import { artboardAspect, formatUsd, hasResult, runEstimate, runLabel, spentUsd, stepId } from "./studio.ts";
import {
  applyUrl,
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

/** Generative requests at the same time; the server enforces the same number (MAX_RUNNING_OPENAI). */
const MAX_RUNNING_GENERATIVE = 4;
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
          setError(`Cannot reach the planner's edit service (${String(e)}). Restart the planner.`),
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

/** The theme's backdrop until one is picked; the other stays one click away (black line work). */
function useBackdrop(): [Backdrop, (b: Backdrop) => void] {
  const themed = useResolvedTheme();
  const [picked, setBackdrop] = useState<Backdrop | null>(() => {
    try {
      const v = localStorage.getItem(BACKDROP_KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch {
      return null;
    }
  });
  const backdrop = picked ?? themed;
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
  const [engine, setEngine] = useState<EditEngine>("builtin");
  const [opId, setOpId] = useState<BuiltinOpId>("remove-background");
  const [opParams, setOpParams] = useState<Partial<Record<BuiltinOpId, BuiltinParams>>>({});
  const [variants, setVariants] = useState(2);
  const [mode, setMode] = useState<EditMode>("edit");
  const [references, setReferences] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [size, setSize] = useState<CreateSize>("1024x1024");
  const [background, setBackground] = useState<CreateBackground>("transparent");
  const [createSessionId, setCreateSessionId] = useState<string | null>(null);
  // Background mode (docs/adr/0019): "create" with a seamless, square, opaque tile.
  const [tileable, setTileable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Canvas view: the version whose attempts are shown (null: the last one), the job shown large.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useBackdrop();

  const assets = useMemo(
    () =>
      listing?.status === "ok"
        ? listing.assets.filter(
            (a) =>
              a.exists && (showInStudio(a) || (a.id === selectedId && showInStudio({ ...a, hidden: false }))),
          )
        : [],
    [listing, selectedId],
  );
  // The section select shows the catalogue's sections, never raw kinds.
  const kinds = useMemo(() => facets(assets.map((a) => a.effectiveCategory)), [assets]);
  const tags = useMemo(() => facets(assets.flatMap((a) => a.tags)), [assets]);
  const shown = useMemo(
    () =>
      filterAssets(
        assets.filter((a) => !filter.kind || a.effectiveCategory === filter.kind),
        { ...filter, kind: "" },
      ),
    [assets, filter],
  );
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
      : (createSessions.find((s) => s.id === createSessionId && !!s.create?.tileable === tileable) ?? null);
  const own = session ? sessionJobs(allJobs, session.id) : [];
  const byId = new Map(own.map((j) => [j.id, j]));
  const last = session?.versions.length ?? 0;
  const view = viewIndex === null || viewIndex > last ? last : viewIndex;
  const attempts = session ? attemptsFrom(session, allJobs, view) : [];
  const focusJob = own.find((j) => j.id === focusId) ?? null;

  // A new image has no pixels until GPT Image draws its first version.
  const creatingNew = mode === "create" && last === 0;
  const activeEngine: EditEngine = creatingNew ? "openai" : engine;
  // Checked once up front, so nothing that needs a key can be started without one.
  const generativeOk = overview?.generative.enabled === true;
  const availability = activeEngine === "openai" ? overview?.generative : overview?.builtin;
  const runningCount = allJobs.filter((j) => j.state === "running" && j.engine === "openai").length;
  const count =
    activeEngine === "openai" ? Math.max(1, Math.min(variants, MAX_RUNNING_GENERATIVE - runningCount)) : 1;
  // Something to work on: the picked image (edit) or a new image (create).
  const hasTarget = mode === "create" || !!selected;
  // A background tile is drawn from its description alone (references would make it a picture).
  const usesRefs = activeEngine === "openai" && generativeOk && hasTarget && !(mode === "create" && tileable);
  const spent = spentUsd(own);
  const params = opParams[opId] ?? defaultParams(opId);

  const versionSrc = (k: number): string | null => {
    if (!session) return k === 0 && mode === "edit" && selected ? assetImageUrl(selected.id) : null;
    if (k === 0) return session.mode === "edit" && session.assetId ? assetImageUrl(session.assetId) : null;
    const job = byId.get(session.versions[k - 1]!);
    return job ? resultUrl(job) : null;
  };
  /** The image the next run works on (the last version). */
  const lastSrc = versionSrc(last);
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

  /** The session on screen, opened on the first run (there is no separate "Start editing" step). */
  const ensureSession = async (): Promise<EditSession> => {
    if (session) return session;
    const body: SessionRequest =
      mode === "create"
        ? tileable
          ? { mode: "create", name, tileable: true }
          : { mode: "create", name, size, background }
        : { mode: "edit", assetId: selected!.id };
    const s = await call<EditSession>(`${EDITS_ENDPOINT}/sessions`, "POST", body);
    if (s.mode === "create") setCreateSessionId(s.id);
    setFlash(null);
    return s;
  };

  const run = (text = instruction) =>
    act(async () => {
      if (!hasTarget) return;
      const s = await ensureSession();
      const body: EditRequest = {
        session: s.id,
        instruction: text,
        engine: activeEngine,
        ...(usesRefs && references.length > 0 ? { references } : {}),
      };
      // Each generative variant is its own request and its own result.
      await Promise.all(Array.from({ length: count }, () => call<EditJob>(EDITS_ENDPOINT, "POST", body)));
      setViewIndex(null);
      setFocusId(null);
    });

  /** Runs the chosen built-in operation on the last version and adds the result as the next version. */
  const applyOp = () =>
    act(async () => {
      if (!hasTarget || !lastSrc) return;
      const src = lastSrc;
      const s = await ensureSession();
      const base = s.versions.length;
      const { pixels } = await loadPixels(src);
      const png = await encodePng(applyBuiltin(pixels, opId, params));
      const r = await fetch(applyUrl(s.id, { step: describeStep(opId, params), base }), {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: png,
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setViewIndex(null);
      setFocusId(null);
    });

  /** Drops the last version (it stays as a result of the version before, until the session closes). */
  const undo = () => {
    if (!session || last === 0) return;
    void act(async () => {
      await call(sessionUrl(session.id, "truncate"), "POST", { length: last - 1 });
      setViewIndex(null);
      setFocusId(null);
    });
  };

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
      // Next round: the saved image is picked, ready for the next run.
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
                Reference images live in the project folder, and none is open yet. Once it is, pick an image
                here and touch it up with the built-in tools, or let GPT Image redraw it.
              </>
            ) : (
              listing.message
            )}
          </p>
          <a className="button primary" href="#data">
            Open a project
          </a>
        </section>
      </div>
    );

  const atLimit = activeEngine === "openai" && runningCount >= MAX_RUNNING_GENERATIVE;
  const canRetry = hasTarget && !busy && availability?.enabled === true && !atLimit;
  const canRun = canRetry && !!instruction.trim();
  const canApply = hasTarget && !busy && overview?.builtin.enabled === true && !!lastSrc;
  const engineLabel =
    activeEngine === "openai" && overview?.generative.enabled ? overview.generative.model : null;
  /** Built-in engine on the last version: the canvas shows the live preview there. */
  const previewing = activeEngine === "builtin" && !!lastSrc && view === last && !focusId;
  const lastAttempt = attempts.at(-1);

  // ── Left: asset browser ──
  let browser: ReactNode;
  if (assets.length === 0)
    browser = (
      <div className="studio-assets-empty">
        <p className="muted small">
          No images yet. Copy them into <code>images/</code> in the project folder, then click Reload.
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
            aria-label="Section"
          >
            <option value="">All sections</option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {CATEGORY_LABELS[k.value as AssetCategory] ?? k.value} ({k.count})
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
              Then apply a built-in operation on the right, or describe a change for GPT Image. Every step
              becomes a version; <strong>Save &amp; close</strong> writes the last one as a new image. The
              original stays as it is.
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
              {previewing ? (
                <BuiltinPreview src={lastSrc!} opId={opId} params={params} />
              ) : (
                <img src={assetImageUrl(selected!.id)} alt={selected!.id} />
              )}
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
          <strong>{name.trim() || (tileable ? "New background" : "New image")}</strong>
          <span className="faint mono">
            {tileable
              ? "1024 × 1024 · seamless tile"
              : `${size === "auto" ? "auto" : size.replace("x", " × ")} · ${background}`}
          </span>
        </>
      );
      canvas = (
        <div className="studio-center">
          <figure
            className="studio-artboard"
            style={{ "--aspect": artboardAspect(tileable ? "1024x1024" : size) } as CSSProperties}
          >
            <div className={`artboard-frame${!tileable && background === "transparent" ? " checker" : ""}`}>
              <span className="mono">
                {tileable ? "1024 × 1024 tile" : size === "auto" ? "auto size" : size.replace("x", " × ")}
              </span>
              <span className="faint">
                {!generativeOk
                  ? "New images need an OpenAI API key"
                  : tileable
                    ? "Describe the background on the right; the result is made seamless and shown tiled 3 × 3"
                    : "Describe it on the right, then create it"}
              </span>
            </div>
          </figure>
        </div>
      );
    }
  } else {
    barTitle = (
      <>
        <strong>
          {session.mode === "edit" ? "Editing" : session.create?.tileable ? "New background" : "New image"}{" "}
          {sessionTitle}
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
          {attempts.length === 0 || previewing ? versionLabel(view) : `Results from ${versionLabel(view)}`}
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
            <span className="faint small">
              {previewing
                ? `Preview of ${builtinOp(opId)?.label ?? opId} · the next run starts here`
                : "The next run starts here"}
            </span>
            <span className="spacer" />
            {lastAttempt && !previewing && lastAttempt.engine === "openai" && (
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
    } else if (previewing) {
      main = (
        <div className="studio-center">
          <figure className="studio-hero">
            <div className="checker">
              <BuiltinPreview src={lastSrc!} opId={opId} params={params} />
            </div>
          </figure>
        </div>
      );
    } else if (attempts.length === 0) {
      main = (
        <div className="studio-center">
          {viewSrc ? (
            <figure className="studio-hero">
              <div className="checker">
                {session.create?.tileable ? (
                  <TiledPreview src={viewSrc} label={`${versionLabel(view)} tiled 3 × 3`} />
                ) : (
                  <img src={viewSrc} alt={versionLabel(view)} />
                )}
              </div>
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
            title="Look for new images in the project folder, then re-read manifest.yaml"
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
              "Unsaved versions are lost when the planner closes"
            ) : (
              ""
            )}
          </span>
        </div>
      </section>

      <aside className="studio-inspector" aria-label="Image studio">
        <div className="studio-col-head">
          <span className="segmented studio-mode" role="group" aria-label="Mode">
            {(
              [
                ["edit", false, "Edit", "Change an existing image"],
                ["create", false, "Create new", "A new image from a description"],
                ["create", true, "Background", "A seamless tile for background layers"],
              ] as const
            ).map(([m, t, label, title]) => {
              const on = mode === m && (m === "edit" || tileable === t);
              return (
                <button
                  key={label}
                  type="button"
                  className={on ? "active" : ""}
                  aria-pressed={on}
                  title={title}
                  onClick={() => {
                    setTileable(t);
                    switchMode(m);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </span>
        </div>

        <div className="studio-inspector-body">
          {(serviceError ||
            (hasTarget && availability && !availability.enabled && activeEngine === "builtin")) && (
            <div className="notices">
              {serviceError && <p className="notice error">{serviceError}</p>}
              {hasTarget && availability && !availability.enabled && activeEngine === "builtin" && (
                <p className="notice warn">{availability.reason}</p>
              )}
            </div>
          )}

          {mode === "create" && !session && tileable && (
            <BackgroundSettings
              name={name}
              disabled={!generativeOk}
              onName={setName}
              onPreset={(p) => {
                setName(p.name);
                setInstruction(p.subject);
              }}
            />
          )}

          {mode === "create" && !session && !tileable && (
            <NewImageSettings
              name={name}
              size={size}
              background={background}
              disabled={!generativeOk}
              onName={setName}
              onSize={setSize}
              onBackground={setBackground}
            />
          )}

          {mode === "edit" && !selected ? (
            <p className="faint small studio-pick-hint">Pick an image on the left.</p>
          ) : (
            <>
              <InspectorSection
                title="Engine"
                note={
                  engineLabel ? (
                    <span className="mono" title="Model that runs the edit">
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
                        ["builtin", "Built-in", "Simple edits on this computer, no key"],
                        [
                          "openai",
                          "Generative",
                          generativeOk ? "GPT Image, redraws" : "GPT Image · needs an API key",
                        ],
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

              {activeEngine === "openai" && !generativeOk ? (
                <InspectorSection title="Set up GPT Image">
                  <div className="studio-setup">
                    <p className="small">
                      Generative edits and new images need an OpenAI API key (from platform.openai.com).
                    </p>
                    <p className="faint small">
                      <a href="#settings/image-generation">Set it up in Settings → Image generation</a>. The
                      built-in operations work without it.
                    </p>
                  </div>
                </InspectorSection>
              ) : activeEngine === "builtin" ? (
                <InspectorSection title="Operation">
                  <BuiltinPanel
                    opId={opId}
                    params={params}
                    disabled={busy}
                    onOp={setOpId}
                    onParams={(p) => setOpParams((all) => ({ ...all, [opId]: p }))}
                  />
                </InspectorSection>
              ) : (
                <>
                  <InspectorSection title="Prompt">
                    {!creatingNew && (
                      <div className="edit-presets" role="group" aria-label="Presets">
                        {EDIT_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            className="chip plain"
                            onClick={() => setInstruction(p.instruction)}
                          >
                            {p.label}
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
                        creatingNew && tileable
                          ? "What should the tile show? e.g. Wolken im Stil von Tattoo-Flash, locker verteilt. Pick a preset above to start."
                          : creatingNew
                            ? "What should it show? e.g. Ein rotes Dreieck als Rahmen, Linien wie im Referenzbild; or a dotwork pattern for the forearm."
                            : "What should change? e.g. Mache ein rotes Dreieck drumherum wie im Referenzbild (German is fine)."
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
                </>
              )}
            </>
          )}

          {!session && sessions.length > 0 && (
            <OpenSessions
              sessions={sessions}
              allJobs={allJobs}
              onResume={(s) => {
                resetView();
                if (s.mode === "create") {
                  setMode("create");
                  setTileable(!!s.create?.tileable);
                  setCreateSessionId(s.id);
                } else {
                  setMode("edit");
                  setSelectedId(s.assetId ?? null);
                }
              }}
            />
          )}
        </div>

        <div className="studio-run">
          {activeEngine === "builtin" ? (
            <>
              <p className="studio-estimate faint">
                <span>{runEstimate("builtin", 1)}</span>
              </p>
              <span className="studio-run-row">
                {session && last > 0 && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    title={`Drop ${versionLabel(last)} and go back to ${versionLabel(last - 1)}`}
                    onClick={undo}
                  >
                    Undo
                  </button>
                )}
                <button
                  type="button"
                  className="primary studio-run-button"
                  disabled={!canApply}
                  onClick={() => void applyOp()}
                >
                  {runLabel({
                    creatingNew,
                    version: last,
                    engine: "builtin",
                    count: 1,
                    opLabel: builtinOp(opId)?.label ?? opId,
                  })}
                </button>
              </span>
            </>
          ) : (
            <>
              {generativeOk && (
                <p className="studio-estimate faint">
                  <span>
                    {atLimit
                      ? `${MAX_RUNNING_GENERATIVE} edits are running; wait for one.`
                      : runEstimate("openai", count)}
                  </span>
                  {runningCount > 0 && (
                    <span className="mono">
                      {runningCount}/{MAX_RUNNING_GENERATIVE} running
                    </span>
                  )}
                </p>
              )}
              <button
                type="button"
                className="primary studio-run-button"
                disabled={!canRun}
                onClick={() => void run()}
              >
                {runLabel({ creatingNew, version: last, engine: "openai", count })}
                <kbd className="kbd">⌘↵</kbd>
              </button>
            </>
          )}
          {actionError && <p className="error-text small studio-run-error">{actionError}</p>}
        </div>
      </aside>
    </div>
  );
}

/** Name, format and background of a new image, fixed once its session opens. */
/** Background mode: the tile's name and the presets that fill in the description. */
function BackgroundSettings(props: {
  name: string;
  disabled: boolean;
  onName: (v: string) => void;
  onPreset: (p: (typeof BACKGROUND_PRESETS)[number]) => void;
}) {
  return (
    <InspectorSection title="New background">
      <div className="props studio-props">
        <label>
          Name
          <input
            type="text"
            value={props.name}
            maxLength={60}
            placeholder="e.g. night sky"
            disabled={props.disabled}
            onChange={(e) => props.onName(e.target.value)}
          />
        </label>
      </div>
      <div className="studio-presets" role="group" aria-label="Presets">
        {BACKGROUND_PRESETS.map((p) => (
          <button key={p.name} type="button" disabled={props.disabled} onClick={() => props.onPreset(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="faint small">
        Square and opaque, black and grey on white; the seam is fixed after each result. Saved results go to
        backgrounds/ and can be added as a layer (Layout → Layers → +).
      </p>
    </InspectorSection>
  );
}

function NewImageSettings(props: {
  name: string;
  size: CreateSize;
  background: CreateBackground;
  disabled: boolean;
  onName: (v: string) => void;
  onSize: (v: CreateSize) => void;
  onBackground: (v: CreateBackground) => void;
}) {
  return (
    <InspectorSection title="New image">
      <div className="props studio-props">
        <label>
          Name
          <input
            type="text"
            value={props.name}
            maxLength={60}
            placeholder="e.g. red triangle"
            disabled={props.disabled}
            onChange={(e) => props.onName(e.target.value)}
          />
        </label>
        <label>
          Format
          <select
            value={props.size}
            disabled={props.disabled}
            onChange={(e) => props.onSize(e.target.value as CreateSize)}
          >
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
            disabled={props.disabled}
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
  );
}

/** Sessions still open on other images (or new images), to pick up again. */
function OpenSessions({
  sessions,
  allJobs,
  onResume,
}: {
  sessions: readonly EditSession[];
  allJobs: readonly EditJob[];
  onResume: (s: EditSession) => void;
}) {
  return (
    <InspectorSection title="Open sessions" note={<span className="mono">{sessions.length}</span>}>
      <ul className="studio-open-sessions">
        {sessions.map((s) => {
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
