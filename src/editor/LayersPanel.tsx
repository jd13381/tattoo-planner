// Background layers (docs/adr/0019), like layers in Photoshop: the list (top layer first, eye,
// lock, drag to reorder, add) for the side panel, and the selected layer's properties for the
// inspector. Thin UI: every change goes through src/editor/backgroundOps.ts.
import { useState, type DragEvent, type ReactNode } from "react";
import type { AssetInfo } from "../assets/types.ts";
import { layerName } from "../layout/areas.ts";
import { BLEND_MODES, type BackgroundLayer, type BackgroundSource } from "../layout/schema.ts";
import {
  BACKGROUND_KIND,
  LINE_PATTERNS,
  naturalTileCm,
  patternInfo,
  TILE_PATTERNS,
  type StandardBackground,
} from "../render/backgrounds/catalogue.ts";
import { DEFAULT_INK } from "../render/backgrounds/paint.ts";
import { Popover } from "../ui/Popover.tsx";
import { DuplicateIcon, LockIcon, TrashIcon, WarnIcon } from "../ui/icons.tsx";
import { coverSummary, removeShape, setCover, sourceLabel } from "./backgroundOps.ts";
import { dropIndex } from "./layoutOps.ts";

/** Tools of the Background view's 2D editor. */
export type BackgroundTool = "select" | "rect" | "ellipse" | "polygon" | "brush" | "eraser";

export const BACKGROUND_TOOLS: { id: BackgroundTool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Select", key: "V", hint: "Select and move shapes; drag the sheet to pan" },
  { id: "rect", label: "Rect", key: "M", hint: "Drag to draw a rectangle of background" },
  { id: "ellipse", label: "Ellipse", key: "E", hint: "Drag to draw an ellipse of background" },
  {
    id: "polygon",
    label: "Polygon",
    key: "P",
    hint: "Click the corners; click the first one or press Enter to close",
  },
  { id: "brush", label: "Brush", key: "B", hint: "Paint background onto the skin" },
  { id: "eraser", label: "Eraser", key: "X", hint: "Paint background away" },
];

