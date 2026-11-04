import { AssetThumb } from "../assets/AssetBrowser.tsx";
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
  index: number;
  count: number;
  onChange: (el: LayoutElement) => void;
  onLayer: (dir: 1 | -1) => void;
  onDelete: () => void;
  onDuplicate: () => void;
};

/** Properties of the selected element. Every field maps 1:1 to the layout YAML. */
export function ElementPanel({
  element: el,
  asset,
  autoFilter,
  flags,
  index,
  count,
  onChange,
  onLayer,
  onDelete,
  onDuplicate,
}: Props) {
  const locked = !!el.locked;
  const num = (
    value: number | null | undefined,
    set: (n: number | null) => void,
    opts: { step?: number; nullable?: boolean } = {},
  ) => (
    <input
      type="number"
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

  return (
    <section className="panel element-panel" aria-label="Element">
      <div className="panel-head">
        <h2>
          {el.id} <span className="muted small">{el.type}</span>
        </h2>
      </div>
      {flags.length > 0 && (
        <p className="warn small">
          {flags.includes("height not set") ? "Height not set: drawn 10 cm tall. " : ""}
          {flags.includes("width assumed") ? "Width not set: drawn at 0.55 × height." : ""}
        </p>
      )}
      <div className="toolbar">
        <button
          type="button"
          onClick={() => onLayer(1)}
          disabled={index === count - 1}
          title="Draw above the next element"
        >
          Up
        </button>
        <button
          type="button"
          onClick={() => onLayer(-1)}
          disabled={index === 0}
          title="Draw below the previous element"
        >
          Down
        </button>
        <button type="button" onClick={() => onChange({ ...el, locked: locked ? undefined : true })}>
          {locked ? "Unlock" : "Lock"}
        </button>
        <button type="button" onClick={onDuplicate} disabled={locked}>
          Duplicate
        </button>
        <button type="button" onClick={onDelete} disabled={locked}>
          Delete
        </button>
      </div>
      <div className="props">
        <label>
          id
          <input
            type="text"
            value={el.id}
            disabled={locked}
            onChange={(e) =>
              onChange({ ...el, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
            }
          />
        </label>
        {(el.type === "figure" || el.type === "existing") && (
          <>
            <label>asset {text(el.asset, (asset) => onChange({ ...el, asset }))}</label>
            {el.type === "existing" && (
              <label title="A calibration in config/projections/: the tattoo is drawn from all its photos (Projection tab); position, size and cut-out apply only while that cannot be built.">
                projection {text(el.projection, (projection) => onChange({ ...el, projection }))}
              </label>
            )}
            <label>
              u (around){" "}
              {num(el.position.u, (u) => onChange({ ...el, position: { ...el.position, u: u ?? 0 } }))}
            </label>
            <label>
              v (along){" "}
              {num(el.position.v, (v) => onChange({ ...el, position: { ...el.position, v: v ?? 0 } }))}
            </label>
            <label>
              height cm{" "}
              {num(el.size_cm.h, (h) => onChange({ ...el, size_cm: { ...el.size_cm, h } }), {
                step: 0.1,
                nullable: true,
              })}
            </label>
            <label>
              width cm{" "}
              {num(el.size_cm.w, (w) => onChange({ ...el, size_cm: { ...el.size_cm, w: w ?? undefined } }), {
                step: 0.1,
                nullable: true,
              })}
            </label>
            <label>
              rotation °{" "}
              {num(el.rotation_deg, (r) => onChange({ ...el, rotation_deg: r ?? undefined }), {
                step: 1,
                nullable: true,
              })}
            </label>
            <label>style {text(el.style, (style) => onChange({ ...el, style }))}</label>
            <label className="check">
              <input
                type="checkbox"
                checked={!!el.red_accents}
                disabled={locked}
                onChange={(e) => onChange({ ...el, red_accents: e.target.checked || undefined })}
              />
              red accents
            </label>
            <ImageFields el={el} asset={asset} autoFilter={autoFilter} locked={locked} onChange={onChange} />
          </>
        )}
        {el.type === "filler" && (
          <>
            <label>
              pattern {text(el.pattern, (pattern) => onChange({ ...el, pattern: pattern ?? "" }))}
            </label>
            <label>
              u from{" "}
              {num(el.region.u[0], (n) =>
                onChange({ ...el, region: { ...el.region, u: [n ?? 0, el.region.u[1]] } }),
              )}
            </label>
            <label>
              u to{" "}
              {num(el.region.u[1], (n) =>
                onChange({ ...el, region: { ...el.region, u: [el.region.u[0], n ?? 0] } }),
              )}
            </label>
            <label>
              v from{" "}
              {num(el.region.v[0], (n) =>
                onChange({ ...el, region: { ...el.region, v: [n ?? 0, el.region.v[1]] } }),
              )}
            </label>
            <label>
              v to{" "}
              {num(el.region.v[1], (n) =>
                onChange({ ...el, region: { ...el.region, v: [el.region.v[0], n ?? 0] } }),
              )}
            </label>
            <label>
              density{" "}
              {num(el.density, (density) => onChange({ ...el, density: density ?? undefined }), {
                step: 0.05,
                nullable: true,
              })}
            </label>
          </>
        )}
        {el.type === "band" && (
          <>
            <label>
              pattern {text(el.pattern, (pattern) => onChange({ ...el, pattern: pattern ?? "" }))}
            </label>
            <label>v (along) {num(el.v, (v) => onChange({ ...el, v: v ?? 0 }))}</label>
            <label>
              width cm {num(el.width_cm, (w) => onChange({ ...el, width_cm: w ?? 1 }), { step: 0.1 })}
            </label>
          </>
        )}
        {el.type === "line" && (
          <>
            <label>color {text(el.color, (color) => onChange({ ...el, color }))}</label>
            <label>
              width cm {num(el.width_cm, (w) => onChange({ ...el, width_cm: w ?? 1 }), { step: 0.1 })}
            </label>
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
          </>
        )}
        <label>
          notes
          <textarea
            value={el.notes ?? ""}
            disabled={locked}
            rows={2}
            onChange={(e) => onChange({ ...el, notes: e.target.value || undefined })}
          />
        </label>
      </div>
    </section>
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
      <legend>Reference image</legend>
      {!el.asset ? (
        <p className="muted small">No asset: pick one in the asset list.</p>
      ) : asset === null ? (
        <p className="warn small">{el.asset} is not in the manifest.</p>
      ) : asset === undefined ? (
        <p className="muted small">No asset manifest available.</p>
      ) : (
        <AssetThumb asset={asset} crop={crop} />
      )}
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
          {IMAGE_FILTERS.map((f) => (
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
