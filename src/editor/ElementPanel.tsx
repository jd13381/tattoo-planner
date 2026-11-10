import { AssetThumb } from "../assets/AssetBrowser.tsx";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DuplicateIcon,
  ImageIcon,
  LockIcon,
  TrashIcon,
  WarnIcon,
} from "../ui/icons.tsx";
import { useState, type ReactNode } from "react";
import { BAND_PATTERNS } from "../render/patterns/index.ts";
import { colorToHex, LINE_SWATCHES } from "./edit.ts";
import { ChevronIcon } from "./editorIcons.tsx";
import { filterLabel, KIND_LABEL } from "./labels.ts";
import { readFlag, writeFlag } from "./viewPrefs.ts";
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
  /** Error of the id field (duplicate or invalid), shown under it. */
  idError?: string | null;
  /** Keyboard hints for the button tooltips, e.g. { duplicate: "⌘D" }. */
  keys?: Partial<Record<"duplicate" | "delete" | "forward" | "back", string>>;
};

const AROUND_HELP =
  "Where it sits around the limb, as a part of a full turn: 0 is the main centre line, 0.5 the opposite side. (u in the layout file)";
const ALONG_HELP =
  "Where it sits along the limb: 0 at the near end, 1 at the far end. (v in the layout file)";

/** "≈ on the outer line · 15.4 cm from the wrist" as the two parts of the read-out. */
function readoutParts(positionCm: string): string[] {
  const text = positionCm.replace(/^≈\s*/, "");
  return text.split(" · ").map((part, i) => (i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part));
}

