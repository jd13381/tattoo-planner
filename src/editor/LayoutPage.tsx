import { useMemo, useState } from "react";
import {
  layoutSchema,
  ELEMENT_TYPES,
  type ElementType,
  type Layout,
  type LayoutElement,
} from "../layout/schema.ts";
import { classify } from "../layout/shapes.ts";
import { useLayouts, type StoredLayout } from "../layout/useLayouts.ts";
import { parseLayout } from "../layout/yamlDoc.ts";
import { coverage } from "../metrics/coverage.ts";
import { MetricsPanel } from "../metrics/MetricsPanel.tsx";
import { renderUnwrap, type RenderMode } from "../render/unwrapCanvas.ts";
import { PlaceholderNotice } from "../viewer/ArmPage.tsx";
import { ArmViewer } from "../viewer/ArmViewer.tsx";
import { anubisSize, type ArmState } from "../viewer/useArm.ts";
import { newElement, reorder, uniqueId } from "./edit.ts";
import { ElementPanel } from "./ElementPanel.tsx";
import { UnwrapEditor } from "./UnwrapEditor.tsx";

/** Texture and editor resolution; blockout shapes are flat, so 12 px per cm is plenty. */
const PX_PER_CM = 12;
/** Metrics resolution: 6 px per cm gives areas within a fraction of a percent. */
const METRICS_PX_PER_CM = 6;

export function LayoutPage({ arm }: { arm: ArmState }) {
  const { profile } = arm;
  const [name, setName] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<RenderMode>("blockout");
  const [grid, setGrid] = useState(true);
  const [centerU, setCenterU] = useState(0);

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

  const dirty = layout !== null && JSON.stringify(layout) !== savedJson;
  const validation = useMemo(() => (layout ? layoutSchema.safeParse(layout) : null), [layout]);
  const validationError =
    validation && !validation.success
      ? validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : null;

  // 3D texture: always centred on the outer line.
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    renderUnwrap(canvas, profile, mode, layout, {
      pxPerCm: PX_PER_CM,
      grid,
      existing: anubisSize,
      selected: selected ?? undefined,
    });
    return canvas;
  }, [profile, mode, layout, grid, selected]);

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
    });
    return canvas;
  }, [texture, centerU, profile, mode, layout, grid, selected]);

  const metrics = useMemo(
    () => (layout ? coverage(classify(layout, profile, METRICS_PX_PER_CM, anubisSize), profile) : null),
    [layout, profile],
  );

  const flagsFor = useMemo(() => {
    if (!layout) return [];
    const cls = classify({ ...layout, elements: layout.elements }, profile, 1, anubisSize);
    return cls.resolved.map((r) => r.flags);
  }, [layout, profile]);
  const flagged =
    layout?.elements.filter((_, i) => flagsFor[i]?.includes("height not set")).map((e) => e.id) ?? [];

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

  const doSave = async (target: Layout) => {
    setSaveError(null);
    try {
      await save(target);
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
      "Name of the new variant (lowercase letters, digits, dashes):",
      `${layout.name}-copy`,
    );
    if (!input) return;
    const newName = input.trim().toLowerCase();
    if (files?.some((f) => f.name === newName) && !window.confirm(`${newName} exists. Overwrite?`)) return;
    void doSave({ ...layout, name: newName });
  };

  const switchTo = (next: string) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    open(next, files);
  };

  const sel = selected !== null && layout ? layout.elements[selected] : undefined;

  return (
    <div className="layout-page">
      <PlaceholderNotice count={arm.placeholders.length} />
      <div className="toolbar layout-toolbar">
        <label className="inline">
          Variant{" "}
          <select value={name ?? ""} onChange={(e) => switchTo(e.target.value)} disabled={!files}>
            {(files ?? []).map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => layout && void doSave(layout)}
          disabled={!dirty || !!validationError}
        >
          Save{dirty ? " *" : ""}
        </button>
        <button type="button" onClick={saveAs} disabled={!layout || !!validationError}>
          Save as…
        </button>
        <span className="spacer" />
        <span className="segmented" role="group" aria-label="Mode">
          {(["blockout", "grid"] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {m === "blockout" ? "Blockout" : "cm grid"}
            </button>
          ))}
        </span>
        <label className="inline check">
          <input
            type="checkbox"
            checked={grid}
            onChange={(e) => setGrid(e.target.checked)}
            disabled={mode !== "blockout"}
          />{" "}
          grid overlay
        </label>
        <span className="segmented" role="group" aria-label="Editor centre">
          <button type="button" className={centerU === 0 ? "active" : ""} onClick={() => setCenterU(0)}>
            Outer side centred
          </button>
          <button type="button" className={centerU === 0.5 ? "active" : ""} onClick={() => setCenterU(0.5)}>
            Inner side centred
          </button>
        </span>
      </div>

      {loadError && <p className="card notice error">{loadError}</p>}
      {parseError && (
        <section className="card notice error" role="alert">
          <h2>{name}.yaml is invalid</h2>
          <p>{parseError}</p>
        </section>
      )}
      {validationError && <p className="card notice error">Not saved: {validationError}</p>}
      {saveError && <p className="card notice error">Save failed: {saveError}</p>}
      {flagged.length > 0 && (
        <p className="card notice warn small">Height not set, shown at 10 cm: {flagged.join(", ")}.</p>
      )}

      {layout && (
        <div className="layout-grid">
          <div className="editor-col">
            <div className="toolbar">
              <span className="muted small">Add:</span>
              {ELEMENT_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => addElement(t)}>
                  {t}
                </button>
              ))}
            </div>
            <UnwrapEditor
              key={`${profile.length}:${profile.maxCircumference}`}
              profile={profile}
              layout={layout}
              existing={anubisSize}
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
              hint="Dark grey: figures, light grey: fillers, striped: bands, red: lines, outlined: existing tattoo."
            />
          </div>
          <div className="side-col">
            {sel && selected !== null ? (
              <ElementPanel
                element={sel}
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
            {metrics && <MetricsPanel coverage={metrics} />}
          </div>
        </div>
      )}
    </div>
  );
}
