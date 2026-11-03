// Side-by-side comparison of two layout variants (PROJECT_BRIEF.md §14 Phase 6): both on the 3D arm
// with one camera, their coverage next to each other and the elements that differ. Read-only;
// editing stays in the Layout tab.
import { useMemo, useState } from "react";
import { useAssetListing } from "../assets/useAssets.ts";
import { useLayoutSources } from "../assets/useLayoutSources.ts";
import type { ArmProfile } from "../arm/profile.ts";
import type { Layout } from "../layout/schema.ts";
import { classify } from "../layout/shapes.ts";
import { useLayouts, type StoredLayout, type WorkingLayout } from "../layout/useLayouts.ts";
import { parseLayout } from "../layout/yamlDoc.ts";
import { coverage } from "../metrics/coverage.ts";
import { MetricsPanel } from "../metrics/MetricsPanel.tsx";
import type { AssetInfo } from "../assets/types.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { ArmViewer, PoseControl, ViewButtons } from "../viewer/ArmViewer.tsx";
import { createCameraSync } from "../viewer/cameraSync.ts";
import { useViewState } from "../viewer/useViewState.ts";
import { anubisSize, type ArmState, type Pose } from "../viewer/useArm.ts";
import { diffLayouts } from "./diff.ts";

type Mode = "blockout" | "reference";
const WORKING = "@working";
const PX_PER_CM = 12;
const METRICS_PX_PER_CM = 6;

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

type Props = { arm: ArmState; pose: Pose; working: WorkingLayout | null };

export function ComparePage({ arm, pose, working }: Props) {
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
  const options = [
    ...(working?.dirty ? [{ value: WORKING, label: `${working.name} (unsaved edits)` }] : []),
    ...(files ?? []).map((f) => ({ value: f.name, label: f.name })),
  ];
  const diff = useMemo(() => (a?.layout && b?.layout ? diffLayouts(a.layout, b.layout) : null), [a, b]);

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
          title="Swap A and B"
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
            <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {m === "blockout" ? "Blockout" : "Reference"}
            </button>
          ))}
        </span>
        <span className="spacer" />
        <span className="toolbar" role="toolbar" aria-label="Views">
          <ViewButtons state={viewState} />
        </span>
        <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} />
      </div>
      {loadError && <p className="card notice error">{loadError}</p>}
      {files && files.length < 2 && !working?.dirty && (
        <p className="card notice warn small">
          Only one variant so far. Create another with <strong>Save as…</strong> in the Layout tab.
        </p>
      )}
      <p className="muted small">
        Read-only: edit in the Layout tab. Both arms share the camera: drag either one to rotate both.
      </p>
      {a && b && (
        <div className="compare-grid">
          <CompareSide
            side="A"
            picked={a}
            other={b}
            mode={mode}
            profile={profile}
            assetMap={assetMap}
            listingLoaded={listing !== null}
            viewState={viewState}
            bendDeg={pose.bendDeg}
            sync={{ bus, id: "a" }}
          />
          <CompareSide
            side="B"
            picked={b}
            other={a}
            mode={mode}
            profile={profile}
            assetMap={assetMap}
            listingLoaded={listing !== null}
            viewState={viewState}
            bendDeg={pose.bendDeg}
            sync={{ bus, id: "b" }}
          />
        </div>
      )}
      {diff && a && b && (
        <section className="panel compare-diff" aria-label="Element differences">
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
  mode: Mode;
  profile: ArmProfile;
  assetMap: ReadonlyMap<string, AssetInfo> | null;
  listingLoaded: boolean;
  viewState: ReturnType<typeof useViewState>;
  bendDeg: number;
  sync: { bus: ReturnType<typeof createCameraSync>; id: string };
}) {
  const { side, picked, other, mode, profile, assetMap, listingLoaded, viewState, bendDeg, sync } = props;
  const { layout } = picked;
  const { aspects, sources, loading } = useLayoutSources(layout, assetMap, listingLoaded);
  const otherSources = useLayoutSources(other.layout, assetMap, listingLoaded);

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

  const cov = useMemo(
    () =>
      layout ? coverage(classify(layout, profile, METRICS_PX_PER_CM, anubisSize, 0, aspects), profile) : null,
    [layout, profile, aspects],
  );
  const otherCov = useMemo(
    () =>
      other.layout
        ? coverage(
            classify(other.layout, profile, METRICS_PX_PER_CM, anubisSize, 0, otherSources.aspects),
            profile,
          )
        : null,
    [other.layout, profile, otherSources.aspects],
  );

  return (
    <div className="compare-side">
      {picked.error && (
        <p className="card notice error small">
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
      {layout?.description && <p className="muted small">{layout.description}</p>}
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
