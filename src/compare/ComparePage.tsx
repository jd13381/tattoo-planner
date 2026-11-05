// Side-by-side comparison of two layout variants (PROJECT_BRIEF.md §14 Phase 6): both on the 3D arm
// with one camera, their coverage next to each other and the elements that differ. Read-only;
// editing stays in the Layout tab.
//
// Full-bleed workspace: the two arms meet at a seam in the middle, each with its coverage table
// floating at its outer edge; the A/B pickers (swap on the seam), mode and view float on top; the
// summary, the pose and the element differences sit in the inspector column on the right.
import { useMemo, useState, type ReactNode } from "react";
import { useAssetListing } from "../assets/useAssets.ts";
import { useLayoutSources, type LayoutSources } from "../assets/useLayoutSources.ts";
import type { RegionProfile } from "../body/profile.ts";
import type { Layout } from "../layout/schema.ts";
import { classify } from "../layout/shapes.ts";
import { useLayouts, type StoredLayout, type WorkingLayout } from "../layout/useLayouts.ts";
import { parseLayout } from "../layout/yamlDoc.ts";
import { coverage, DIFF_THRESHOLD_PCT, type Coverage } from "../metrics/coverage.ts";
import { MetricsPanel } from "../metrics/MetricsPanel.tsx";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { SwapIcon } from "../ui/icons.tsx";
import { ArmViewer, ORBIT_HINT, PoseControl, ViewButtons } from "../viewer/ArmViewer.tsx";
import { createCameraSync } from "../viewer/cameraSync.ts";
import { useViewState } from "../viewer/useViewState.ts";
import { anubisSize, type ArmState, type Pose } from "../viewer/useArm.ts";
import { diffLayouts } from "./diff.ts";
import { compareSummary } from "./summary.ts";

type Mode = "blockout" | "reference";
type Side = "a" | "b";
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