/**
 * Properties of the selected element. Every field maps 1:1 to the layout YAML; the labels are plain
 * words (labels.ts), the file's own key is named in a field's tooltip where it differs.
 */
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
  idError,
  keys = {},
}: Props) {
  const locked = !!el.locked;
  const hint = (k: keyof NonNullable<Props["keys"]>) => (keys[k] ? ` (${keys[k]})` : "");
  const num = (
    value: number | null | undefined,
    set: (n: number | null) => void,
    opts: { step?: number; nullable?: boolean; label?: string; placeholder?: string } = {},
  ) => (
    <input
      type="number"
      aria-label={opts.label}
      step={opts.step ?? 0.01}
      value={value ?? ""}
      placeholder={opts.placeholder ?? (opts.nullable ? "auto" : undefined)}
      disabled={locked}
      onChange={(e) => {
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n)) set(n);
        else if (opts.nullable) set(null);
      }}
    />
  );
  const readout = (
    <p className="ins-readout" title="Measured on the skin, from the element's centre">
      {readoutParts(positionCm).map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  );

  return (
    <section className="panel element-panel" aria-label="Element">
      <div className="panel-head inspector-head">
        <span className={`swatch cat-${el.type}`} aria-hidden="true" />
        <h2>{el.id}</h2>
        <span className="faint">{KIND_LABEL[el.type]}</span>
        <span className="spacer" />
        <button
          type="button"
          className={`ghost icon-button lock-toggle${locked ? " on" : ""}`}
          aria-pressed={locked}
          aria-label={locked ? "Unlock" : "Lock"}
          title={
            locked
              ? "Locked: cannot be moved, edited or deleted. Click to unlock."
              : "Lock against accidental edits"
          }
          onClick={() => onChange({ ...el, locked: locked ? undefined : true })}
        >
          <LockIcon open={!locked} />
        </button>
      </div>
      {locked && (
        <p className="ins-locked">
          <LockIcon open={false} />
          Locked. Unlock it to move or edit it.
        </p>
      )}
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
        <span className="layer-label" title="Layer 1 is drawn at the bottom; higher layers cover it">
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
          title={`Duplicate: a copy on top, with a new name${hint("duplicate")}`}
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
        <label
          className="ins-row"
          title="The element's name in the lists, the layout file and the handout: lowercase letters, digits and dashes"
        >
          Name
          <input
            type="text"
            value={el.id}
            disabled={locked}
            spellCheck={false}
            autoComplete="off"
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
            <ImageSwap el={el} asset={asset} locked={locked} onChangeImage={onChangeImage} />
            <h3 className="props-head">Position</h3>
            {readout}
            <div className="field-pair">
              <Box k="Around" unit="u" title={AROUND_HELP}>
                {num(el.position.u, (u) => onChange({ ...el, position: { ...el.position, u: u ?? 0 } }), {
                  label: "Position around (u)",
                })}
              </Box>
              <Box k="Along" unit="v" title={ALONG_HELP}>
                {num(el.position.v, (v) => onChange({ ...el, position: { ...el.position, v: v ?? 0 } }), {
                  label: "Position along (v)",
                })}
              </Box>
            </div>
            <h3 className="props-head">Size</h3>
            <div className="field-pair">
              <Box k="Height" unit="cm">
                {num(el.size_cm.h, (h) => onChange({ ...el, size_cm: { ...el.size_cm, h } }), {
                  step: 0.1,
                  nullable: true,
                  label: "Height in cm",
                })}
              </Box>
              <Box k="Width" unit="cm" title="Leave empty to follow the image's proportions">
                {num(
                  el.size_cm.w,
                  (w) => onChange({ ...el, size_cm: { ...el.size_cm, w: w ?? undefined } }),
                  { step: 0.1, nullable: true, label: "Width in cm" },
                )}
              </Box>
              <Box k="Rotation" unit="°" title="Turns the whole element on the skin, counter-clockwise">
                {num(el.rotation_deg, (r) => onChange({ ...el, rotation_deg: r ?? undefined }), {
                  step: 1,
                  nullable: true,
                  label: "Rotation in degrees",
                  placeholder: "0",
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
            {readout}
            <div className="field-pair">
              <Box k="Along" unit="v" title={ALONG_HELP}>
                {num(el.v, (v) => onChange({ ...el, v: v ?? 0 }), { label: "Position along (v)" })}
              </Box>
            </div>
            <h3 className="props-head">Size</h3>
            <div className="field-pair">
              <Box k="Width" unit="cm" title="How wide the band is, along the limb">
                {num(el.width_cm, (w) => onChange({ ...el, width_cm: w ?? 1 }), {
                  step: 0.1,
                  label: "Width in cm",
                })}
              </Box>
            </div>
            <h3 className="props-head">Style</h3>
            <label className="ins-row">
              Pattern
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
            {readout}
            <p className="ins-help">
              {el.points.length} points. Drag the dots on the sheet to reshape the line.
            </p>
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
            <div className="props-row ins-row">
              <span>Colour</span>
              <ColorField
                value={el.color}
                disabled={locked}
                onChange={(color) => onChange({ ...el, color })}
              />
            </div>
            <div className="field-pair">
              <Box k="Thickness" unit="cm">
                {num(el.width_cm, (w) => onChange({ ...el, width_cm: w ?? 1 }), {
                  step: 0.1,
                  label: "Thickness in cm",
                })}
              </Box>
            </div>
          </>
        )}
        <h3 className="props-head">Notes</h3>
        <textarea
          aria-label="Notes"
          value={el.notes ?? ""}
          disabled={locked}
          rows={2}
          placeholder="For you and the artist; printed in the handout"
          onChange={(e) => onChange({ ...el, notes: e.target.value || undefined })}
        />
      </div>
    </section>
  );
}

/** A compact number field: a short label in front, an optional unit behind (Pro inspector). */
function Box({
  k,
  unit,
  title,
  children,
}: {
  k: string;
  unit?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <label className="field-box" title={title}>
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

const CROP_FIELDS = [
  { key: "x", label: "Left" },
  { key: "y", label: "Top" },
  { key: "w", label: "Width" },
  { key: "h", label: "Height" },
] as const;

const ADVANCED_KEY = "layout.inspector.advanced";

/** How a figure's image is shown: look, turn, mirror; cut-out, soft edge and projection under Advanced. */
function ImageFields(props: {
  el: FigureLike;
  asset?: AssetInfo | null;
  autoFilter: ImageFilter;
  locked: boolean;
  onChange: (el: LayoutElement) => void;
}) {
  const { el, asset, autoFilter, locked, onChange } = props;
  const crop = el.crop ?? asset?.crop;
  const [advanced, setAdvanced] = useState(() => readFlag(ADVANCED_KEY, false));
  const toggleAdvanced = () => {
    writeFlag(ADVANCED_KEY, !advanced);
    setAdvanced(!advanced);
  };
  // What Advanced holds that differs from the defaults, so a closed section does not hide a setting.
  const custom = [
    el.crop ? "crop" : null,
    el.feather_cm != null ? "soft edge" : null,
    el.type === "existing" && el.projection ? "projection" : null,
  ].filter((c): c is string => c !== null);
  return (
    <fieldset className="image-fields" disabled={locked}>
      <legend>Image</legend>
      <label className="ins-row" title="How the image is drawn on the skin in Reference mode">
        Look
        <select
          value={el.filter ?? ""}
          onChange={(e) =>
            onChange({ ...el, filter: (e.target.value || undefined) as ImageFilter | undefined })
          }
        >
          <option value="">Automatic ({filterLabel(autoFilter).toLowerCase()})</option>
          {/* The option equal to "auto" would read twice; it stays only while explicitly set. */}
          {IMAGE_FILTERS.filter((f) => f !== autoFilter || el.filter === f).map((f) => (
            <option key={f} value={f}>
              {filterLabel(f)}
            </option>
          ))}
        </select>
      </label>
      <label className="ins-row" title="Turns the image inside its box in quarter turns">
        Turn image
        <select
          value={el.image_rotation_deg ?? 0}
          onChange={(e) => {
            const deg = Number(e.target.value) as (typeof IMAGE_ROTATIONS)[number];
            onChange({ ...el, image_rotation_deg: deg === 0 ? undefined : deg });
          }}
        >
          {IMAGE_ROTATIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "Upright" : `${d}° clockwise`}
            </option>
          ))}
        </select>
      </label>
      <label className="check ins-check">
        <input
          type="checkbox"
          checked={!!el.flip}
          onChange={(e) => onChange({ ...el, flip: e.target.checked || undefined })}
        />
        Mirror left to right
      </label>
      <div className="ins-adv">
        <button
          type="button"
          className="ghost ins-adv-toggle"
          aria-expanded={advanced}
          aria-controls="inspector-advanced"
          onClick={toggleAdvanced}
        >
          <ChevronIcon dir={advanced ? "down" : "right"} />
          Advanced
          {!advanced && custom.length > 0 && <span className="ins-adv-note">{custom.join(", ")} set</span>}
        </button>
        {advanced && (
          <div id="inspector-advanced" className="ins-adv-body">
            <div className="ins-sub">
              <span>Crop</span>
              <span className="ins-sub-note">
                {el.crop ? "custom" : asset?.crop ? "from the image's entry" : "whole image"}
              </span>
              <button
                type="button"
                className="link"
                onClick={() => onChange({ ...el, crop: undefined })}
                disabled={!el.crop}
              >
                Reset
              </button>
            </div>
            <div
              className="field-pair"
              title="The part of the image that is used, as fractions of its width and height (0 to 1)"
            >
              {CROP_FIELDS.map(({ key, label }) => (
                <label key={key} className="field-box">
                  <span className="k" aria-hidden="true">
                    {label}
                  </span>
                  <input
                    type="number"
                    aria-label={`Crop ${label.toLowerCase()}`}
                    min={0}
                    max={1}
                    step={0.005}
                    value={crop?.[key] ?? FULL_IMAGE[key]}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      if (!Number.isFinite(n)) return;
                      const next = { ...(crop ?? FULL_IMAGE), [key]: Math.round(n * 1000) / 1000 };
                      onChange({ ...el, crop: next });
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="field-pair">
              <label className="field-box" title="How far the image's edge fades into the skin">
                <span className="k" aria-hidden="true">
                  Soft edge
                </span>
                <input
                  type="number"
                  aria-label="Soft edge in cm"
                  min={0}
                  step={0.1}
                  value={el.feather_cm ?? ""}
                  placeholder="1"
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    onChange({ ...el, feather_cm: Number.isFinite(n) && n >= 0 ? n : undefined });
                  }}
                />
                <span className="u" aria-hidden="true">
                  cm
                </span>
              </label>
            </div>
            {el.type === "existing" && (
              <label
                className="ins-row"
                title="A calibration made in Settings → Projection: the tattoo is drawn from all its photos; position, size and crop apply only while that cannot be built."
              >
                Projection
                <input
                  type="text"
                  value={el.projection ?? ""}
                  placeholder="none"
                  spellCheck={false}
                  onChange={(e) => onChange({ ...el, projection: e.target.value || undefined })}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** The figure's image, large; changing it is a quiet button on the image (it opens the picker). */
function ImageSwap(props: {
  el: FigureLike;
  asset?: AssetInfo | null;
  locked: boolean;
  onChangeImage?: (anchor: HTMLElement) => void;
}) {
  const { el, asset, locked, onChangeImage } = props;
  const crop = el.crop ?? asset?.crop;
  const shown = !!el.asset && !!asset;
  return (
    <div className="image-swap">
      <div className={`image-swap-thumb${shown ? "" : " ins-noimage"}`}>
        {!el.asset ? (
          <p className="muted small">No image yet.</p>
        ) : asset === null ? (
          <p className="warn small">{el.asset} is not among the project's images.</p>
        ) : asset === undefined ? (
          <p className="muted small">No images available.</p>
        ) : (
          <AssetThumb asset={asset} crop={crop} />
        )}
        <button
          type="button"
          className="ins-change-image"
          disabled={locked || !onChangeImage}
          onClick={(e) => onChangeImage?.(e.currentTarget)}
          title={locked ? "Unlock it to change its image" : "Pick another image from the project"}
        >
          <ImageIcon />
          {el.asset ? "Change image" : "Choose image"}
        </button>
      </div>
      {el.asset && (
        <p className="image-swap-id faint" title={`Image: ${el.asset}`}>
          <span className="mono">{el.asset}</span>
        </p>
      )}
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
