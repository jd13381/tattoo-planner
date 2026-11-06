import { AssetThumb } from "../assets/AssetBrowser.tsx";
import { ArrowDownIcon, ArrowUpIcon, DuplicateIcon, LockIcon, TrashIcon, WarnIcon } from "../ui/icons.tsx";
import type { ReactNode } from "react";
import { BAND_PATTERNS } from "../render/patterns/index.ts";
import { colorToHex, LINE_SWATCHES } from "./edit.ts";
import type { AssetInfo } from "../assets/types.ts";
import { FULL_IMAGE } from "../layout/imageFit.ts";
import {
  IMAGE_FILTERS,
  IMAGE_ROTATIONS,
  type FigureLike,
  type ImageFilter,
  type LayoutElement,
} from "../layout/schema.ts";

type Props = {
  element: LayoutElement;
  /** Manifest entry of the element's asset; null = not in the manifest, undefined = no manifest. */
  asset?: AssetInfo | null;
  /** The filter used when the element sets none (depends on its position). */
  autoFilter: ImageFilter;
  flags: string[];
  /** Read-only position on the skin in cm (formatPositionCm). */
  positionCm: string;
  index: number;
  count: number;
  onChange: (el: LayoutElement) => void;
  onLayer: (dir: 1 | -1) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Opens the image picker next to the given button (figures and existing tattoos). */
  onChangeImage?: (anchor: HTMLElement) => void;
  /** Steps to the previous (-1) or next (+1) image of the same kind; null when there is none. */
  onStepImage?: ((dir: 1 | -1) => void) | null;
  /** Error of the id field (duplicate or invalid), shown under it. */
  idError?: string | null;
  /** Keyboard hints for the button tooltips, e.g. { duplicate: "⌘D" }. */
  keys?: Partial<Record<"duplicate" | "delete" | "forward" | "back", string>>;
};

