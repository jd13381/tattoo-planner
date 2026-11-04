// Projection tab (docs/adr/0006): calibrate how the photos of an existing tattoo map onto the arm and
// preview the combined patch on the unwrap and the 3D arm. Save writes config/projections/<name>.yaml.
// The maths lives in model.ts and patch.ts; this file only draws and edits numbers.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ArmProfile } from "../arm/profile.ts";
import type { AssetInfo } from "../assets/types.ts";
import { requestImage, useAssetImages, useAssetListing } from "../assets/useAssets.ts";
import type { Layout } from "../layout/schema.ts";
import type { AssetImage } from "../render/reference.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { ArmViewer } from "../viewer/ArmViewer.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { modelGrid, photoFrame, turnedSize, type GridLine } from "./model.ts";
import type { ProjectedPatch } from "./patch.ts";
import type { PhotoCalibration, ProjectionCalibration } from "./schema.ts";
import { projectionSchema } from "./schema.ts";
import { patchFor, photoAssets, saveProjection, useProjections } from "./useProjections.ts";

/** Preview resolution: coarse enough to rebuild while dragging, fine enough to judge seams. */
const PREVIEW_PX_PER_CM = 10;
const TEXTURE_PX_PER_CM = 12;
const PREVIEW_ID = "projection-preview";

export function ProjectionPage({ arm, pose }: { arm: ArmState; pose: Pose }) {
  const { files, calibrations, errors, loadError } = useProjections();
  const [name, setName] = useState<string | null>(null);
  if (loadError) return <p className="card notice error">{loadError}</p>;
  if (files === null) return <p className="muted">Loading projections…</p>;
  const names = files.map((f) => f.name);
  if (names.length === 0)
    return (
      <p className="card notice warn">
        No projections in <code>config/projections/</code> yet (docs/adr/0006-anubis-projection.md).
      </p>
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
        <p className="card notice error">
          {current}.yaml is invalid: {errors.get(current)}
        </p>
      </div>
    );
  return <ProjectionEditor key={current} saved={saved} picker={picker} profile={arm.profile} pose={pose} />;
}

