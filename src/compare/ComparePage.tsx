// Side-by-side comparison of two layout variants (PROJECT_BRIEF.md §14 Phase 6): both on the 3D arm
// with one camera, their coverage next to each other and the elements that differ. Read-only;
// editing stays in the Layout tab.
import { useMemo, useState } from "react";
import { useAssetListing } from "../assets/useAssets.ts";
import { useLayoutSources, type LayoutSources } from "../assets/useLayoutSources.ts";
import type { ArmProfile } from "../arm/profile.ts";
import type { Layout } from "../layout/schema.ts";
import { classify } from "../layout/shapes.ts";
import { useLayouts, type StoredLayout, type WorkingLayout } from "../layout/useLayouts.ts";
import { parseLayout } from "../layout/yamlDoc.ts";
import { coverage, type Coverage } from "../metrics/coverage.ts";
import { MetricsPanel } from "../metrics/MetricsPanel.tsx";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { ArmViewer, PoseControl, ViewButtons } from "../viewer/ArmViewer.tsx";
import { createCameraSync } from "../viewer/cameraSync.ts";
import { useViewState } from "../viewer/useViewState.ts";
import { anubisSize, type ArmState, type Pose } from "../viewer/useArm.ts";
import { diffLayouts } from "./diff.ts";
import { compareSummary } from "./summary.ts";

type Mode = "blockout" | "reference";
const WORKING = "@working";
const PX_PER_CM = 12;
const METRICS_PX_PER_CM = 6;
const DIFF_ID = "compare-diff";

type Picked = { key: string; label: string; layout: Layout | null; error: string | null };

function pick(key: string, files: StoredLayout[] | null, working: WorkingLayout | null): Picked {
  if (key === WORKING && working)
    return { key, label: `${working.name} (unsaved)`, layout: working.layout, error: null };
  const file = files?.find((f) => f.name === key);
  if (!file) return { key, label: key, layout: null, error: null };
  const r = parseLayout(file.text);
  return r.ok
    ? { key, label: key, layout: r.layout, error: null }
    : { key, label: key, layout: null, error: r.error };
}

function useCoverage(layout: Layout | null, profile: ArmProfile, src: LayoutSources): Coverage | null {
  const { aspects, patches } = src;
  return useMemo(
    () =>
      layout
        ? coverage(classify(layout, profile, METRICS_PX_PER_CM, anubisSize, 0, aspects, patches), profile)
        : null,
    [layout, profile, aspects, patches],
  );
}

type Props = {
  arm: ArmState;
  pose: Pose;
  working: WorkingLayout | null;
  /** Switches to the Layout tab (the empty state's way to create a second variant). */
  onOpenLayout?: () => void;
};