/** Properties of the selected element. Every field maps 1:1 to the layout YAML. */
export function ElementPanel({
  element: el,
  asset,
  autoFilter,
  flags,
  positionCm,
  index,
  count,
  onChange,
  onLayer,
  onDelete,
  onDuplicate,
  onChangeImage,
  onStepImage,
  idError,
  keys = {},
}: Props) {
  const locked = !!el.locked;
  const hint = (k: keyof NonNullable<Props["keys"]>) => (keys[k] ? ` (${keys[k]})` : "");
  const num = (
    value: number | null | undefined,
    set: (n: number | null) => void,
    opts: { step?: number; nullable?: boolean; label?: string } = {},
  ) => (
    <input
      type="number"
      aria-label={opts.label}
      step={opts.step ?? 0.01}
      value={value ?? ""}
      placeholder={opts.nullable ? "not set" : undefined}
      disabled={locked}
      onChange={(e) => {
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n)) set(n);
        else if (opts.nullable) set(null);
      }}
    />
  );
  const text = (value: string | undefined, set: (s: string | undefined) => void) => (
    <input
      type="text"
      value={value ?? ""}
      disabled={locked}
      onChange={(e) => set(e.target.value || undefined)}
    />
  );
  const cm = <p className="cm-readout">{positionCm}</p>;

  return (
    <section className="panel element-panel" aria-label="Element">
      <div className="panel-head inspector-head">
        <span className={`swatch cat-${el.type}`} aria-hidden="true" />
        <h2>{el.id}</h2>
        <span className="faint">{el.type}</span>
        <span className="spacer" />
        <button
          type="button"
          className={`ghost icon-button lock-toggle${locked ? " on" : ""}`}
          aria-pressed={locked}
          aria-label={locked ? "Unlock" : "Lock"}
          title={
            locked ? "Locked: cannot be moved, edited or deleted. Click to unlock." : "Lock against edits"
          }
          onClick={() => onChange({ ...el, locked: locked ? undefined : true })}
        >
          <LockIcon open={!locked} />
        </button>
      </div>
      {flags.length > 0 && (
        <p className="notice warn compact">
          <WarnIcon />
          <span>
            {flags.includes("height not set") ? "Height not set: drawn 10 cm tall. " : ""}
            {flags.includes("width assumed")
              ? "Width not set: drawn at 0.55 × height until an image sets it."
              : ""}
          </span>
        </p>
      )}
      <div className="element-actions">
        <span className="layer-label" title="Layer 1 is drawn at the bottom">
          Layer <b>{index + 1}</b> of {count}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="ghost icon-button"
          onClick={() => onLayer(1)}
          disabled={index === count - 1}
          aria-label="Bring forward"
          title={`Bring forward: draw above the next element${hint("forward")}`}
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          className="ghost icon-button"
          onClick={() => onLayer(-1)}
          disabled={index === 0}
          aria-label="Send back"
          title={`Send back: draw below the previous element${hint("back")}`}
        >
          <ArrowDownIcon />
        </button>
        <button
          type="button"
          className="ghost icon-button"
          onClick={onDuplicate}
          disabled={locked}
          aria-label="Duplicate"
          title={`Duplicate: a copy on top, with a new id${hint("duplicate")}`}
        >
          <DuplicateIcon />
        </button>
        <button
          type="button"
          className="ghost icon-button danger"
          onClick={onDelete}
          disabled={locked}
          aria-label="Delete"
          title={locked ? "Unlock it to delete" : `Delete ${el.id}; Undo brings it back${hint("delete")}`}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="props">
        <label>
          id
          <input
            type="text"
            value={el.id}
            disabled={locked}
            aria-invalid={idError ? true : undefined}
            aria-describedby={idError ? "element-id-error" : undefined}
            onChange={(e) =>
              onChange({ ...el, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
            }
          />
          {idError && (
            <span id="element-id-error" className="field-error" role="alert">
              {idError}
            </span>
          )}
        </label>
        {(el.type === "figure" || el.type === "existing") && (
          <>
            <ImageSwap
              el={el}
              asset={asset}
              locked={locked}
              onChangeImage={onChangeImage}
              onStepImage={onStepImage}
            />
            {el.type === "existing" && (
              <label title="A calibration made in Settings → Projection: the tattoo is drawn from all its photos; position, size and cut-out apply only while that cannot be built.">
                projection {text(el.projection, (projection) => onChange({ ...el, projection }))}
              </label>
            )}
            <h3 className="props-head">
              Position <span className="props-head-note">u around · v along</span>
            </h3>
            <div className="field-pair">
              <Box k="u">
                {num(el.position.u, (u) => onChange({ ...el, position: { ...el.position, u: u ?? 0 } }), {
                  label: "u (around)",
                })}
              </Box>
              <Box k="v">
                {num(el.position.v, (v) => onChange({ ...el, position: { ...el.position, v: v ?? 0 } }), {
                  label: "v (along)",
                })}
              </Box>
            </div>
            {cm}
            <h3 className="props-head">Size</h3>
            <div className="field-pair">
              <Box k="H" unit="cm">
                {num(el.size_cm.h, (h) => onChange({ ...el, size_cm: { ...el.size_cm, h } }), {
                  step: 0.1,
                  nullable: true,
                  label: "height cm",
                })}
              </Box>
              <Box k="W" unit="cm">
                {num(
                  el.size_cm.w,
                  (w) => onChange({ ...el, size_cm: { ...el.size_cm, w: w ?? undefined } }),
                  { step: 0.1, nullable: true, label: "width cm" },
                )}
              </Box>
              <Box k="↻" unit="°">
                {num(el.rotation_deg, (r) => onChange({ ...el, rotation_deg: r ?? undefined }), {
                  step: 1,
                  nullable: true,
                  label: "rotation °",
                })}
              </Box>
            </div>
            {/* style and red_accents stay in the YAML but are left out here (not used for drawing). */}
            <ImageFields el={el} asset={asset} autoFilter={autoFilter} locked={locked} onChange={onChange} />
          </>
        )}
        {el.type === "band" && (
          <>
            <h3 className="props-head">Position</h3>
            <label>v (along) {num(el.v, (v) => onChange({ ...el, v: v ?? 0 }))}</label>
            {cm}
            <h3 className="props-head">Size</h3>
            <label>
              width cm {num(el.width_cm, (w) => onChange({ ...el, width_cm: w ?? 1 }), { step: 0.1 })}
            </label>
            <h3 className="props-head">Style</h3>
            <label>
              pattern
              <PatternSelect
                value={el.pattern}
                options={BAND_PATTERNS}
                disabled={locked}
                onChange={(pattern) => onChange({ ...el, pattern })}
              />
            </label>
          </>
        )}
        {el.type === "line" && (
          <>
            <h3 className="props-head">Position</h3>
            <p className="cm-readout flush">{positionCm}</p>
            <p className="muted small">{el.points.length} points: drag the dots in the editor.</p>
            <div className="toolbar">
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  const last = el.points[el.points.length - 1]!;
                  onChange({ ...el, points: [...el.points, { u: last.u, v: Math.min(1, last.v + 0.05) }] });
                }}
              >
                Add point
              </button>
              <button
                type="button"
                disabled={locked || el.points.length <= 2}
                onClick={() => onChange({ ...el, points: el.points.slice(0, -1) })}
              >
                Remove last
              </button>
            </div>
            <h3 className="props-head">Style</h3>
            <div className="props-row">
              <span>colour</span>
              <ColorField
                value={el.color}
                disabled={locked}
                onChange={(color) => onChange({ ...el, color })}
              />
            </div>
            <label>
              width cm {num(el.width_cm, (w) => onChange({ ...el, width_cm: w ?? 1 }), { step: 0.1 })}
            </label>
          </>
        )}
        <h3 className="props-head">Notes</h3>
        <textarea
          aria-label="notes"
          value={el.notes ?? ""}
          disabled={locked}
          rows={2}
          onChange={(e) => onChange({ ...el, notes: e.target.value || undefined })}
        />
      </div>
    </section>
  );
}

