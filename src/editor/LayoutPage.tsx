import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AssetBrowser } from "../assets/AssetBrowser.tsx";
import type { AssetInfo } from "../assets/types.ts";
import { useAssetListing } from "../assets/useAssets.ts";
import { useLayoutSources } from "../assets/useLayoutSources.ts";
import { defaultFilter, isFigureLike } from "../layout/imageFit.ts";
import {
  layoutSchema,
  ELEMENT_TYPES,
  type ElementType,
  type Layout,
  type LayoutElement,
} from "../layout/schema.ts";
import { classify, pickElement, resolveElement } from "../layout/shapes.ts";
import { useLayouts, type StoredLayout, type WorkingLayout } from "../layout/useLayouts.ts";
import { parseLayout } from "../layout/yamlDoc.ts";
import { coverage } from "../metrics/coverage.ts";
import { MetricsPanel } from "../metrics/MetricsPanel.tsx";
import { renderUnwrap, timed, type RenderMode } from "../render/unwrapCanvas.ts";
import { ExportButton } from "../export/ExportButton.tsx";
import type { ExportInput } from "../export/runExport.ts";
import { ArmViewer } from "../viewer/ArmViewer.tsx";
import { anubisSize, INPUT_COUNT, type ArmState, type Pose } from "../viewer/useArm.ts";
import { newElement, reorder, suggestVariantName, uniqueId } from "./edit.ts";
import { applyStroke, type UV } from "./stroke.ts";
import { ElementPanel } from "./ElementPanel.tsx";
import { UnwrapEditor } from "./UnwrapEditor.tsx";

const MODES: { id: RenderMode; label: string }[] = [
  { id: "blockout", label: "Blockout" },
  { id: "reference", label: "Reference" },
  { id: "grid", label: "cm grid" },
];

const HINTS: Record<RenderMode, string | undefined> = {
  blockout: "Dark grey: figures, light grey: fillers, striped: bands, red: lines, outlined: existing tattoo.",
  reference:
    "Reference images cut to their boxes (grayscale on the forearm by default), patterns for fillers and bands, red lines on top.",
  grid: undefined,
};

/** Texture and editor resolution; blockout shapes are flat, so 12 px per cm is plenty. */
const PX_PER_CM = 12;
/** Metrics resolution: 6 px per cm gives areas within a fraction of a percent. */
const METRICS_PX_PER_CM = 6;

type Props = {
  arm: ArmState;
  pose: Pose;
  /** Reports the open variant and its unsaved state (the Compare tab offers unsaved edits). */
  onWorking?: (w: WorkingLayout | null) => void;
};