export function ComparePage({ arm, pose, working, onOpenLayout }: Props) {
  const { profile } = arm;
  const [keys, setKeys] = useState<{ a: string; b: string } | null>(null);
  const { files, error: loadError } = useLayouts((list) => {
    const names = list.map((f) => f.name);
    // Unsaved edits: compare them with the saved file; otherwise the open variant with the next one.
    const a = working?.dirty ? WORKING : working && names.includes(working.name) ? working.name : names[0];
    const b = working?.dirty ? working.name : (names.find((n) => n !== a) ?? names[0]);
    if (a && b) setKeys({ a, b });
  });
  const [mode, setMode] = useState<Mode>("blockout");
  const viewState = useViewState();
  const bus = useMemo(() => createCameraSync(), []);

  const { listing } = useAssetListing();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((x) => [x.id, x])) : null),
    [listing],
  );

  // Parsed once per choice, so the textures below only re-render when a variant really changes.
  const a = useMemo(() => (keys ? pick(keys.a, files, working) : null), [keys, files, working]);
  const b = useMemo(() => (keys ? pick(keys.b, files, working) : null), [keys, files, working]);
  const srcA = useLayoutSources(a?.layout ?? null, assetMap, listing !== null, profile);
  const srcB = useLayoutSources(b?.layout ?? null, assetMap, listing !== null, profile);
  const covA = useCoverage(a?.layout ?? null, profile, srcA);
  const covB = useCoverage(b?.layout ?? null, profile, srcB);
  const options = [
    ...(working?.dirty ? [{ value: WORKING, label: `${working.name} (unsaved edits)` }] : []),
    ...(files ?? []).map((f) => ({ value: f.name, label: f.name })),
  ];
  const diff = useMemo(() => (a?.layout && b?.layout ? diffLayouts(a.layout, b.layout) : null), [a, b]);
  const summary = diff ? compareSummary(diff, covA, covB) : null;
  const descA = a?.layout?.description ?? "";
  const descB = b?.layout?.description ?? "";
  const sameDescription = descA === descB;

  if (loadError)
    return (
      <p className="notice error" role="alert">
        {loadError}
      </p>
    );
  // One variant and no unsaved edits: A and B would be the same file.
  if (files && files.length < 2 && !working?.dirty)
    return (
      <section className="empty compare-empty">
        <h2>Only one variant so far</h2>
        <p>
          Compare shows two layout variants side by side, with their coverage and the elements that differ.
          Create a second one with <strong>Save as…</strong> in the Layout tab, or make an edit there to
          compare it with the saved file.
        </p>
        {onOpenLayout && (
          <button type="button" className="primary" onClick={onOpenLayout}>
            Open Layout
          </button>
        )}
      </section>
    );

  return (
    <div className="compare-page">
      <div className="toolbar layout-toolbar">
        <label className="inline">
          A{" "}
          <select
            value={keys?.a ?? ""}
            onChange={(e) => keys && setKeys({ ...keys, a: e.target.value })}
            disabled={!keys}
            aria-label="Variant A"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => keys && setKeys({ a: keys.b, b: keys.a })}
          disabled={!keys}
          className="ghost"
          title="Swap A and B"
          aria-label="Swap A and B"
        >
          ⇄
        </button>
        <label className="inline">
          B{" "}
          <select
            value={keys?.b ?? ""}
            onChange={(e) => keys && setKeys({ ...keys, b: e.target.value })}
            disabled={!keys}
            aria-label="Variant B"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="segmented" role="group" aria-label="Mode">
          {(["blockout", "reference"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "active" : ""}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === "blockout" ? "Blockout" : "Reference"}
            </button>
          ))}
        </span>
        <span className="spacer" />
        <ViewButtons state={viewState} sides />
        <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} />
      </div>
      <div className="compare-summary">
        {summary && (
          <button
            type="button"
            className="link compare-summary-link"
            onClick={() => {
              const el = document.getElementById(DIFF_ID);
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
              el?.focus({ preventScroll: true });
            }}
            title="Show the element differences"
          >
            {summary.text}
          </button>
        )}
        {sameDescription && descA && <span className="compare-desc">{descA}</span>}
        <span className="spacer" />
        <span className="faint small">
          Read-only: edit in the Layout tab. Drag either arm to rotate both.
        </span>
      </div>
      {a && b && (
        <div className="compare-grid">
          <CompareSide
            side="A"
            picked={a}
            other={b}
            src={srcA}
            cov={covA}
            otherCov={covB}
            showDescription={!sameDescription}
            mode={mode}
            profile={profile}
            viewState={viewState}
            bendDeg={pose.bendDeg}
            sync={{ bus, id: "a" }}
          />
          <CompareSide
            side="B"
            picked={b}
            other={a}
            src={srcB}
            cov={covB}
            otherCov={covA}
            showDescription={!sameDescription}
            mode={mode}
            profile={profile}
            viewState={viewState}
            bendDeg={pose.bendDeg}
            sync={{ bus, id: "b" }}
          />
        </div>
      )}
      {diff && a && b && (
        <section className="panel compare-diff" id={DIFF_ID} tabIndex={-1} aria-label="Element differences">
          <h2>Elements</h2>
          {diff.onlyA.length + diff.onlyB.length + diff.changed.length === 0 ? (
            <p className="muted small">Both variants have the same elements with the same values.</p>
          ) : (
            <ul className="small">
              {diff.onlyA.length > 0 && (
                <li>
                  Only in A ({a.label}): <code>{diff.onlyA.join(", ")}</code>
                </li>
              )}
              {diff.onlyB.length > 0 && (
                <li>
                  Only in B ({b.label}): <code>{diff.onlyB.join(", ")}</code>
                </li>
              )}
              {diff.changed.map((c) => (
                <li key={c.id}>
                  <code>{c.id}</code> changed: {c.fields.join(", ")}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            {diff.same.length} element{diff.same.length === 1 ? "" : "s"} identical
            {diff.same.length > 0 ? `: ${diff.same.join(", ")}` : ""}.
          </p>
        </section>
      )}
    </div>
  );
}

function CompareSide(props: {
  side: "A" | "B";
  picked: Picked;
  other: Picked;
  src: LayoutSources;
  cov: Coverage | null;
  otherCov: Coverage | null;
  showDescription: boolean;
  mode: Mode;
  profile: ArmProfile;
  viewState: ReturnType<typeof useViewState>;
  bendDeg: number;
  sync: { bus: ReturnType<typeof createCameraSync>; id: string };
}) {
  const { side, picked, other, src, cov, otherCov, mode, profile, viewState, bendDeg, sync } = props;
  const { layout } = picked;
  const { aspects, sources, loading } = src;

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    renderUnwrap(canvas, profile, mode, layout, {
      pxPerCm: PX_PER_CM,
      grid: false,
      existing: anubisSize,
      aspects,
      sources,
    });
    return canvas;
  }, [profile, mode, layout, aspects, sources]);

  return (
    <div className="compare-side">
      {picked.error && (
        <p className="notice error small">
          {picked.label}.yaml is invalid: {picked.error}
        </p>
      )}
      <ArmViewer
        profile={profile}
        canvas={texture}
        version={0}
        toolbar={false}
        viewState={viewState}
        bendDeg={bendDeg}
        sync={sync}
        label={`${side}: ${picked.label}${mode === "reference" && loading ? " (loading images…)" : ""}`}
      />
      {props.showDescription && (
        <p className="muted small compare-desc">{layout?.description || "No description."}</p>
      )}
      {cov && (
        <MetricsPanel
          coverage={cov}
          title={`Coverage ${side}`}
          compareTo={otherCov ? { coverage: otherCov, label: other.label } : undefined}
        />
      )}
    </div>
  );
}
