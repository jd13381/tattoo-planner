// Projection tab (docs/adr/0006): calibrate how the photos of an existing tattoo map onto the arm and
// preview the combined patch on the unwrap and the 3D arm. Save writes config/projections/<name>.yaml.
// The maths lives in model.ts and patch.ts; this file only draws and edits numbers.
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ArmProfile } from "../arm/profile.ts";
import { requestImage, useAssetImages, useAssetListing } from "../assets/useAssets.ts";
import type { Layout } from "../layout/schema.ts";
import type { AssetImage } from "../render/reference.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { ArmViewer } from "../viewer/ArmViewer.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { modelGrid, photoFrame, turnedSize, type GridLine } from "./model.ts";
import type { ProjectedPatch } from "./patch.ts";
import { photoStatus, type ListingState, type PhotoStatus } from "./photoStatus.ts";
import type { PhotoCalibration, ProjectionCalibration } from "./schema.ts";
import { projectionSchema } from "./schema.ts";
import { patchFor, photoAssets, saveProjection, useProjections } from "./useProjections.ts";

/** Preview resolution: coarse enough to rebuild while dragging, fine enough to judge seams. */
const PREVIEW_PX_PER_CM = 10;
const TEXTURE_PX_PER_CM = 12;
const PREVIEW_ID = "projection-preview";

