// Home (docs/adr/0018-home.md): the first tab. The current person's whole body with the active
// layout on every region, a card per region with a few numbers, the people of the project and a way
// into the sample. View only: every card and region opens its layout in the Layout tab.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssetListing } from "../assets/useAssets.ts";
import { REGIONS, type RegionId } from "../body/regions.ts";
import { RegionTextureSource } from "../editor/RegionTextures.tsx";
import { useLayouts } from "../layout/useLayouts.ts";
import { closeProject, openSample, reloadForProject } from "../project/api.ts";
import { AddPersonForm, bodyLine, PersonAvatar, switchPerson } from "../project/PersonSwitcher.tsx";
import { usePersons } from "../project/personsStore.ts";
import type { ProjectStatus } from "../project/schema.ts";
import { ArrowRightIcon, PauseIcon, PlayIcon, PlusIcon, StarIcon } from "../ui/icons.tsx";
import type { RegionTexture } from "../viewer/BodyViewer.tsx";
import { anubisSize, type ArmState } from "../viewer/useArm.ts";
import { BODY_VIEWS } from "../viewer/views.ts";
import { HomeViewer, type HomeView } from "./HomeViewer.tsx";
import {
  homeRegions,
  homeSummary,
  plannedSummary,
  regionStats,
  type HomeRegion,
  type RegionStats,
} from "./model.ts";

type Props = {
  project: ProjectStatus;
  arm: ArmState;
  /** Opens a region's layout in the Layout tab (its active variant; null: a new one). */
  onOpenRegion: (region: RegionId, variant: string | null) => void;
  /** Settings → Project (save the sample, manage people). */
  onOpenProject: () => void;
  /** Whether other tabs hold unsaved edits (switching person would drop them). */
  unsaved: boolean;
};