/** A compact number field: a short key in front, an optional unit behind (Pro inspector). */
function Box({ k, unit, children }: { k: string; unit?: string; children: ReactNode }) {
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

const CROP_KEYS = ["x", "y", "w", "h"] as const;

/** Reference-mode fields of a figure: the asset preview with its cut-out, turn, flip, feather, filter. */
function ImageFields(props: {
  el: FigureLike;
  asset?: AssetInfo | null;
  autoFilter: ImageFilter;
  locked: boolean;
  onChange: (el: LayoutElement) => void;
}) {
  const { el, asset, autoFilter, locked, onChange } = props;
  const crop = el.crop ?? asset?.crop;
  return (
    <fieldset className="image-fields" disabled={locked}>
      <legend>Image fit</legend>
      <div className="crop-row">
        <span>crop {el.crop ? "" : asset?.crop ? "(asset)" : "(whole image)"}</span>
        {CROP_KEYS.map((k) => (
          <label key={k} className="crop-field">
            {k}
            <input
              type="number"
              min={0}
              max={1}
              step={0.005}
              value={crop?.[k] ?? FULL_IMAGE[k]}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (!Number.isFinite(n)) return;
                const next = { ...(crop ?? FULL_IMAGE), [k]: Math.round(n * 1000) / 1000 };
                onChange({ ...el, crop: next });
              }}
            />
          </label>
        ))}
        <button type="button" onClick={() => onChange({ ...el, crop: undefined })} disabled={!el.crop}>
          Reset
        </button>
      </div>
      <label>
        turn image
        <select
          value={el.image_rotation_deg ?? 0}
          onChange={(e) => {
            const deg = Number(e.target.value) as (typeof IMAGE_ROTATIONS)[number];
            onChange({ ...el, image_rotation_deg: deg === 0 ? undefined : deg });
          }}
        >
          {IMAGE_ROTATIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "upright" : `${d}° clockwise`}
            </option>
          ))}
        </select>
      </label>
      <label>
        filter
        <select
          value={el.filter ?? ""}
          onChange={(e) =>
            onChange({ ...el, filter: (e.target.value || undefined) as ImageFilter | undefined })
          }
        >
          <option value="">auto ({autoFilter})</option>
          {/* The option equal to "auto" would read twice; it stays only while explicitly set. */}
          {IMAGE_FILTERS.filter((f) => f !== autoFilter || el.filter === f).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        feather cm
        <input
          type="number"
          min={0}
          step={0.1}
          value={el.feather_cm ?? ""}
          placeholder="1 (default)"
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            onChange({ ...el, feather_cm: Number.isFinite(n) && n >= 0 ? n : undefined });
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={!!el.flip}
          onChange={(e) => onChange({ ...el, flip: e.target.checked || undefined })}
        />
        mirror left-right
      </label>
    </fieldset>
  );
}