export function ProjectionPage({
  arm,
  pose,
  onDirty,
}: {
  arm: ArmState;
  pose: Pose;
  /** Reports unsaved edits, so the app can warn before a reload. */
  onDirty?: (dirty: boolean) => void;
}) {
  const { files, calibrations, errors, loadError } = useProjections();
  const [name, setName] = useState<string | null>(null);
  if (loadError)
    return (
      <p className="notice error" role="alert">
        {loadError}
      </p>
    );
  if (files === null) return <p className="muted">Loading projections…</p>;
  const names = files.map((f) => f.name);
  if (names.length === 0)
    return (
      <section className="empty">
        <h2>No projections yet</h2>
        <p>
          A projection maps the photos of an existing tattoo onto the arm. Add{" "}
          <code>config/projections/&lt;name&gt;.yaml</code> (see{" "}
          <code>docs/adr/0006-anubis-projection.md</code>) and reload.
        </p>
      </section>
    );
  const current = name && names.includes(name) ? name : names[0]!;
  const saved = calibrations.get(current) ?? null;
  const picker = (
    <label className="inline">
      Projection{" "}
      <select value={current} onChange={(e) => setName(e.target.value)}>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
            {errors.has(n) ? " (invalid)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
  if (!saved)
    return (
      <div className="projection-page">
        <div className="layout-toolbar toolbar">{picker}</div>
        <p className="notice error" role="alert">
          <strong>{current}.yaml is invalid:</strong> {errors.get(current)}
        </p>
      </div>
    );
  return (
    <ProjectionEditor
      key={current}
      saved={saved}
      picker={picker}
      profile={arm.profile}
      pose={pose}
      onDirty={onDirty}
    />
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; file: string }
  | { kind: "failed"; message: string };

function ProjectionEditor(props: {
  saved: ProjectionCalibration;
  picker: React.ReactNode;
  profile: ArmProfile;
  pose: Pose;
  onDirty?: (dirty: boolean) => void;
}) {
  const { saved, picker, profile, pose, onDirty } = props;
  const current = saved.name;
  const { listing } = useAssetListing();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((a) => [a.id, a])) : null),
    [listing],
  );
  const { images, version: imagesVersion } = useAssetImages();
  const [draft, setDraft] = useState<ProjectionCalibration>(() => structuredClone(saved));
  const savedJson = JSON.stringify(saved);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const dirty = JSON.stringify(draft) !== savedJson;
  useEffect(() => onDirty?.(dirty), [onDirty, dirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const valid = draft ? projectionSchema.safeParse(draft) : null;
  const validationError =
    valid && !valid.success
      ? valid.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : null;

  const infos = useMemo(() => (draft ? photoAssets(draft, assetMap) : []), [draft, assetMap]);
  useEffect(() => {
    for (const info of infos) if (info?.exists) requestImage(info.id);
  }, [infos]);

  // The preview follows the draft a moment later, so dragging stays smooth.
  const [previewCal, setPreviewCal] = useState<ProjectionCalibration | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCal(draft && valid?.success ? draft : null), 120);
    return () => clearTimeout(t);
  }, [draft, valid?.success]);
  const preview = useMemo(() => {
    void imagesVersion;
    if (!previewCal) return null;
    const cal = {
      ...previewCal,
      patch: { ...previewCal.patch, px_per_cm: Math.min(previewCal.patch.px_per_cm, PREVIEW_PX_PER_CM) },
    };
    return patchFor(cal, profile, assetMap, images);
  }, [previewCal, profile, assetMap, images, imagesVersion]);
  const patch = preview?.status === "ready" ? preview.patch : null;
  // Patch problems only matter once the photos can be read; each photo's frame says what is wrong,
  // so the notice only counts them (the full list is its tooltip).
  const photoCount = draft.photos.length;
  const patchNotice =
    listing?.status !== "ok"
      ? null
      : preview?.status === "unavailable"
        ? {
            text: `Cannot build the patch: none of the ${photoCount} photos can be read.`,
            detail: preview.reason,
          }
        : preview?.status === "ready" && preview.missing.length > 0
          ? {
              text: `Patch built from ${photoCount - preview.missing.length} of ${photoCount} photos.`,
              detail: preview.missing.join("\n"),
            }
          : null;
  const draftV1 = Math.min(1, draft.patch.v[1] + 0.03);

  const { texture, innerImage } = useMemo(() => {
    const layout: Layout = {
      name: "projection-preview",
      elements: [
        {
          type: "existing",
          id: PREVIEW_ID,
          projection: current,
          locked: true,
          position: { u: 0.5, v: 0.2 },
          size_cm: { h: null },
        },
      ],
    };
    const sources = {
      assets: assetMap,
      images,
      aspects: new Map<string, number>(),
      patches: new Map<string, ProjectedPatch>(patch ? [[PREVIEW_ID, patch]] : []),
    };
    const make = (centerU: number) => {
      const c = document.createElement("canvas");
      c.className = "projection-unwrap";
      renderUnwrap(c, profile, patch ? "reference" : "grid", layout, {
        pxPerCm: TEXTURE_PX_PER_CM,
        grid: true,
        centerU,
        sources,
      });
      return c;
    };
    // The 2D preview only shows the rows of the patch, with a little skin around it.
    const full = make(0.5);
    const top = Math.max(0, Math.floor((1 - draftV1) * full.height) - 2 * TEXTURE_PX_PER_CM);
    const crop = document.createElement("canvas");
    crop.className = "projection-unwrap";
    crop.width = full.width;
    crop.height = full.height - top;
    crop.getContext("2d")!.drawImage(full, 0, top, full.width, crop.height, 0, 0, full.width, crop.height);
    return { texture: make(0), innerImage: crop };
  }, [patch, current, assetMap, images, profile, draftV1]);

  const photo = draft.photos[Math.min(photoIndex, draft.photos.length - 1)];
  const info = infos[photoIndex] ?? null;
  const image = info ? images.get(info.id) : undefined;
  const listingState: ListingState = listing === null ? "loading" : listing.status;
  const status: PhotoStatus | null = photo
    ? photoStatus({ file: photo.file, listing: listingState, info, image })
    : null;
  const setPhoto = (p: PhotoCalibration) =>
    setDraft((d) => (d ? { ...d, photos: d.photos.map((q, i) => (i === photoIndex ? p : q)) } : d));

  const canSave = dirty && !validationError && saveState.kind !== "saving";
  const save = async () => {
    if (!canSave) return;
    setSaveState({ kind: "saving" });
    try {
      await saveProjection(draft);
      setSaveState({ kind: "saved", file: `config/projections/${draft.name}.yaml` });
    } catch (e) {
      setSaveState({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };
  // The "Saved" confirmation fades after a moment; a failure stays until the next save.
  useEffect(() => {
    if (saveState.kind !== "saved") return;
    const t = setTimeout(() => setSaveState({ kind: "idle" }), 3000);
    return () => clearTimeout(t);
  }, [saveState]);
  // Cmd+S / Ctrl+S saves while this tab is open (it is only mounted while visible).
  const onSaveKey = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
    e.preventDefault();
    void save();
  });
  useEffect(() => {
    window.addEventListener("keydown", onSaveKey);
    return () => window.removeEventListener("keydown", onSaveKey);
  }, []);

  const photoReady = status?.kind === "ready";
  const noData = listingState === "unset" || listingState === "error";

  return (
    <div className="projection-page">
      <div className="layout-toolbar toolbar">
        {picker}
        <span className="toolbar-sep" />
        <button
          type="button"
          className={dirty ? "primary" : ""}
          disabled={!canSave}
          onClick={() => void save()}
          title={validationError ? `Fix first: ${validationError}` : "Save (⌘S)"}
        >
          {saveState.kind === "saving" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!dirty}
          onClick={() => setDraft(structuredClone(saved))}
          title="Discard the unsaved changes"
        >
          Revert
        </button>
        <span className="save-status" role="status">
          {saveState.kind === "saved" ? (
            <span className="chip ok">Saved {saveState.file}</span>
          ) : dirty ? (
            <span className="muted small">Unsaved changes</span>
          ) : null}
        </span>
        <span className="spacer" />
        <span className="faint small">⌘S saves</span>
      </div>
      {(validationError || saveState.kind === "failed" || patchNotice) && (
        <div className="notices">
          {validationError && (
            <p className="notice error">
              <strong>Not saved:</strong> {validationError}
            </p>
          )}
          {saveState.kind === "failed" && (
            <p className="notice error" role="alert">
              <strong>Save failed:</strong> {saveState.message}
            </p>
          )}
          {patchNotice && (
            <p className="notice warn" title={patchNotice.detail}>
              {patchNotice.text} The photo tabs say why.
            </p>
          )}
        </div>
      )}
      {photo && status && (
        <div className="projection-grid">
          <section className="projection-photo" aria-label="Photo calibration">
            <PhotoTabs
              photos={draft.photos}
              index={photoIndex}
              share={patch?.share ?? null}
              onSelect={setPhotoIndex}
            />
            <div
              className="photo-panel"
              role="tabpanel"
              id="projection-photo-panel"
              aria-labelledby={`projection-photo-tab-${photoIndex}`}
            >
              {status.kind !== "ready" ? (
                <PhotoPlaceholder status={status} file={photo.file} />
              ) : (
                image?.status === "ready" && (
                  <PhotoEditor photo={photo} image={image} profile={profile} onChange={setPhoto} />
                )
              )}
            </div>
            <p className="muted small">
              Drag the orange edge ends onto the forearm's outline and the red marks onto points whose
              distance from the wrist crease you know. Red line: inner centre line, green: lateral and medial,
              magenta: every 10 cm from the wrist crease.
            </p>
          </section>
          <section className="projection-views" aria-label="Preview">
            <ArmViewer
              profile={profile}
              canvas={texture}
              version={0}
              bendDeg={pose.bendDeg}
              onBendDeg={pose.setBendDeg}
              viewSides
              hint="Shows the combined patch alone, in reference mode."
            />
            <figure className="projection-preview">
              <figcaption className="section-label">Combined patch · inner side centred</figcaption>
              <CanvasHost canvas={innerImage} />
            </figure>
          </section>
          <aside className="side-col projection-side" aria-label="Calibration">
            <section className="panel">
              <div className="panel-head">
                <h2>This photo</h2>
                <span className="muted small photo-name" title={photo.file}>
                  {photo.file.split("/").pop()}
                </span>
              </div>
              <fieldset disabled={!photoReady}>
                <PhotoFields photo={photo} onChange={setPhoto} />
              </fieldset>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Patch (all photos)</h2>
              </div>
              <fieldset disabled={noData}>
                <PatchFields cal={draft} onChange={setDraft} />
              </fieldset>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

/** The photo switcher: one tab per photo, with its share of the patch once that is built. */
function PhotoTabs(props: {
  photos: PhotoCalibration[];
  index: number;
  share: number[] | null;
  onSelect: (i: number) => void;
}) {
  const { photos, index, share, onSelect } = props;
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const n = photos.length;
    const next =
      e.key === "ArrowRight"
        ? (index + 1) % n
        : e.key === "ArrowLeft"
          ? (index - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    document.getElementById(`projection-photo-tab-${next}`)?.focus();
  };
  return (
    <div className="photo-tabs" role="tablist" aria-label="Photos">
      {photos.map((p, i) => (
        <button
          key={p.file}
          id={`projection-photo-tab-${i}`}
          type="button"
          role="tab"
          aria-selected={i === index}
          aria-controls="projection-photo-panel"
          tabIndex={i === index ? 0 : -1}
          onClick={() => onSelect(i)}
          onKeyDown={onKey}
          title={p.file}
        >
          {p.file.split("/").pop()}
          {share && <span className="share">{Math.round((share[i] ?? 0) * 100)} %</span>}
        </button>
      ))}
    </div>
  );
}

/** Stands in for the photo while it cannot be shown, and says why. */
function PhotoPlaceholder({
  status,
  file,
}: {
  status: Exclude<PhotoStatus, { kind: "ready" }>;
  file: string;
}) {
  return (
    <div
      className={`photo-frame placeholder ${status.kind}`}
      role="img"
      aria-label={`${file}: ${status.title}`}
    >
      <div className="photo-placeholder">
        <strong>{status.title}</strong>
        {status.kind === "blocked" && <span>{status.detail}</span>}
      </div>
    </div>
  );
}

function CanvasHost({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(canvas);
  }, [canvas]);
  return <div ref={ref} />;
}

type Handle = { kind: "edge"; side: "left" | "right"; end: 0 | 1 } | { kind: "along"; index: 0 | 1 };

const GRID_COLORS: Record<GridLine["kind"], string> = {
  inner: "#e53935",
  side: "#43a047",
  u: "rgba(0, 200, 255, 0.7)",
  s10: "#d81b60",
  s: "rgba(255, 235, 59, 0.8)",
};

/** The turned photo with the calibration drawn on it; edge ends and marks can be dragged. */
function PhotoEditor(props: {
  photo: PhotoCalibration;
  image: Extract<AssetImage, { status: "ready" }>;
  profile: ArmProfile;
  onChange: (p: PhotoCalibration) => void;
}) {
  const { photo, image: ready, profile, onChange } = props;
  const size = turnedSize(ready.width, ready.height, photo.turn);
  const turned = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = size.width;
    c.height = size.height;
    const ctx = c.getContext("2d")!;
    ctx.translate(size.width / 2, size.height / 2);
    ctx.rotate((photo.turn * Math.PI) / 180);
    ctx.drawImage(ready.image, -ready.width / 2, -ready.height / 2);
    return c.toDataURL("image/jpeg", 0.85);
  }, [ready, photo.turn, size.width, size.height]);
  const frame = useMemo(
    () => photoFrame(photo, size.width, size.height, profile.elbowAt),
    [photo, size.width, size.height, profile.elbowAt],
  );
  const grid = useMemo(
    () => (frame ? modelGrid(frame, profile, { sMax: profile.elbowAt + 2 }) : []),
    [frame, profile],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const r = (x: number) => Math.round(x * 10000) / 10000;
    return { x: r(p.x / size.width), y: r(p.y / size.height) };
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = toNorm(e);
    if (!p) return;
    if (drag.kind === "edge") {
      const line = [...photo.edges[drag.side]] as PhotoCalibration["edges"]["left"];
      line[drag.end] = p;
      onChange({ ...photo, edges: { ...photo.edges, [drag.side]: line } });
    } else {
      const along = [...photo.along] as PhotoCalibration["along"];
      along[drag.index] = { ...along[drag.index], ...p };
      onChange({ ...photo, along });
    }
  };
  const start = (h: Handle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag(h);
  };
  const px = (q: { x: number; y: number }) => ({ x: q.x * size.width, y: q.y * size.height });
  const r = Math.max(size.width, size.height) / 120;

  return (
    <div className="photo-frame photo-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.width} ${size.height}`}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        role="application"
        aria-label={`Calibration of ${photo.file}`}
      >
        {turned && <image href={turned} width={size.width} height={size.height} />}
        {grid.map((l, i) => (
          <polyline
            key={i}
            points={l.pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={GRID_COLORS[l.kind]}
            strokeWidth={l.kind === "u" || l.kind === "s" ? r / 6 : r / 3}
          />
        ))}
        {(["left", "right"] as const).map((side) => {
          const [a, b] = photo.edges[side].map(px) as [{ x: number; y: number }, { x: number; y: number }];
          return (
            <g key={side} className="edge">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff9800" strokeWidth={r / 3} />
              {[a, b].map((p, end) => (
                <circle
                  key={end}
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  className="handle"
                  fill="rgba(255, 152, 0, 0.5)"
                  stroke="#ff9800"
                  strokeWidth={r / 4}
                  onPointerDown={start({ kind: "edge", side, end: end as 0 | 1 })}
                >
                  <title>{`${side} edge`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {photo.along.map((m, index) => {
          const p = px(m);
          return (
            <g key={index}>
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                className="handle"
                fill="rgba(229, 57, 53, 0.4)"
                stroke="#e53935"
                strokeWidth={r / 4}
                onPointerDown={start({ kind: "along", index: index as 0 | 1 })}
              />
              <text
                x={p.x + r * 1.4}
                y={p.y + r / 2}
                fontSize={r * 2}
                fill="#fff"
                stroke="#000"
                strokeWidth={r / 6}
              >
                {m.cm} cm
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type NumberProps = { value: number; step: number; min?: number; max?: number; onChange: (v: number) => void };

function NumberInput({ value, step, min, max, onChange, label }: NumberProps & { label?: string }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      aria-label={label}
      onChange={(e) => {
        const s = e.target.value;
        const v = Number(s);
        if (s !== "" && Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

/** One labelled row: a short label (the long explanation is its tooltip), an optional slider, a number. */
function NumberField(props: NumberProps & { label: string; title?: string; slider?: boolean }) {
  const { label, title, slider, ...num } = props;
  return (
    <label title={title}>
      <span className="field-label">{label}</span>
      <span className="number-field">
        {slider && (
          <input
            type="range"
            value={num.value}
            step={num.step}
            min={num.min}
            max={num.max}
            onChange={(e) => num.onChange(Number(e.target.value))}
          />
        )}
        <NumberInput {...num} />
      </span>
    </label>
  );
}

/** A from–to pair on one row (patch u and v ranges). */
function RangeField(props: { label: string; title?: string; from: NumberProps; to: NumberProps }) {
  const { label, title, from, to } = props;
  return (
    <div className="props-row" title={title}>
      <span className="field-label">{label}</span>
      <span className="number-pair">
        <NumberInput {...from} label={`${label} from`} />
        <span className="faint">to</span>
        <NumberInput {...to} label={`${label} to`} />
      </span>
    </div>
  );
}

function PhotoFields({
  photo,
  onChange,
}: {
  photo: PhotoCalibration;
  onChange: (p: PhotoCalibration) => void;
}) {
  return (
    <div className="props">
      <NumberField
        label="View at wrist"
        title="u facing the camera at the wrist"
        value={photo.u_view.wrist}
        step={0.005}
        min={0}
        max={1}
        slider
        onChange={(wrist) => onChange({ ...photo, u_view: { ...photo.u_view, wrist } })}
      />
      <NumberField
        label="View at elbow"
        title="u facing the camera at the elbow"
        value={photo.u_view.elbow}
        step={0.005}
        min={0}
        max={1}
        slider
        onChange={(elbow) => onChange({ ...photo, u_view: { ...photo.u_view, elbow } })}
      />
      {photo.along.map((m, i) => (
        <NumberField
          key={i}
          label={`Mark ${i + 1} (cm)`}
          title={`Red mark ${i + 1}: its distance from the wrist crease in cm`}
          value={m.cm}
          step={0.25}
          onChange={(cm) =>
            onChange({
              ...photo,
              along: photo.along.map((q, k) => (k === i ? { ...q, cm } : q)) as PhotoCalibration["along"],
            })
          }
        />
      ))}
      <NumberField
        label="Weight"
        title="How much this photo counts where photos overlap"
        value={photo.weight}
        step={0.1}
        min={0}
        onChange={(weight) => onChange({ ...photo, weight })}
      />
      <label>
        <span className="field-label">Turn</span>
        <select
          value={photo.turn}
          onChange={(e) => onChange({ ...photo, turn: Number(e.target.value) as PhotoCalibration["turn"] })}
        >
          {[0, 90, 180, 270].map((d) => (
            <option key={d} value={d}>
              {d}° clockwise
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        View: the u facing the camera; 0.25 lateral (thumb side), 0.5 inner, 0.75 medial. Seen from the inner
        side, lateral is on the right. Marks: cm from the wrist crease.
      </p>
    </div>
  );
}

function PatchFields({
  cal,
  onChange,
}: {
  cal: ProjectionCalibration;
  onChange: (c: ProjectionCalibration) => void;
}) {
  const patch = (p: Partial<ProjectionCalibration["patch"]>) =>
    onChange({ ...cal, patch: { ...cal.patch, ...p } });
  const blend = (b: Partial<ProjectionCalibration["blend"]>) =>
    onChange({ ...cal, blend: { ...cal.blend, ...b } });
  return (
    <div className="props">
      <RangeField
        label="u range"
        title="Around the arm: where the patch starts and ends (0.5 = inner centre line)"
        from={{ value: cal.patch.u[0], step: 0.01, onChange: (u) => patch({ u: [u, cal.patch.u[1]] }) }}
        to={{ value: cal.patch.u[1], step: 0.01, onChange: (u) => patch({ u: [cal.patch.u[0], u] }) }}
      />
      <RangeField
        label="v range"
        title="Along the arm: where the patch starts and ends (0 = wrist, 1 = shoulder)"
        from={{
          value: cal.patch.v[0],
          step: 0.005,
          min: 0,
          max: 1,
          onChange: (v) => patch({ v: [v, cal.patch.v[1]] }),
        }}
        to={{
          value: cal.patch.v[1],
          step: 0.005,
          min: 0,
          max: 1,
          onChange: (v) => patch({ v: [cal.patch.v[0], v] }),
        }}
      />
      <NumberField
        label="px per cm"
        title="Resolution of the saved patch"
        value={cal.patch.px_per_cm}
        step={1}
        min={2}
        max={60}
        onChange={(px_per_cm) => patch({ px_per_cm })}
      />
      <NumberField
        label="Blend exponent"
        title="How sharply overlapping photos hand over to each other"
        value={cal.blend.exponent}
        step={0.5}
        min={0}
        max={32}
        slider
        onChange={(exponent) => blend({ exponent })}
      />
      <NumberField
        label="Skin level"
        title="Brightness treated as bare skin"
        value={cal.blend.skin_level}
        step={0.01}
        min={0.5}
        max={1}
        slider
        onChange={(skin_level) => blend({ skin_level })}
      />
      <NumberField
        label="Ink threshold"
        title="Footprint ink threshold: how dark a pixel must be to count as tattoo"
        value={cal.blend.ink_threshold}
        step={0.005}
        min={0}
        max={0.5}
        onChange={(ink_threshold) => blend({ ink_threshold })}
      />
      <p className="muted small">
        The preview is built at {PREVIEW_PX_PER_CM} px per cm; the planner uses the saved value.
      </p>
    </div>
  );
}