function ProjectionEditor(props: {
  saved: ProjectionCalibration;
  picker: React.ReactNode;
  profile: ArmProfile;
  pose: Pose;
}) {
  const { saved, picker, profile, pose } = props;
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
  const [saveState, setSaveState] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== savedJson;
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

  const photo = draft?.photos[Math.min(photoIndex, (draft?.photos.length ?? 1) - 1)];
  const info = infos[photoIndex] ?? null;
  const setPhoto = (p: PhotoCalibration) =>
    setDraft((d) => (d ? { ...d, photos: d.photos.map((q, i) => (i === photoIndex ? p : q)) } : d));

  const save = async () => {
    setSaveState("Saving…");
    try {
      await saveProjection(draft);
      setSaveState(`Saved config/projections/${draft.name}.yaml`);
    } catch (e) {
      setSaveState(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="projection-page">
      <div className="layout-toolbar toolbar">
        {picker}
        <button type="button" disabled={!dirty || !!validationError} onClick={save}>
          Save
        </button>
        <button type="button" disabled={!dirty} onClick={() => setDraft(structuredClone(saved))}>
          Revert
        </button>
        {saveState && <span className="muted small">{saveState}</span>}
      </div>
      {validationError && <p className="card notice error">Not saved: {validationError}</p>}
      {!assetMap && (
        <p className="card notice warn">
          No data folder: the photos cannot be shown. Set TATTOO_DATA_DIR (README) and restart npm run dev.
        </p>
      )}
      {preview?.status === "unavailable" && assetMap && (
        <p className="card notice warn">Cannot build the patch: {preview.reason}.</p>
      )}
      {preview?.status === "ready" && preview.missing.length > 0 && (
        <p className="card notice warn">Built without {preview.missing.join("; ")}.</p>
      )}
      {draft && photo && (
        <div className="projection-grid">
          <section className="projection-photo">
            <div className="segmented" role="tablist" aria-label="Photos">
              {draft.photos.map((p, i) => (
                <button
                  key={p.file}
                  type="button"
                  className={i === photoIndex ? "active" : ""}
                  onClick={() => setPhotoIndex(i)}
                  title={p.file}
                >
                  {p.file.split("/").pop()}
                  {patch ? ` · ${Math.round((patch.share[i] ?? 0) * 100)} %` : ""}
                </button>
              ))}
            </div>
            <PhotoEditor
              photo={photo}
              info={info}
              image={info ? images.get(info.id) : undefined}
              profile={profile}
              onChange={setPhoto}
            />
            <PhotoFields photo={photo} onChange={setPhoto} />
          </section>
          <section className="projection-preview">
            <h2 className="small">Combined patch, inner side centred</h2>
            <CanvasHost canvas={innerImage} />
            <PatchFields cal={draft} onChange={setDraft} />
          </section>
          <section className="viewer-col">
            <ArmViewer
              profile={profile}
              canvas={texture}
              version={0}
              bendDeg={pose.bendDeg}
              onBendDeg={pose.setBendDeg}
              hint="The combined patch alone, in reference mode."
            />
          </section>
        </div>
      )}
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
  info: AssetInfo | null;
  image: AssetImage | undefined;
  profile: ArmProfile;
  onChange: (p: PhotoCalibration) => void;
}) {
  const { photo, info, image, profile, onChange } = props;
  const ready = image?.status === "ready" ? image : null;
  const size = ready ? turnedSize(ready.width, ready.height, photo.turn) : { width: 3, height: 4 };
  const turned = useMemo(() => {
    if (!ready) return null;
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
    () => (ready ? photoFrame(photo, size.width, size.height, profile.elbowAt) : null),
    [ready, photo, size.width, size.height, profile.elbowAt],
  );
  const grid = useMemo(
    () => (frame ? modelGrid(frame, profile, { sMax: profile.elbowAt + 2 }) : []),
    [frame, profile],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);

  if (!info)
    return <p className="card notice warn">{photo.file} is not in manifest.yaml (npm run assets:scan).</p>;
  if (!info.exists) return <p className="card notice warn">{photo.file} is missing in the data folder.</p>;
  if (!ready)
    return <p className="muted">{image?.status === "error" ? image.message : `Loading ${photo.file}…`}</p>;

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
    <div className="photo-editor">
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
      <p className="muted small">
        Drag the orange edge ends onto the forearm's outline and the red marks onto points whose distance from
        the wrist crease you know. Red line: inner centre line, green: lateral and medial, magenta: every 10
        cm from the wrist crease.
      </p>
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  slider?: boolean;
  onChange: (v: number) => void;
}) {
  const { label, value, step, min, max, slider, onChange } = props;
  const set = (s: string) => {
    const v = Number(s);
    if (s !== "" && Number.isFinite(v)) onChange(v);
  };
  return (
    <label>
      {label}{" "}
      <span className="number-field">
        {slider && (
          <input
            type="range"
            value={value}
            step={step}
            min={min}
            max={max}
            onChange={(e) => set(e.target.value)}
          />
        )}
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => set(e.target.value)}
        />
      </span>
    </label>
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
        label="u facing the camera at the wrist"
        value={photo.u_view.wrist}
        step={0.005}
        min={0}
        max={1}
        slider
        onChange={(wrist) => onChange({ ...photo, u_view: { ...photo.u_view, wrist } })}
      />
      <NumberField
        label="… at the elbow"
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
          label={`mark ${i + 1}, cm from the wrist crease`}
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
        label="weight"
        value={photo.weight}
        step={0.1}
        min={0}
        onChange={(weight) => onChange({ ...photo, weight })}
      />
      <label>
        turn{" "}
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
        u: 0.25 lateral (thumb side), 0.5 inner, 0.75 medial. Seen from the inner side, lateral is on the
        right.
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
      <NumberField
        label="u from"
        value={cal.patch.u[0]}
        step={0.01}
        onChange={(u) => patch({ u: [u, cal.patch.u[1]] })}
      />
      <NumberField
        label="u to"
        value={cal.patch.u[1]}
        step={0.01}
        onChange={(u) => patch({ u: [cal.patch.u[0], u] })}
      />
      <NumberField
        label="v from"
        value={cal.patch.v[0]}
        step={0.005}
        min={0}
        max={1}
        onChange={(v) => patch({ v: [v, cal.patch.v[1]] })}
      />
      <NumberField
        label="v to"
        value={cal.patch.v[1]}
        step={0.005}
        min={0}
        max={1}
        onChange={(v) => patch({ v: [cal.patch.v[0], v] })}
      />
      <NumberField
        label="px per cm (saved patch)"
        value={cal.patch.px_per_cm}
        step={1}
        min={2}
        max={60}
        onChange={(px_per_cm) => patch({ px_per_cm })}
      />
      <NumberField
        label="blend exponent"
        value={cal.blend.exponent}
        step={0.5}
        min={0}
        max={32}
        slider
        onChange={(exponent) => blend({ exponent })}
      />
      <NumberField
        label="skin level"
        value={cal.blend.skin_level}
        step={0.01}
        min={0.5}
        max={1}
        slider
        onChange={(skin_level) => blend({ skin_level })}
      />
      <NumberField
        label="footprint ink threshold"
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