function useCoverage(layout: Layout | null, profile: RegionProfile, src: LayoutSources): Coverage | null {
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
  const [keys, setKeys] = useState<Record<Side, string> | null>(null);
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
      <div className="compare-page cmp-blank">
        <p className="notice error" role="alert">
          {loadError}
        </p>
      </div>
    );
  // One variant and no unsaved edits: A and B would be the same file.
  if (files && files.length < 2 && !working?.dirty)
    return (
      <div className="compare-page cmp-blank">
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
      </div>
    );

  const sides = [
    { side: "a", picked: a, other: b, src: srcA, cov: covA, otherCov: covB },
    { side: "b", picked: b, other: a, src: srcB, cov: covB, otherCov: covA },
  ] as const;
  const differing = diff ? diff.onlyA.length + diff.onlyB.length + diff.changed.length : 0;

  return (
    <div className="compare-page">
      <div className="cmp-arms">
        {a && b ? (
          sides.map((s) => (
            <CompareSide
              key={s.side}
              side={s.side}
              picked={s.picked!}
              other={s.other!}
              src={s.src}
              cov={s.cov}
              otherCov={s.otherCov}
              mode={mode}
              profile={profile}
              viewState={viewState}
              bendDeg={pose.bendDeg}
              sync={{ bus, id: s.side }}
            />
          ))
        ) : (
          <p className="cmp-loading faint">Loading variants…</p>
        )}

        <div className="float float-bar cmp-mode-bar">
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
        </div>

        <div className="cmp-pickers" role="group" aria-label="Variants">
          {sides.map(({ side, picked }) => (
            <div key={side} className={`float float-bar cmp-picker cmp-picker-${side}`}>
              <span className="cmp-badge" aria-hidden="true">
                {side.toUpperCase()}
              </span>
              <span className="select-wrap">
                <select
                  className="variant-select"
                  value={keys?.[side] ?? ""}
                  onChange={(e) => keys && setKeys({ ...keys, [side]: e.target.value })}
                  disabled={!keys}
                  aria-label={`Variant ${side.toUpperCase()}`}
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {keys?.[side] === WORKING && (
                  <span className="dirty-dot" role="img" aria-label="unsaved edits" title="Unsaved edits" />
                )}
              </span>
              {picked?.error && (
                <span className="chip error" title={picked.error}>
                  invalid
                </span>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => keys && setKeys({ a: keys.b, b: keys.a })}
            disabled={!keys}
            className="float icon-button cmp-swap"
            title="Swap A and B"
            aria-label="Swap A and B"
          >
            <SwapIcon />
          </button>
        </div>

        <div className="float float-bar cmp-view-bar" title={`${ORBIT_HINT} Both arms move together.`}>
          <ViewButtons state={viewState} sides />
        </div>
      </div>

      <aside className="cmp-inspector" aria-label="Comparison">
        <section className="float cmp-summary" aria-label="Summary">
          <div className="float-head">
            <h2 className="float-title">Comparison</h2>
            <span className="spacer" />
            <span className="chip plain muted">read-only</span>
          </div>
          <div className="cmp-summary-body">
            {summary ? (
              <>
                <button
                  type="button"
                  className="link cmp-summary-line"
                  onClick={() => document.getElementById(DIFF_ID)?.focus()}
                  title={`${summary.text}: show the element differences`}
                >
                  {differing === 0
                    ? "Same elements"
                    : `${differing} element${differing === 1 ? " differs" : "s differ"}`}
                </button>
                {summary.open && <OpenSkin open={summary.open} />}
              </>
            ) : (
              <p className="faint small cmp-none">
                {a && b ? "Pick two valid variants to compare them." : "Loading…"}
              </p>
            )}
            <dl className="cmp-descs">
              {sameDescription ? (
                descA && (
                  <div>
                    <dt className="cmp-badge pair" title="Both variants">
                      AB
                    </dt>
                    <dd>{descA}</dd>
                  </div>
                )
              ) : (
                <>
                  <div>
                    <dt className="cmp-badge">A</dt>
                    <dd>{descA || <span className="faint">No description.</span>}</dd>
                  </div>
                  <div>
                    <dt className="cmp-badge">B</dt>
                    <dd>{descB || <span className="faint">No description.</span>}</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="cmp-legend faint">
              Coverage cells tinted where a variant has <span className="cmp-swatch more">more</span> or{" "}
              <span className="cmp-swatch less">less</span> than the other, by {DIFF_THRESHOLD_PCT}+ points;
              hover for the difference.
            </p>
          </div>
        </section>

        <div className="float cmp-pose">
          <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} variant="panel" />
        </div>

        <section className="float cmp-diff" id={DIFF_ID} tabIndex={-1} aria-label="Element differences">
          <div className="float-head">
            <h2 className="float-title">Elements</h2>
            <span className="spacer" />
            {diff && (
              <span className="faint mono cmp-count" title="Differing / all elements">
                {differing} / {differing + diff.same.length}
              </span>
            )}
          </div>
          {diff && a && b ? (
            <div className="cmp-diff-body">
              {differing === 0 && (
                <p className="faint small cmp-none">
                  Both variants have the same elements with the same values.
                </p>
              )}
              {diff.onlyA.length > 0 && (
                <DiffGroup title="Only in A" sub={a.label}>
                  {diff.onlyA.map((id) => (
                    <li key={id} className="cmp-row">
                      <span className="cmp-tag">A</span>
                      <code>{id}</code>
                    </li>
                  ))}
                </DiffGroup>
              )}
              {diff.onlyB.length > 0 && (
                <DiffGroup title="Only in B" sub={b.label}>
                  {diff.onlyB.map((id) => (
                    <li key={id} className="cmp-row">
                      <span className="cmp-tag">B</span>
                      <code>{id}</code>
                    </li>
                  ))}
                </DiffGroup>
              )}
              {diff.changed.length > 0 && (
                <DiffGroup title="Changed">
                  {diff.changed.map((c) => (
                    <li key={c.id} className="cmp-row">
                      <span className="cmp-tag changed" title="Changed">
                        Δ
                      </span>
                      <code>{c.id}</code>
                      <span className="cmp-fields">
                        {c.fields.map((f) => (
                          <span key={f} className="cmp-field mono">
                            {f}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </DiffGroup>
              )}
              <DiffGroup title="Identical" count={diff.same.length}>
                <li className="cmp-same">{diff.same.length > 0 ? diff.same.join(", ") : "none"}</li>
              </DiffGroup>
            </div>
          ) : (
            <p className="faint small cmp-none">
              {a && b ? "No element list without two valid variants." : "Loading…"}
            </p>
          )}
        </section>
        <p className="cmp-hint faint">Read-only: edit in the Layout tab. Drag either arm to rotate both.</p>
      </aside>
    </div>
  );
}

/** Whole-arm open skin, A → B, with the change in points. */
function OpenSkin({ open }: { open: { a: number; b: number } }) {
  const d = open.b - open.a;
  return (
    <div className="cmp-open">
      <span className="cmp-open-label">Open skin</span>
      <span className="cmp-open-values mono">
        {open.a}
        <span className="faint"> % → </span>
        {open.b}
        <span className="faint"> %</span>
      </span>
      <span className={`cmp-delta mono${d !== 0 ? " changed" : ""}`} title="Whole arm, B minus A, in points">
        {d > 0 ? "+" : d < 0 ? "−" : "±"}
        {Math.abs(d)}
      </span>
    </div>
  );
}

function DiffGroup(props: { title: string; sub?: string; count?: number; children: ReactNode }) {
  return (
    <div className="cmp-group">
      <h3 className="section-label">
        {props.title}
        {props.sub && <span className="cmp-group-sub"> · {props.sub}</span>}
        {props.count !== undefined && <span className="cmp-group-sub mono"> {props.count}</span>}
      </h3>
      <ul>{props.children}</ul>
    </div>
  );
}

function CompareSide(props: {
  side: Side;
  picked: Picked;
  other: Picked;
  src: LayoutSources;
  cov: Coverage | null;
  otherCov: Coverage | null;
  mode: Mode;
  profile: RegionProfile;
  viewState: ReturnType<typeof useViewState>;
  bendDeg: number;
  sync: { bus: ReturnType<typeof createCameraSync>; id: string };
}) {
  const { side, picked, other, src, cov, otherCov, mode, profile, viewState, bendDeg, sync } = props;
  const { layout } = picked;
  const { aspects, sources } = src;
  const letter = side.toUpperCase();

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
    <section className={`cmp-side cmp-side-${side}`} aria-label={`Arm ${letter}: ${picked.label}`}>
      <ArmViewer
        profile={profile}
        canvas={texture}
        version={0}
        toolbar={false}
        viewState={viewState}
        bendDeg={bendDeg}
        sync={sync}
      />
      {(picked.error || (mode === "reference" && src.loading)) && (
        <div className="cmp-side-status">
          {picked.error && (
            <p className="notice error compact" role="alert">
              {picked.label}.yaml is invalid: {picked.error}
            </p>
          )}
          {mode === "reference" && src.loading && (
            <span className="float chip plain" role="status">
              Loading images…
            </span>
          )}
        </div>
      )}
      {cov && (
        <MetricsPanel
          coverage={cov}
          title={`Coverage ${letter}`}
          variant="float"
          compareTo={otherCov ? { coverage: otherCov, label: other.label } : undefined}
        />
      )}
    </section>
  );
}