/** Turntable and picked view when Home last closed, so the way back from Layout looks the same. */
const lastStage: { spin: boolean | null; view: HomeView } = {
  spin: null,
  view: { name: "front", request: 0 },
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function HomePage({ project, arm, onOpenRegion, onOpenProject, unsaved }: Props) {
  const { persons, current } = usePersons();
  const { files, error } = useLayouts();
  const { listing } = useAssetListing();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((a) => [a.id, a])) : null),
    [listing],
  );
  const active = useMemo(() => current?.active ?? {}, [current]);
  const regions = useMemo(() => homeRegions(files ?? [], active), [files, active]);
  const stats = useMemo(
    () =>
      Object.fromEntries(
        regions.map((r) => [r.id, r.layout ? regionStats(r.layout, arm.region(r.id), anubisSize) : null]),
      ) as Record<RegionId, RegionStats | null>,
    // arm.region follows arm.body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regions, arm.body],
  );

  const summary = useMemo(() => homeSummary(regions, stats), [regions, stats]);

  const [textures, setTextures] = useState<Partial<Record<RegionId, RegionTexture>>>({});
  const onTexture = useCallback(
    (id: RegionId, t: RegionTexture | null) =>
      setTextures((m) => ((m[id] ?? null) === t ? m : { ...m, [id]: t ?? undefined })),
    [],
  );

  const [hover, setHover] = useState<RegionId | null>(null);
  const [spin, setSpin] = useState(() => lastStage.spin ?? !prefersReducedMotion());
  const [view, setView] = useState<HomeView>(() => lastStage.view);
  useEffect(() => {
    lastStage.spin = spin;
    lastStage.view = view;
  }, [spin, view]);
  const stopSpin = useCallback(() => setSpin(false), []);
  const hovered = hover ? regions.find((r) => r.id === hover) : undefined;
  const planned = regions.some((r) => r.layout && r.layout.elements.length > 0);
  const loading = files === null && !error;

  const open = (r: HomeRegion) => onOpenRegion(r.id, r.variant);

  return (
    <div className="home">
      {regions.map(
        (r) =>
          r.layout && (
            <RegionTextureSource
              key={`${r.id}:${r.variant}`}
              id={r.id}
              layout={r.layout}
              profile={arm.region(r.id)}
              mode="reference"
              grid={false}
              existing={anubisSize}
              assetMap={assetMap}
              listingLoaded={listing !== null}
              onTexture={onTexture}
            />
          ),
      )}
      <section className="home-stage" aria-label={`${current?.name ?? "The"} body in 3D`}>
        <div className="home-glow" aria-hidden="true" />
        <HomeViewer
          body={arm.body}
          textures={textures}
          hover={hover}
          onHover={setHover}
          onLeave={(id) => setHover((h) => (id === null || h === id ? null : h))}
          onPick={(id) => open(regions.find((r) => r.id === id)!)}
          spin={spin}
          onInteract={stopSpin}
          view={view}
        />
        {current && (
          <header className="home-hero">
            <div>
              <p className="home-eyebrow">
                {project.sample ? "Sample project" : (project.name ?? "Project")}
              </p>
              <h2 className="home-name">{current.name}</h2>
              <p className="home-sub">
                {bodyLine(current)} <span aria-hidden="true">·</span>{" "}
                {loading ? "Loading layouts…" : plannedSummary(regions)}
              </p>
            </div>
          </header>
        )}
        <div className={`home-hover${hovered ? " shown" : " hint"}`} aria-live="polite">
          {hovered ? (
            <>
              <strong>{REGIONS[hovered.id].label}</strong>
              <span className="home-hover-variant">
                {hovered.variant ?? "no layout yet"}
                {hovered.variant && stats[hovered.id] ? ` · ${stats[hovered.id]!.coveragePct}% covered` : ""}
              </span>
              <span className="faint">Click to {hovered.variant ? "open" : "start"}</span>
            </>
          ) : (
            <span className="faint">Drag to turn · click a region to open its layout</span>
          )}
        </div>
        {!loading && !planned && current && (
          <div className="home-empty float">
            <p className="home-empty-title">Nothing planned yet</p>
            <p className="muted small">
              Pick a region on the body or in the list, or start with the left arm. Each region can hold
              several layout variants; the one marked with a star shows here.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => open(regions.find((r) => r.id === "arm-left")!)}
            >
              Start on the left arm <ArrowRightIcon />
            </button>
          </div>
        )}
        <div className="home-bar float float-bar" role="toolbar" aria-label="Turntable">
          <button
            type="button"
            className="ghost icon-button"
            aria-pressed={spin}
            aria-label={spin ? "Stop turning" : "Turn slowly"}
            title={spin ? "Stop the turntable" : "Turn the body slowly"}
            onClick={() => setSpin((s) => !s)}
          >
            {spin ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span className="segmented" role="group" aria-label="Body view">
            {BODY_VIEWS.map((v) => (
              <button
                key={v.name}
                type="button"
                className={!spin && view.name === v.name ? "active" : ""}
                aria-pressed={!spin && view.name === v.name}
                onClick={() => {
                  setSpin(false);
                  setView((s) => ({ name: v.name, request: s.request + 1 }));
                }}
              >
                {v.label}
              </button>
            ))}
          </span>
        </div>
      </section>

      <aside className="home-side" aria-label="People and regions">
        {project.sample && <SampleBanner onSave={onOpenProject} />}
        {!loading && planned && <SummaryTiles summary={summary} />}
        <PeopleSection
          persons={persons}
          currentId={current?.id ?? null}
          sample={project.sample}
          unsaved={unsaved}
          onManage={onOpenProject}
        />
        <section className="home-section">
          <h3 className="home-section-title">Regions</h3>
          {error && <p className="notice error">{error}</p>}
          <ul className="region-cards" role="list">
            {regions.map((r) => (
              <li key={r.id}>
                <RegionCard
                  region={r}
                  stats={stats[r.id]}
                  texture={textures[r.id]}
                  hovered={hover === r.id}
                  onHover={(on) => setHover(on ? r.id : (h) => (h === r.id ? null : h))}
                  onOpen={() => open(r)}
                />
              </li>
            ))}
          </ul>
        </section>
        {!project.sample && project.sampleAvailable && <SampleInvite />}
      </aside>
    </div>
  );
}

function SummaryTiles({ summary }: { summary: ReturnType<typeof homeSummary> }) {
  return (
    <dl className="home-summary" aria-label="Overview" title="Coverage is the mean over the planned regions">
      <div>
        <dt>Planned</dt>
        <dd>
          {summary.planned}
          <span className="faint"> / {summary.total}</span>
        </dd>
      </div>
      <div>
        <dt>Motifs</dt>
        <dd>{summary.motifs}</dd>
      </div>
      <div>
        <dt>Coverage</dt>
        <dd>
          {summary.averagePct ?? 0}
          <span className="faint">%</span>
        </dd>
      </div>
    </dl>
  );
}