/** The figure's image, large, with Change image and quick previous / next arrows. */
function ImageSwap(props: {
  el: FigureLike;
  asset?: AssetInfo | null;
  locked: boolean;
  onChangeImage?: (anchor: HTMLElement) => void;
  onStepImage?: ((dir: 1 | -1) => void) | null;
}) {
  const { el, asset, locked, onChangeImage, onStepImage } = props;
  const crop = el.crop ?? asset?.crop;
  return (
    <div className="image-swap">
      <div className="image-swap-thumb">
        {!el.asset ? (
          <p className="muted small">No image yet.</p>
        ) : asset === null ? (
          <p className="warn small">{el.asset} is not in the catalogue.</p>
        ) : asset === undefined ? (
          <p className="muted small">No images available.</p>
        ) : (
          <AssetThumb asset={asset} crop={crop} />
        )}
      </div>
      <div className="image-swap-bar">
        <button
          type="button"
          className="ghost icon-button"
          aria-label="Previous image"
          title="Previous image of the same kind"
          disabled={locked || !onStepImage}
          onClick={() => onStepImage?.(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="primary change-image"
          disabled={locked || !onChangeImage}
          onClick={(e) => onChangeImage?.(e.currentTarget)}
          title={locked ? "Unlock it to change its image" : "Pick another image"}
        >
          {el.asset ? "Change image" : "Choose image"}
        </button>
        <button
          type="button"
          className="ghost icon-button"
          aria-label="Next image"
          title="Next image of the same kind"
          disabled={locked || !onStepImage}
          onClick={() => onStepImage?.(1)}
        >
          ›
        </button>
      </div>
      {el.asset && <p className="image-swap-id mono faint">{el.asset}</p>}
    </div>
  );
}

function PatternSelect(props: {
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (pattern: string) => void;
}) {
  const { value, options, disabled, onChange } = props;
  // A pattern name from the YAML that is not in the list stays selectable.
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {all.map((p) => (
        <option key={p} value={p}>
          {p}
          {options.includes(p) ? "" : " (unknown)"}
        </option>
      ))}
    </select>
  );
}

/** A colour picker plus a few swatches; red stays the named "red" the sleeve uses. */
export function ColorField(props: {
  value: string | undefined;
  disabled?: boolean;
  onChange: (color: string) => void;
}) {
  const { value, disabled, onChange } = props;
  const hex = colorToHex(value);
  return (
    <span className="color-field">
      <input
        type="color"
        aria-label="Line colour"
        value={hex}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {LINE_SWATCHES.map((s) => (
        <button
          key={s.value}
          type="button"
          className={`swatch-button${colorToHex(s.value) === hex ? " on" : ""}`}
          style={{ background: colorToHex(s.value) }}
          aria-label={s.label}
          aria-pressed={colorToHex(s.value) === hex}
          title={s.label}
          disabled={disabled}
          onClick={() => onChange(s.value)}
        />
      ))}
    </span>
  );
}