export function LayoutPage({ arm, pose, onWorking }: Props) {
  const { profile } = arm;
  const [name, setName] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [viewerToolbar, setViewerToolbar] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<RenderMode>("blockout");
  const [grid, setGrid] = useState(true);
  const [centerU, setCenterU] = useState(0);
  // Brush tool (Phase 6): draw red lines on the 3D arm.
  const [drawing, setDrawing] = useState(false);
  const [appendStrokes, setAppendStrokes] = useState(false);

  const open = (fileName: string, list: StoredLayout[] | null) => {
    const file = list?.find((f) => f.name === fileName);
    if (!file) return;
    const r = parseLayout(file.text);
    setName(fileName);
    setSelected(null);
    setSaveError(null);
    if (r.ok) {
      setLayout(r.layout);
      setSavedJson(JSON.stringify(r.layout));
      setParseError(null);
    } else {
      setLayout(null);
      setParseError(r.error);
    }
  };

  const {
    files,
    error: loadError,
    save,
  } = useLayouts((list) => {
    // Open v1-baseline (or the first variant) once the list arrives.
    const first = list.find((f) => f.name === "v1-baseline") ?? list[0];
    if (first) open(first.name, list);
  });

  // Assets: the manifest listing and the decoded images of every asset the layout uses.
  const { listing, reload: reloadAssets } = useAssetListing();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((a) => [a.id, a])) : null),
    [listing],
  );
  const {
    aspects,
    patches,
    patchIssues,
    sources,
    loading: loadingImages,
  } = useLayoutSources(layout, assetMap, listing !== null, profile);

  const dirty = layout !== null && JSON.stringify(layout) !== savedJson;
  useEffect(() => {
    onWorking?.(name && layout ? { name, layout, dirty } : null);
  }, [onWorking, name, layout, dirty]);
  const validation = useMemo(() => (layout ? layoutSchema.safeParse(layout) : null), [layout]);
  const validationError =
    validation && !validation.success
      ? validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : null;

  // 3D texture: always centred on the outer line. The render time is shown next to the mode switch.
  const { canvas: texture, ms: renderMs } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ms = timed(() =>
      renderUnwrap(canvas, profile, mode, layout, {
        pxPerCm: PX_PER_CM,
        grid,
        existing: anubisSize,
        selected: selected ?? undefined,
        aspects,
        sources,
      }),
    );
    return { canvas, ms };
  }, [profile, mode, layout, grid, selected, aspects, sources]);

  // Editor image: centred on the chosen line.
  const editorImage = useMemo(() => {
    if (centerU === 0) return texture;
    const canvas = document.createElement("canvas");
    renderUnwrap(canvas, profile, mode, layout, {
      pxPerCm: PX_PER_CM,
      grid,
      existing: anubisSize,
      selected: selected ?? undefined,
      centerU,
      aspects,
      sources,
    });
    return canvas;
  }, [texture, centerU, profile, mode, layout, grid, selected, aspects, sources]);

  const metrics = useMemo(
    () =>
      layout
        ? coverage(classify(layout, profile, METRICS_PX_PER_CM, anubisSize, 0, aspects, patches), profile)
        : null,
    [layout, profile, aspects, patches],
  );

  const flagsFor = useMemo(() => {
    if (!layout) return [];
    const cls = classify(
      { ...layout, elements: layout.elements },
      profile,
      1,
      anubisSize,
      0,
      aspects,
      patches,
    );
    return cls.resolved.map((r) => r.flags);
  }, [layout, profile, aspects, patches]);
  // Clicking a figure on the 3D arm selects it in the editor (topmost element at that point).
  const resolvedEls = useMemo(
    () =>
      layout?.elements.map((el) =>
        resolveElement(el, profile, anubisSize, aspects?.get(el.id), patches?.get(el.id)),
      ) ?? [],
    [layout, profile, aspects, patches],
  );
  const pickOnArm = (p: UV) => setSelected(pickElement(resolvedEls, profile, p.u, p.v));

  const flagged =
    layout?.elements.filter((_, i) => flagsFor[i]?.includes("height not set")).map((e) => e.id) ?? [];

  // Export: the saved layout exactly as shown, once every image it uses has loaded.
  const exportInput = useMemo<ExportInput | null>(
    () =>
      layout
        ? {
            layout,
            profile,
            existing: anubisSize,
            aspects,
            sources,
            placeholderMeasurements: arm.placeholders,
            measurementCount: INPUT_COUNT,
          }
        : null,
    [layout, profile, aspects, sources, arm.placeholders],
  );
  const exportBlocked = validationError
    ? "Fix the layout errors first."
    : dirty
      ? "Save first, so the handout matches the YAML."
      : loadingImages
        ? "Waiting for the reference images to load."
        : null;

  const update = (fn: (l: Layout) => Layout) => setLayout((l) => (l ? fn(l) : l));
  const setElement = (index: number, el: LayoutElement) =>
    update((l) => ({ ...l, elements: l.elements.map((e, i) => (i === index ? el : e)) }));

  const addElement = (type: ElementType) => {
    if (!layout) return;
    const el = newElement(
      type,
      centerU,
      0.5,
      layout.elements.map((e) => e.id),
    );
    update((l) => ({ ...l, elements: [...l.elements, el] }));
    setSelected(layout.elements.length);
  };

  const doSave = async (target: Layout, from?: string) => {
    setSaveError(null);
    try {
      await save(target, from);
      setName(target.name);
      setLayout(target);
      setSavedJson(JSON.stringify(target));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveAs = () => {
    if (!layout) return;
    const input = window.prompt(
      "Name of the new variant (lowercase letters, digits, dashes). It starts as a copy of what you see now, comments included; the open variant stays as saved.",
      suggestVariantName(
        layout.name,
        (files ?? []).map((f) => f.name),
      ),
    );
    if (!input) return;
    const newName = input.trim().toLowerCase();
    if (files?.some((f) => f.name === newName) && !window.confirm(`${newName} exists. Overwrite?`)) return;
    // Comments come from the file the variant was opened from.
    void doSave({ ...layout, name: newName }, name ?? undefined);
  };

  const switchTo = (next: string) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    open(next, files);
  };

  const sel = selected !== null && layout ? layout.elements[selected] : undefined;
  const appendTarget = appendStrokes && sel?.type === "line" && !sel.locked ? selected : null;
  const onStroke = (samples: UV[]) => {
    if (!layout) return;
    const r = applyStroke(profile, layout, samples, appendTarget);
    if (!r) return;
    setLayout(r.layout);
    setSelected(r.index);
  };
  const selAsset: AssetInfo | null | undefined =
    sel && isFigureLike(sel) && sel.asset && assetMap ? (assetMap.get(sel.asset) ?? null) : undefined;
  const assignBlocked = !sel
    ? "Select a figure first, then click an image to assign it."
    : !isFigureLike(sel)
      ? "Only figures and existing tattoos take an image."
      : sel.locked
        ? `${sel.id} is locked: unlock it to change its image.`
        : null;
  const pickAsset = (a: AssetInfo) => {
    if (selected === null || !sel || !isFigureLike(sel) || sel.locked) return;
    // A new image gets its own cut-out: drop a crop that belonged to the old one.
    setElement(selected, { ...sel, asset: a.id, crop: sel.asset === a.id ? sel.crop : undefined });
  };

  // Errors stay as banners; warnings fold into one compact group when there are several.
  const warnings: { key: string; text: ReactNode }[] = [
    ...(arm.placeholders.length > 0
      ? [
          {
            key: "placeholder",
            text: (
              <>
                Placeholder arm: {arm.placeholders.length} of {INPUT_COUNT} values not measured yet;
                proportions are generic until <code>config/measurements.yaml</code> is filled in.
              </>
            ),
          },
        ]
      : []),
    ...[...patchIssues].map(([id, issue]) => ({
      key: `patch-${id}`,
      text: (
        <>
          {id}: {patches.has(id) ? "" : "projection not shown, the element's own box is used instead: "}
          {issue}.
        </>
      ),
    })),
    ...(flagged.length > 0
      ? [{ key: "height", text: <>Height not set, shown at 10 cm: {flagged.join(", ")}.</> }]
      : []),
  ];
  const errors = [loadError, parseError, validationError, saveError].some(Boolean);

  return (
    <div className="layout-page">
      <div className="toolbar layout-toolbar">
        <label className="inline">
          <span className="toolbar-label">Variant</span>
          <select value={name ?? ""} onChange={(e) => switchTo(e.target.value)} disabled={!files}>
            {(files ?? []).map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
                {f.name === name && dirty ? " *" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={dirty ? "primary" : ""}
          onClick={() => layout && void doSave(layout)}
          disabled={!dirty || !!validationError}
          title={dirty ? "Save the changes to the variant's YAML file" : "No unsaved changes"}
        >
          Save
        </button>
        <button
          type="button"
          onClick={saveAs}
          disabled={!layout || !!validationError}
          title="Duplicate: save what you see as a new variant to try an alternative"
        >
          Save as…
        </button>
        <span className="toolbar-sep" aria-hidden="true" />
        <ExportButton input={exportInput} blocked={exportBlocked} />
        <span className="spacer" />
        <span
          className="segmented"
          role="group"
          aria-label="Mode"
          title={`Texture render time: ${Math.round(renderMs)} ms`}
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={mode === m.id ? "active" : ""}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </span>
        <span className="render-ms" data-render-ms={renderMs.toFixed(1)} title="Texture render time">
          {Math.round(renderMs)} ms
        </span>
        <label className="inline check">
          <input
            type="checkbox"
            checked={grid}
            onChange={(e) => setGrid(e.target.checked)}
            disabled={mode === "grid"}
          />
          Grid overlay
        </label>
        <span className="toolbar-sep" aria-hidden="true" />
        <span className="toolbar-label">Centred</span>
        <span className="segmented" role="group" aria-label="Editor centre">
          <button
            type="button"
            className={centerU === 0 ? "active" : ""}
            aria-pressed={centerU === 0}
            onClick={() => setCenterU(0)}
            title="Centre the 2D editor on the outer side"
          >
            Outer side
          </button>
          <button
            type="button"
            className={centerU === 0.5 ? "active" : ""}
            aria-pressed={centerU === 0.5}
            onClick={() => setCenterU(0.5)}
            title="Centre the 2D editor on the inner side"
          >
            Inner side
          </button>
        </span>
      </div>

      {(errors || warnings.length > 0) && (
        <div className="notices">
          {loadError && <p className="notice error">{loadError}</p>}
          {parseError && (
            <p className="notice error" role="alert">
              <strong>{name}.yaml is invalid:</strong> {parseError}
            </p>
          )}
          {validationError && <p className="notice error">Not saved: {validationError}</p>}
          {saveError && <p className="notice error">Save failed: {saveError}</p>}
          {warnings.length === 1 && (
            <p className="notice warn" role="status">
              {warnings[0]!.text}
            </p>
          )}
          {warnings.length > 1 && (
            <details className="notice warn notice-group">
              <summary>
                <strong>{warnings.length} notices</strong>
                <span className="notice-preview">{warnings[0]!.text}</span>
              </summary>
              <ul>
                {warnings.map((w) => (
                  <li key={w.key}>{w.text}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {layout && (
        <div className="layout-grid">
          <div className="editor-head">
            <div className="toolbar">
              <span className="toolbar-label">Add</span>
              {ELEMENT_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => addElement(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="viewer-head">
            <button
              type="button"
              className={`draw-button${drawing ? " active" : ""}`}
              aria-pressed={drawing}
              onClick={() => setDrawing((d) => !d)}
              title="Drag on the 3D arm to draw a red line; it becomes a line element you can edit in the 2D editor"
            >
              Draw red line
            </button>
            <div ref={setViewerToolbar} className="viewer-tools" />
          </div>
          <div className="editor-col">
            <UnwrapEditor
              key={`${profile.length}:${profile.maxCircumference}`}
              profile={profile}
              layout={layout}
              existing={anubisSize}
              aspects={aspects}
              patches={patches}
              image={editorImage}
              version={0}
              centerU={centerU}
              selected={selected}
              onSelect={setSelected}
              onChange={setElement}
            />
          </div>
          <div className="viewer-col">
            <ArmViewer
              profile={profile}
              canvas={texture}
              version={0}
              hint={HINTS[mode]}
              bendDeg={pose.bendDeg}
              onBendDeg={pose.setBendDeg}
              draw={{ active: drawing, onStroke }}
              onPick={pickOnArm}
              toolbarTarget={viewerToolbar}
              overlay={
                drawing && (
                  <div className="canvas-toolbar top">
                    {sel?.type === "line" && !sel.locked && (
                      <label className="inline check">
                        <input
                          type="checkbox"
                          checked={appendStrokes}
                          onChange={(e) => setAppendStrokes(e.target.checked)}
                        />
                        continue {sel.id}
                      </label>
                    )}
                    <span>
                      {appendTarget !== null
                        ? `Strokes extend ${sel?.id} at its nearer end.`
                        : "Each stroke becomes a new red line."}{" "}
                      <span className="muted">Rotation is off (right-drag pans, scroll zooms).</span>
                    </span>
                  </div>
                )
              }
            />
          </div>
          <div className="side-col">
            {sel && selected !== null ? (
              <ElementPanel
                element={sel}
                asset={selAsset}
                autoFilter={isFigureLike(sel) ? defaultFilter(sel, profile) : "none"}
                flags={flagsFor[selected] ?? []}
                index={selected}
                count={layout.elements.length}
                onChange={(el) => setElement(selected, el)}
                onLayer={(dir) => {
                  update((l) => ({ ...l, elements: reorder(l.elements, selected, dir) }));
                  setSelected(Math.min(layout.elements.length - 1, Math.max(0, selected + dir)));
                }}
                onDelete={() => {
                  update((l) => ({ ...l, elements: l.elements.filter((_, i) => i !== selected) }));
                  setSelected(null);
                }}
                onDuplicate={() => {
                  const copy = {
                    ...sel,
                    id: uniqueId(
                      sel.id,
                      layout.elements.map((e) => e.id),
                    ),
                  };
                  update((l) => ({ ...l, elements: [...l.elements, copy] }));
                  setSelected(layout.elements.length);
                }}
              />
            ) : (
              <section className="panel">
                <h2>{layout.name}</h2>
                <label className="props">
                  description
                  <textarea
                    rows={3}
                    value={layout.description ?? ""}
                    onChange={(e) => update((l) => ({ ...l, description: e.target.value || undefined }))}
                  />
                </label>
                <p className="muted small">
                  {layout.elements.length} elements. Select one in the editor to edit it.
                </p>
              </section>
            )}
            <AssetBrowser
              listing={listing}
              onReload={reloadAssets}
              current={sel && isFigureLike(sel) ? sel.asset : undefined}
              assignBlocked={assignBlocked}
              onPick={pickAsset}
            />
            {metrics && <MetricsPanel coverage={metrics} />}
          </div>
        </div>
      )}
    </div>
  );
}