function RegionCard(props: {
  region: HomeRegion;
  stats: RegionStats | null;
  texture: RegionTexture | undefined;
  hovered: boolean;
  onHover: (on: boolean) => void;
  onOpen: () => void;
}) {
  const { region: r, stats, texture, hovered } = props;
  const label = REGIONS[r.id].label;
  return (
    <button
      type="button"
      className={`region-card${hovered ? " hovered" : ""}${r.layout ? "" : " unplanned"}`}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      onFocus={() => props.onHover(true)}
      onBlur={() => props.onHover(false)}
      onClick={props.onOpen}
      aria-label={
        r.variant
          ? `${label}: ${r.variant}${stats ? `, ${stats.coveragePct}% covered, ${stats.motifs} motifs` : ""}. Open in Layout`
          : `${label}: no layout yet. Start one in Layout`
      }
    >
      <span className="region-thumb" aria-hidden="true">
        {texture && r.layout ? (
          <TextureThumb canvas={texture.canvas} />
        ) : (
          <span className="region-thumb-empty" />
        )}
      </span>
      <span className="region-card-body">
        <span className="region-card-title">{label}</span>
        {r.error ? (
          <span className="region-card-stats error-text">The layout file has errors</span>
        ) : stats ? (
          <>
            <span className="region-card-stats">
              <span className="num">{stats.motifs}</span> {stats.motifs === 1 ? "motif" : "motifs"}
              {r.variants > 1 && (
                <>
                  {" "}
                  <span aria-hidden="true">·</span> <span className="num">{r.variants}</span> variants
                </>
              )}
            </span>
            {r.variants > 1 && r.variant && (
              <span
                className="region-card-variant"
                title={r.marked ? "Marked active" : "First variant (none marked)"}
              >
                {r.marked && <StarIcon filled />}
                Showing: {r.variant}
              </span>
            )}
            <span className="coverage-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, stats.coveragePct)}%` }} />
            </span>
          </>
        ) : (
          <span className="region-card-stats region-card-start">Start planning</span>
        )}
      </span>
      {stats && !r.error && (
        <span className="region-card-pct">
          <span className="num">{stats.coveragePct}</span>
          <span className="unit">% covered</span>
        </span>
      )}
      <span className="region-card-go" aria-hidden="true">
        {r.layout ? <ArrowRightIcon /> : <PlusIcon />}
      </span>
    </button>
  );
}

/** The region's unwrap texture, fitted into the card's thumbnail. */
function TextureThumb({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || canvas.width === 0 || canvas.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(el.clientWidth * dpr);
    const h = Math.round(el.clientHeight * dpr);
    el.width = w;
    el.height = h;
    // Contain: the whole unwrap, as a strip on the card.
    const scale = Math.min(w / canvas.width, h / canvas.height);
    const dw = canvas.width * scale;
    const dh = canvas.height * scale;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }, [canvas]);
  return <canvas ref={ref} className="region-thumb-canvas" />;
}

function PeopleSection(props: {
  persons: ReturnType<typeof usePersons>["persons"];
  currentId: string | null;
  sample: boolean;
  unsaved: boolean;
  onManage: () => void;
}) {
  const { persons, currentId, sample, unsaved } = props;
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (persons.length === 0) return null;
  const go = (id: string) => {
    if (id === currentId) return;
    if (unsaved && !window.confirm("Unsaved changes in other tabs will be lost. Switch anyway?")) return;
    switchPerson(id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h3 className="home-section-title">People</h3>
        <span className="home-section-actions">
          <button
            type="button"
            className="ghost small home-add-button"
            onClick={() => setAdding((a) => !a)}
            disabled={sample}
            aria-expanded={adding}
            aria-controls="home-add-person"
            title={sample ? "The sample is read-only: save it as a project to add people" : "Add a person"}
          >
            <PlusIcon /> Add person
          </button>
          <button type="button" className="link small" onClick={props.onManage}>
            Manage
          </button>
        </span>
      </div>
      <div className="people-row">
        {persons.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`person-card${p.id === currentId ? " current" : ""}`}
            aria-current={p.id === currentId ? "true" : undefined}
            onClick={() => go(p.id)}
            title={p.id === currentId ? `Showing ${p.name}` : `Show ${p.name}'s body and layouts`}
          >
            <PersonAvatar person={p} />
            <span className="person-card-text">
              <span className="person-card-name">{p.name}</span>
              <span className="faint small">{bodyLine(p, false)}</span>
            </span>
          </button>
        ))}
      </div>
      {adding && (
        <div className="home-add-person" id="home-add-person">
          <p className="popover-title">Add a person</p>
          <p className="muted small">
            They get their own body, measurements and layouts; the image library stays shared.
          </p>
          <AddPersonForm onCancel={() => setAdding(false)} />
        </div>
      )}
      {error && <p className="field-hint error">{error}</p>}
    </section>
  );
}

function SampleBanner({ onSave }: { onSave: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="home-sample-banner" aria-label="Sample project">
      <p className="home-sample-title">You are exploring the sample</p>
      <p className="muted small">
        Two people with a layout on every region. Look around and try the tools; nothing here is saved.
      </p>
      <div className="toolbar">
        <button type="button" className="primary" onClick={onSave}>
          Save as my project…
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            closeProject()
              .then(reloadForProject)
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          Leave the sample
        </button>
      </div>
      {error && <p className="field-hint error">{error}</p>}
    </section>
  );
}

function SampleInvite() {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="home-sample-invite" aria-label="Sample project">
      <div>
        <p className="home-sample-title">Explore the sample</p>
        <p className="muted small">
          Two people, a layout on every region. Read-only; your project stays as it is.
        </p>
      </div>
      <button
        type="button"
        onClick={() =>
          openSample()
            .then(reloadForProject)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        }
      >
        Open sample <ArrowRightIcon />
      </button>
      {error && <p className="field-hint error">{error}</p>}
    </section>
  );
}