const EyeIcon = ({ off = false }: { off?: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
  >
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    {off ? <path d="M3 13L13 3" strokeLinecap="round" /> : <circle cx="8" cy="8" r="2" />}
  </svg>
);

type ListProps = {
  layers: readonly BackgroundLayer[];
  selected: number | null;
  onSelect: (index: number) => void;
  onChange: (index: number, layer: BackgroundLayer) => void;
  onMove: (from: number, to: number) => void;
  /** Layers that cannot be drawn, with the reason (e.g. an image that is not loaded). */
  issues: ReadonlyMap<string, string>;
  labelOf: (name: string) => string | undefined;
};

type Drop = { over: number; above: boolean };

/** Every background layer, top layer first: select, show/hide, lock, drag to reorder. */
export function LayerList(props: ListProps) {
  const { layers, selected, onSelect, onChange, onMove, issues, labelOf } = props;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const order = layers.map((_, i) => layers.length - 1 - i);
  const onDragOver = (e: DragEvent<HTMLLIElement>, i: number) => {
    if (dragFrom === null) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const above = e.clientY < r.top + r.height / 2;
    if (drop?.over !== i || drop.above !== above) setDrop({ over: i, above });
  };
  const endDrag = () => {
    setDragFrom(null);
    setDrop(null);
  };
  if (layers.length === 0)
    return (
      <p className="muted small layer-empty">
        No background layers yet. Add one to put clouds, stars, smoke or a pattern under the motifs, on the
        whole region or only an area.
      </p>
    );
  return (
    <ul className="element-list layer-list" aria-label="Background layers">
      {order.map((i) => {
        const b = layers[i]!;
        const issue = issues.get(b.id);
        const dropCls =
          drop && drop.over === i && dragFrom !== null && dragFrom !== i
            ? drop.above
              ? " drop-above"
              : " drop-below"
            : "";
        return (
          <li
            key={`${i}:${b.id}`}
            className={`element-row layer-row${i === selected ? " selected" : ""}${b.hidden ? " hidden-layer" : ""}${dragFrom === i ? " dragging" : ""}${dropCls}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", b.id);
              setDragFrom(i);
            }}
            onDragOver={(e) => onDragOver(e, i)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && drop) onMove(dragFrom, dropIndex(dragFrom, drop.over, drop.above));
              endDrag();
            }}
            onDragEnd={endDrag}
          >
            <button
              type="button"
              className={`ghost icon-button eye-toggle${b.hidden ? "" : " on"}`}
              aria-pressed={!b.hidden}
              aria-label={`${b.hidden ? "Show" : "Hide"} ${layerName(b)}`}
              title={b.hidden ? "Hidden: click to show" : "Visible: click to hide"}
              onClick={() => onChange(i, { ...b, hidden: b.hidden ? undefined : true })}
            >
              <EyeIcon off={!!b.hidden} />
            </button>
            <button
              type="button"
              className="element-select"
              aria-current={i === selected ? "true" : undefined}
              onClick={() => onSelect(i)}
              title={`${layerName(b)}: ${sourceLabel(b.source, labelOf)}, ${coverSummary(b)}`}
            >
              <span className="swatch cat-background" aria-hidden="true" />
              <span className="element-id">{layerName(b)}</span>
              <span className="element-type">{sourceLabel(b.source, labelOf)}</span>
              {issue && <span className="issue-dot" role="img" aria-label={issue} title={issue} />}
            </button>
            <button
              type="button"
              className={`ghost icon-button lock-toggle${b.locked ? " on" : ""}`}
              aria-pressed={!!b.locked}
              aria-label={`${b.locked ? "Unlock" : "Lock"} ${layerName(b)}`}
              title={b.locked ? "Locked: click to unlock" : "Lock"}
              onClick={() => onChange(i, { ...b, locked: b.locked ? undefined : true })}
            >
              <LockIcon open={!b.locked} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The "+ Add layer" button with its menu: standard backgrounds, patterns, images from the assets. */
export function AddLayerMenu(props: {
  standard: readonly StandardBackground[];
  images: readonly AssetInfo[] | null;
  onAdd: (source: BackgroundSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const add = (s: BackgroundSource) => {
    props.onAdd(s);
    setOpen(false);
  };
  const tiles = (props.images ?? []).filter((a) => a.exists && /\.(png|jpe?g|webp)$/i.test(a.file));
  const backgrounds = tiles.filter((a) => a.kind === BACKGROUND_KIND);
  const others = tiles.filter(
    (a) => a.kind !== BACKGROUND_KIND && a.kind !== "arm-photo" && a.kind !== "existing",
  );
  return (
    <span className="popover-anchor">
      <button
        type="button"
        className="small-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title="Add a background layer on top of the others"
      >
        + Add layer
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label="Add a background layer"
        align="end"
        className="add-layer-popover"
      >
        <p className="popover-title">Standard backgrounds</p>
        <div className="add-layer-grid">
          {props.standard.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => add({ standard: s.name })}
              title={s.imageUrl ? "Catalogue image" : "Procedural version (no catalogue image yet)"}
            >
              {s.imageUrl ? <img src={s.imageUrl} alt="" className="add-layer-thumb" /> : null}
              {s.label}
            </button>
          ))}
        </div>
        <p className="popover-title">Line patterns</p>
        <div className="add-layer-grid">
          {LINE_PATTERNS.map((p) => (
            <button key={p.name} type="button" onClick={() => add({ pattern: p.name })}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="popover-title">Image from the project</p>
        {tiles.length === 0 ? (
          <p className="muted small">
            No images yet. Make a tileable one in the Image studio (Background mode), or add images to the
            project.
          </p>
        ) : (
          <div className="add-layer-grid">
            {[...backgrounds, ...others].slice(0, 24).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => add({ image: a.id, tile_cm: 10 })}
                title={a.file}
              >
                {a.id}
                {a.kind === BACKGROUND_KIND ? "" : <span className="faint"> ({a.kind})</span>}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </span>
  );
}

type PanelProps = {
  layer: BackgroundLayer;
  index: number;
  count: number;
  standard: readonly StandardBackground[];
  images: readonly AssetInfo[] | null;
  issue?: string;
  onChange: (layer: BackgroundLayer) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  tool: BackgroundTool;
  onTool: (t: BackgroundTool) => void;
  brushCm: number;
  onBrushCm: (cm: number) => void;
  selectedShape: number | null;
  onSelectShape: (index: number | null) => void;
};

function Field({ k, unit, children }: { k: string; unit?: string; children: ReactNode }) {
  return (
    <label className="field-box">
      <span className="k" aria-hidden="true">
        {k}
      </span>
      {children}
      {unit && (
        <span className="u" aria-hidden="true">
          {unit}
        </span>
      )}
    </label>
  );
}

/** Properties of the selected background layer. Every field maps 1:1 to the layout YAML. */
export function LayerPanel(props: PanelProps) {
  const { layer: b, onChange, standard, images } = props;
  const locked = !!b.locked;
  const src = b.source;
  const setSource = (s: BackgroundSource) => onChange({ ...b, source: s });
  const num = (
    value: number | undefined,
    set: (n: number | undefined) => void,
    opts: { step?: number; label: string; min?: number; max?: number; placeholder?: string },
  ) => (
    <input
      type="number"
      aria-label={opts.label}
      step={opts.step ?? 0.1}
      min={opts.min}
      max={opts.max}
      value={value ?? ""}
      placeholder={opts.placeholder}
      disabled={locked}
      onChange={(e) => {
        const n = e.target.valueAsNumber;
        set(Number.isFinite(n) ? n : undefined);
      }}
    />
  );
  const kind = "pattern" in src ? "pattern" : "standard" in src ? "standard" : "image";
  const isTilePattern = "pattern" in src && !!patternInfo(src.pattern)?.tileCm;
  const cover = b.cover ?? "region";
  const tileImages = (images ?? []).filter((a) => a.exists);
  return (
    <section className="panel element-panel layer-panel" aria-label="Background layer">
      <div className="panel-head inspector-head">
        <span className="swatch cat-background" aria-hidden="true" />
        <h2>{layerName(b)}</h2>
        <span className="faint">background</span>
        <span className="spacer" />
        <button
          type="button"
          className={`ghost icon-button lock-toggle${locked ? " on" : ""}`}
          aria-pressed={locked}
          aria-label={locked ? "Unlock" : "Lock"}
          onClick={() => onChange({ ...b, locked: locked ? undefined : true })}
        >
          <LockIcon open={!locked} />
        </button>
      </div>
      {props.issue && (
        <p className="notice warn compact">
          <WarnIcon />
          <span>{props.issue}</span>
        </p>
      )}
      <div className="element-actions">
        <span
          className="layer-label"
          title="Layer 1 is drawn at the bottom; every motif lies above all layers"
        >
          Layer <b>{props.index + 1}</b> of {props.count}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="ghost icon-button"
          onClick={props.onDuplicate}
          disabled={locked}
          aria-label="Duplicate layer"
          title="Duplicate"
        >
          <DuplicateIcon />
        </button>
        <button
          type="button"
          className="ghost icon-button danger"
          onClick={props.onDelete}
          disabled={locked}
          aria-label="Delete layer"
          title="Delete; Undo brings it back"
        >
          <TrashIcon />
        </button>
      </div>
      <div className="props">
        <label>
          name
          <input
            type="text"
            value={b.name ?? ""}
            placeholder={b.id}
            disabled={locked}
            onChange={(e) => onChange({ ...b, name: e.target.value || undefined })}
          />
        </label>
        <h3 className="props-head">Source</h3>
        <label>
          kind
          <select
            value={kind}
            disabled={locked}
            onChange={(e) => {
              const k = e.target.value;
              if (k === "pattern") setSource({ pattern: "stars" });
              else if (k === "standard") setSource({ standard: standard[0]?.name ?? "clouds" });
              else if (tileImages[0]) setSource({ image: tileImages[0].id, tile_cm: 10 });
            }}
          >
            <option value="standard">Standard background</option>
            <option value="pattern">Pattern</option>
            <option value="image" disabled={tileImages.length === 0}>
              Image from the project
            </option>
          </select>
        </label>
        {"standard" in src && (
          <label>
            background
            <select
              value={src.standard}
              disabled={locked}
              onChange={(e) => setSource({ ...src, standard: e.target.value })}
            >
              {!standard.some((s) => s.name === src.standard) && (
                <option value={src.standard}>{src.standard} (unknown)</option>
              )}
              {standard.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.label}
                  {s.imageUrl ? "" : " (procedural)"}
                </option>
              ))}
            </select>
          </label>
        )}
        {"pattern" in src && (
          <label>
            pattern
            <select
              value={src.pattern}
              disabled={locked}
              onChange={(e) => setSource({ ...src, pattern: e.target.value })}
            >
              {!patternInfo(src.pattern) && <option value={src.pattern}>{src.pattern} (unknown)</option>}
              <optgroup label="Tile patterns">
                {TILE_PATTERNS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Line patterns">
                {LINE_PATTERNS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        )}
        {"image" in src && (
          <label>
            image
            <select
              value={src.image}
              disabled={locked}
              onChange={(e) => setSource({ ...src, image: e.target.value })}
            >
              {!tileImages.some((a) => a.id === src.image) && (
                <option value={src.image}>{src.image} (missing)</option>
              )}
              {tileImages.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                  {a.kind === BACKGROUND_KIND ? "" : ` (${a.kind})`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field-pair">
          {"pattern" in src ? (
            <Field k="Scale" unit="×">
              {num(src.scale, (scale) => setSource({ ...src, scale }), {
                step: 0.1,
                min: 0.1,
                label: "scale",
                placeholder: "1",
              })}
            </Field>
          ) : (
            <Field k="Tile" unit="cm">
              {num(
                src.tile_cm,
                (t) =>
                  setSource({ ...src, tile_cm: t ?? ("image" in src ? 10 : undefined) } as BackgroundSource),
                {
                  step: 0.5,
                  min: 0.5,
                  label: "tile width cm",
                  placeholder: String(
                    "standard" in src
                      ? (standard.find((s) => s.name === src.standard)?.tileCm ?? naturalTileCm(src.standard))
                      : 10,
                  ),
                },
              )}
            </Field>
          )}
          {("pattern" in src ? isTilePattern : true) && (
            <Field k="↻" unit="°">
              {num(src.rotation_deg, (rotation_deg) => setSource({ ...src, rotation_deg }), {
                step: 5,
                label: "rotation °",
              })}
            </Field>
          )}
        </div>
        {(isTilePattern || "standard" in src || "image" in src) && (
          <div className="field-pair">
            <Field k="X" unit="cm">
              {num(
                src.offset_cm?.x,
                (x) => setSource({ ...src, offset_cm: { x: x ?? 0, y: src.offset_cm?.y ?? 0 } }),
                { label: "offset around cm" },
              )}
            </Field>
            <Field k="Y" unit="cm">
              {num(
                src.offset_cm?.y,
                (y) => setSource({ ...src, offset_cm: { x: src.offset_cm?.x ?? 0, y: y ?? 0 } }),
                { label: "offset along cm" },
              )}
            </Field>
          </div>
        )}
        {!("image" in src) && (
          <>
            <label>
              density
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                disabled={locked}
                value={src.density ?? ("pattern" in src && !isTilePattern ? 0.3 : 0.5)}
                onChange={(e) => setSource({ ...src, density: e.target.valueAsNumber })}
                aria-label="density"
              />
            </label>
            <label>
              ink
              <span className="color-field">
                <input
                  type="color"
                  aria-label="Ink colour"
                  value={src.ink ?? DEFAULT_INK}
                  disabled={locked}
                  onChange={(e) => setSource({ ...src, ink: e.target.value })}
                />
              </span>
            </label>
          </>
        )}
        <h3 className="props-head">Look</h3>
        <label>
          opacity
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={locked}
            value={b.opacity ?? 1}
            onChange={(e) =>
              onChange({ ...b, opacity: e.target.valueAsNumber === 1 ? undefined : e.target.valueAsNumber })
            }
            aria-label="opacity"
          />
        </label>
        <label>
          blend
          <select
            value={b.blend ?? "multiply"}
            disabled={locked}
            onChange={(e) =>
              onChange({
                ...b,
                blend:
                  e.target.value === "multiply" ? undefined : (e.target.value as BackgroundLayer["blend"]),
              })
            }
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {m === "multiply" ? "Multiply (ink on skin)" : "Normal"}
              </option>
            ))}
          </select>
        </label>
        <label title="Skin left free around every motif on top, so the motifs look embedded in the background">
          gap
          <span className="field-pair">
            <Field k="↔" unit="cm">
              {num(b.gap_cm, (gap_cm) => onChange({ ...b, gap_cm }), {
                step: 0.1,
                min: 0,
                label: "gap around motifs cm",
                placeholder: "0",
              })}
            </Field>
          </span>
        </label>
        <h3 className="props-head">
          Where <span className="props-head-note">{coverSummary(b)}</span>
        </h3>
        <span className="segmented cover-switch" role="group" aria-label="Cover">
          <button
            type="button"
            className={cover === "region" ? "active" : ""}
            aria-pressed={cover === "region"}
            disabled={locked}
            onClick={() => onChange(setCover(b, "region"))}
          >
            Whole region
          </button>
          <button
            type="button"
            className={cover === "area" ? "active" : ""}
            aria-pressed={cover === "area"}
            disabled={locked}
            onClick={() => onChange(setCover(b, "area"))}
          >
            Area
          </button>
        </span>
        {cover === "area" && (
          <>
            <div className="bg-tools" role="toolbar" aria-label="Area tools">
              {BACKGROUND_TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`small-button${props.tool === t.id ? " active" : ""}`}
                  aria-pressed={props.tool === t.id}
                  disabled={locked && t.id !== "select"}
                  title={`${t.hint} (${t.key})`}
                  onClick={() => props.onTool(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {(props.tool === "brush" || props.tool === "eraser") && (
              <label>
                brush
                <span className="field-pair">
                  <Field k="r" unit="cm">
                    {num(props.brushCm, (n) => props.onBrushCm(Math.max(0.1, n ?? 1)), {
                      step: 0.1,
                      min: 0.1,
                      label: "brush radius cm",
                    })}
                  </Field>
                </span>
              </label>
            )}
            <div className="field-pair">
              <Field k="Feather" unit="cm">
                {num(b.feather_cm, (feather_cm) => onChange({ ...b, feather_cm }), {
                  step: 0.1,
                  min: 0,
                  label: "soft edge cm",
                  placeholder: "0",
                })}
              </Field>
            </div>
            {(b.shapes?.length ?? 0) > 0 && (
              <ul className="shape-list">
                {b.shapes!.map((s, k) => (
                  <li key={k} className={props.selectedShape === k ? "selected" : ""}>
                    <button
                      type="button"
                      className="ghost small-button"
                      onClick={() => props.onSelectShape(k)}
                    >
                      {s.kind}
                      {"w_cm" in s
                        ? ` ${s.w_cm} × ${s.h_cm} cm`
                        : s.kind === "polygon"
                          ? ` ${s.points.length} points`
                          : ""}
                    </button>
                    <button
                      type="button"
                      className="ghost icon-button danger"
                      aria-label={`Remove ${s.kind} ${k + 1}`}
                      disabled={locked}
                      onClick={() => {
                        props.onSelectShape(null);
                        onChange(removeShape(b, k));
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(b.mask?.length ?? 0) > 0 && (
              <button
                type="button"
                className="ghost small-button"
                disabled={locked}
                onClick={() => onChange({ ...b, mask: undefined })}
              >
                Clear painted mask ({b.mask!.length} strokes)
              </button>
            )}
          </>
        )}
        <h3 className="props-head">Notes</h3>
        <textarea
          rows={2}
          value={b.notes ?? ""}
          disabled={locked}
          onChange={(e) => onChange({ ...b, notes: e.target.value || undefined })}
        />
      </div>
    </section>
  );
}
