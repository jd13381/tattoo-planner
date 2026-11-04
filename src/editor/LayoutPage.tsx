import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { Popover } from "../ui/Popover.tsx";
import { RedoIcon, UndoIcon } from "../ui/icons.tsx";
import { ToastRegion, useToast } from "../ui/Toast.tsx";
import { newElement, suggestVariantName } from "./edit.ts";
import { ElementList } from "./ElementList.tsx";
import { ElementPanel } from "./ElementPanel.tsx";
import { canRedo, canUndo, createHistory, push, redo, reset, seal, undo, type History } from "./history.ts";
import {
  burstKey,
  deleteAt,
  duplicateAt,
  elementIssues,
  followSelection,
  moveLayer,
  moveLayerTo,
  nextBurst,
  type Burst,
  type LayoutEdit,
} from "./layoutOps.ts";
import { formatPositionCm, nudgeElement, nudgeStepCm } from "./nudge.ts";
import { SaveAsForm } from "./SaveAsForm.tsx";
import { formatKeys, isEditableTarget, SHORTCUTS, type ShortcutAction } from "./shortcuts.ts";
import { applyStroke, type UV } from "./stroke.ts";
import { UnwrapEditor } from "./UnwrapEditor.tsx";
import { currentPlatform, useLayoutShortcuts } from "./useLayoutShortcuts.ts";

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
  // The open layout with its undo/redo stacks; `layout` is the present state.
  const [history, setHistory] = useState<History<Layout> | null>(null);
  const layout = history?.present ?? null;
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
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [platform] = useState(currentPlatform);
  const keyHint = (keys: string) => formatKeys(keys, platform);

  const open = (fileName: string, list: StoredLayout[] | null) => {
    const file = list?.find((f) => f.name === fileName);
    if (!file) return;
    const r = parseLayout(file.text);
    setName(fileName);
    setSelected(null);
    setSaveError(null);
    if (r.ok) {
      setHistory(createHistory(r.layout));
      setSavedJson(JSON.stringify(r.layout));
      setParseError(null);
    } else {
      setHistory(null);
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

  // Every edit goes through the history. `key` coalesces a run of changes (one drag, one typing
  // burst in a field) into one undo step.
  const commit = (fn: (l: Layout) => Layout, key?: string) =>
    setHistory((h) => (h ? push(h, fn(h.present), key ? { coalesceKey: key } : {}) : h));
  const apply = (edit: (l: Layout) => LayoutEdit) => {
    if (!layout) return;
    const r = edit(layout);
    if (r.layout !== layout) commit(() => r.layout);
    setSelected(r.selected);
  };
  const burst = useRef<Burst | null>(null);
  /** The coalesce key for a typing burst in the focused field; clicks on buttons and boxes stay single steps. */
  const typingKey = (target: string): string | undefined => {
    const field = document.activeElement;
    if (!field || !isEditableTarget(field)) return undefined;
    const fieldName =
      field.id || field.getAttribute("aria-label") || field.closest("label")?.textContent || "";
    burst.current = nextBurst(burst.current, `${target}:${fieldName}`, performance.now());
    return burstKey(burst.current);
  };
  const setElement = (index: number, el: LayoutElement, key?: string) =>
    commit((l) => ({ ...l, elements: l.elements.map((e, i) => (i === index ? el : e)) }), key);

  const addElement = (type: ElementType) => {
    if (!layout) return;
    const el = newElement(
      type,
      centerU,
      0.5,
      layout.elements.map((e) => e.id),
    );
    commit((l) => ({ ...l, elements: [...l.elements, el] }));
    setSelected(layout.elements.length);
  };

  const doUndo = () => {
    if (!history || !canUndo(history)) return;
    const h = undo(history);
    setHistory(h);
    setSelected(followSelection(history.present, h.present, selected));
  };
  const doRedo = () => {
    if (!history || !canRedo(history)) return;
    const h = redo(history);
    setHistory(h);
    setSelected(followSelection(history.present, h.present, selected));
  };

  const doSave = async (target: Layout, from?: string) => {
    setSaveError(null);
    try {
      await save(target, from);
      setName(target.name);
      setHistory((h) => (h ? reset(h, target) : createHistory(target)));
      setSavedJson(JSON.stringify(target));
      toast.show(target.name === name ? `Saved ${target.name}` : `Saved as ${target.name}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      toast.show("Save failed", "error");
    }
  };

  const saveAs = (newName: string) => {
    if (!layout) return;
    setSaveAsOpen(false);
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
    commit(() => r.layout);
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

  const deleteSelected = () => {
    if (selected === null || !sel || sel.locked) return;
    apply((l) => deleteAt(l, selected));
    toast.show(`Deleted ${sel.id} (${keyHint("Mod+Z")} to undo)`, "info");
  };

  const canSave = dirty && !validationError;
  const selFixed = !!sel?.locked || (selected !== null && resolvedEls[selected]?.shape.kind === "patch");
  const runShortcut = (a: ShortcutAction) => {
    switch (a.type) {
      case "save":
        if (canSave && layout) void doSave(layout);
        else if (!dirty) toast.show("No unsaved changes", "info");
        return;
      case "undo":
        return doUndo();
      case "redo":
        return doRedo();
      case "help":
        return setHelpOpen((o) => !o);
      case "deselect":
        if (drawing) setDrawing(false);
        else if (helpOpen) setHelpOpen(false);
        else setSelected(null);
        return;
    }
    if (selected === null || !sel) return;
    switch (a.type) {
      case "duplicate":
        if (sel.locked) return toast.show(`${sel.id} is locked`, "info");
        return apply((l) => duplicateAt(l, selected));
      case "delete":
        if (sel.locked) return toast.show(`${sel.id} is locked: unlock it to delete`, "info");
        return deleteSelected();
      case "layerUp":
        return apply((l) => moveLayer(l, selected, 1));
      case "layerDown":
        return apply((l) => moveLayer(l, selected, -1));
      case "nudge": {
        if (selFixed)
          return toast.show(`${sel.id} is ${sel.locked ? "locked" : "placed by its projection"}`, "info");
        const { dxCm, dyCm } = nudgeStepCm(a.dx, a.dy, a.big);
        burst.current = nextBurst(burst.current, `nudge:${selected}`, performance.now());
        return setElement(selected, nudgeElement(sel, profile, dxCm, dyCm), burstKey(burst.current));
      }
    }
  };
  useLayoutShortcuts(rootRef, runShortcut);

  // Element list: a warning dot per element.
  const assetIds = useMemo(
    () => (listing?.status === "ok" ? new Set(listing.assets.map((a) => a.id)) : null),
    [listing],
  );
  const issues =
    layout?.elements.map((el, i) => elementIssues(el, flagsFor[i] ?? [], assetIds, patchIssues.get(el.id))) ??
    [];

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
    <div className="layout-page" ref={rootRef}>
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
          disabled={!canSave}
          title={
            dirty ? `Save the changes to the variant's YAML file (${keyHint("Mod+S")})` : "No unsaved changes"
          }
        >
          Save
        </button>
        <span className="popover-anchor">
          <button
            type="button"
            onClick={() => setSaveAsOpen((o) => !o)}
            disabled={!layout || !!validationError}
            aria-expanded={saveAsOpen}
            aria-haspopup="dialog"
            title="Save what you see as a new variant to try an alternative"
          >
            Save as…
          </button>
          <Popover open={saveAsOpen && !!layout} onClose={() => setSaveAsOpen(false)} label="Save as">
            {layout && (
              <SaveAsForm
                suggested={suggestVariantName(
                  layout.name,
                  (files ?? []).map((f) => f.name),
                )}
                taken={(files ?? []).map((f) => f.name)}
                current={name}
                onSave={saveAs}
                onCancel={() => setSaveAsOpen(false)}
              />
            )}
          </Popover>
        </span>
        <span className="button-pair">
          <button
            type="button"
            className="ghost icon-button"
            onClick={doUndo}
            disabled={!history || !canUndo(history)}
            aria-label="Undo"
            title={`Undo (${keyHint("Mod+Z")})`}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="ghost icon-button"
            onClick={doRedo}
            disabled={!history || !canRedo(history)}
            aria-label="Redo"
            title={`Redo (${keyHint("Shift+Mod+Z")})`}
          >
            <RedoIcon />
          </button>
        </span>
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
              <span className="spacer" />
              <span className="popover-anchor">
                <button
                  type="button"
                  className="ghost icon-button"
                  aria-label="Keyboard shortcuts"
                  aria-expanded={helpOpen}
                  aria-haspopup="dialog"
                  title="Keyboard shortcuts (?)"
                  onClick={() => setHelpOpen((o) => !o)}
                >
                  ?
                </button>
                <Popover
                  open={helpOpen}
                  onClose={() => setHelpOpen(false)}
                  label="Keyboard shortcuts"
                  align="end"
                  className="shortcuts-popover"
                >
                  <p className="popover-title">Keyboard shortcuts</p>
                  <dl className="shortcut-list">
                    {SHORTCUTS.map((s) => (
                      <div key={s.description}>
                        <dt>
                          {s.keys.map((k) => (
                            <kbd key={k}>{keyHint(k)}</kbd>
                          ))}
                        </dt>
                        <dd>{s.description}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>
                        <kbd>{platform === "mac" ? "⌥" : "Alt"}</kbd>
                        <span className="kbd-plus">+ click</span>
                      </dt>
                      <dd>Select the element underneath (2D editor)</dd>
                    </div>
                  </dl>
                  <p className="faint small">Inactive while typing in a field, except save.</p>
                </Popover>
              </span>
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
              onGestureEnd={() => setHistory((h) => (h ? seal(h) : h))}
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
            <ElementList
              elements={layout.elements}
              issues={issues}
              selected={selected}
              onSelect={setSelected}
              onToggleLock={(i) => {
                const el = layout.elements[i]!;
                setElement(i, { ...el, locked: el.locked ? undefined : true });
              }}
              onMove={(from, to) => apply((l) => moveLayerTo(l, from, to))}
            />
            {sel && selected !== null ? (
              <ElementPanel
                element={sel}
                asset={selAsset}
                autoFilter={isFigureLike(sel) ? defaultFilter(sel, profile) : "none"}
                flags={flagsFor[selected] ?? []}
                positionCm={formatPositionCm(profile, sel)}
                index={selected}
                count={layout.elements.length}
                onChange={(el) => setElement(selected, el, typingKey(`el${selected}`))}
                onLayer={(dir) => apply((l) => moveLayer(l, selected, dir))}
                onDelete={deleteSelected}
                onDuplicate={() => apply((l) => duplicateAt(l, selected))}
                keys={{
                  duplicate: keyHint("Mod+D"),
                  delete: "Delete",
                  forward: "]",
                  back: "[",
                }}
              />
            ) : (
              <section className="panel">
                <div className="panel-head">
                  <h2>{layout.name}</h2>
                  {dirty && <span className="chip warn">unsaved</span>}
                </div>
                <label className="props">
                  description
                  <textarea
                    rows={3}
                    value={layout.description ?? ""}
                    onChange={(e) =>
                      commit(
                        (l) => ({ ...l, description: e.target.value || undefined }),
                        typingKey("description"),
                      )
                    }
                  />
                </label>
                <p className="muted small">
                  {layout.elements.length} elements. Select one in the list or the editor to edit it.
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
      <ToastRegion toast={toast} />
    </div>
  );
}
