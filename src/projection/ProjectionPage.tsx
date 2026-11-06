// Advanced projection page (docs/adr/0006, docs/adr/0014): every number of a calibration, for fine-tuning
// what the guided wizard set up. Calibrate how the photos of an existing tattoo map onto its body region
// and preview the combined patch on the unwrap and in 3D. Save writes the projection's YAML file.
// The maths lives in model.ts and patch.ts; this file only draws and edits numbers.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { RegionProfile } from "../body/profile.ts";
import { REGIONS, type RegionId } from "../body/regions.ts";
import { requestImage, useAssetImages, useAssetListing } from "../assets/useAssets.ts";
import { formatKeys } from "../editor/shortcuts.ts";
import { currentPlatform } from "../editor/useLayoutShortcuts.ts";
import type { AssetImage } from "../render/reference.ts";
import { WarnIcon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { ToastRegion, useToast } from "../ui/Toast.tsx";
import { useEscape } from "../ui/useEscape.ts";
import { ArmViewer, ORBIT_HINT, PoseControl } from "../viewer/ArmViewer.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import type { GridLine } from "./model.ts";
import { CanvasHost, EDGE_COLOR, GRID_COLORS, PhotoEditor, PhotoPlaceholder } from "./PhotoEditor.tsx";
import { photoStatus, type ListingState, type PhotoStatus } from "./photoStatus.ts";
import type { PhotoCalibration, ProjectionCalibration } from "./schema.ts";
import { projectionRegion, projectionSchema } from "./schema.ts";
import { farLabel, startLabel } from "./wizard.ts";
import { patchFor, photoAssets, saveProjection, useProjections } from "./useProjections.ts";
import { previewCanvases } from "./preview.ts";

/** Preview resolution: coarse enough to rebuild while dragging, fine enough to judge seams. */
const PREVIEW_PX_PER_CM = 10;
const TEXTURE_PX_PER_CM = 12;

function photoHint(region: RegionId): string {
  const lines = REGIONS[region].lines;
  const start = startLabel(region);
  return (
    "Drag the orange edge ends onto the outline of the body part and the red marks onto points whose " +
    `distance from the ${start} you know. Red line: ${lines[2]} centre line, green: ${lines[1]} and ` +
    `${lines[3]}, yellow: every 2 cm, magenta: every 10 cm from the ${start}.`
  );
}
const VIEW_HINT = `${ORBIT_HINT} Shows the combined patch alone, in reference mode.`;

export function ProjectionPage({
  arm,
  pose,
  onDirty,
  initialName,
  onBack,
}: {
  arm: ArmState;
  pose: Pose;
  /** Reports unsaved edits, so the app can warn before a reload. */
  onDirty?: (dirty: boolean) => void;
  /** The projection to open first. */
  initialName?: string;
  /** Back to the list of existing tattoos. */
  onBack?: () => void;
}) {
  const { files, calibrations, errors, loadError } = useProjections();
  const [name, setName] = useState<string | null>(initialName ?? null);
  // Back to the list (button or Esc), like the wizard's Cancel: unsaved edits ask first.
  const [editorDirty, setEditorDirty] = useState(false);
  const reportDirty = useCallback(
    (d: boolean) => {
      setEditorDirty(d);
      onDirty?.(d);
    },
    [onDirty],
  );
  const goBack = () => {
    if (!onBack) return;
    if (editorDirty && !window.confirm("Leave without saving? The changes to this projection are lost."))
      return;
    onBack();
  };
  useEscape(goBack, !!onBack);
  const back = onBack && (
    <button
      type="button"
      className="ghost"
      onClick={goBack}
      aria-keyshortcuts="Escape"
      title={
        editorDirty
          ? "Back to the list of existing tattoos without saving (Esc)"
          : "Back to the list of existing tattoos (Esc)"
      }
    >
      ‹ Existing tattoos
    </button>
  );
  if (loadError)
    return (
      <div className="projection-page">
        <div className="projection-message">
          <p className="notice error" role="alert">
            {loadError}
          </p>
        </div>
      </div>
    );
  if (files === null)
    return (
      <div className="projection-page">
        <p className="projection-message muted">Loading projections…</p>
      </div>
    );
  const names = files.map((f) => f.name);
  if (names.length === 0)
    return (
      <div className="projection-page">
        <section className="empty">
          <h2>No existing tattoos yet</h2>
          <p>Add one from its photos with the guided setup first; this page then fine-tunes it.</p>
          {back}
        </section>
      </div>
    );
  const current = name && names.includes(name) ? name : names[0]!;
  const saved = calibrations.get(current) ?? null;
  const picker = (dirty: boolean) => (
    <span className="select-wrap" title={dirty ? "Unsaved edits" : undefined}>
      <select
        className="variant-select"
        aria-label="Projection"
        value={current}
        onChange={(e) => setName(e.target.value)}
      >
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
            {errors.has(n) ? " (invalid)" : ""}
          </option>
        ))}
      </select>
      {dirty && <span className="dirty-dot" role="img" aria-label="unsaved changes" />}
    </span>
  );
  if (!saved)
    return (
      <div className="projection-page">
        <TopBar
          start={
            <>
              {back}
              {picker(false)}
            </>
          }
        />
        <div className="projection-message">
          <p className="notice error" role="alert">
            <strong>{current}.yaml is invalid:</strong> {errors.get(current)}
          </p>
        </div>
      </div>
    );
  return (
    <ProjectionEditor
      key={current}
      saved={saved}
      picker={picker}
      back={back}
      profile={arm.region(projectionRegion(saved))}
      pose={pose}
      onDirty={reportDirty}
    />
  );
}

/** The page's own bar above the workspace: back to the list and the picker at the start, notices and
 * the actions at the end. */
function TopBar({
  start,
  notices,
  children,
}: {
  start: ReactNode;
  notices?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="toolbar projection-topbar">
      {start}
      <span className="spacer" />
      {notices}
      {children}
    </div>
  );
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; message: string };

function ProjectionEditor(props: {
  saved: ProjectionCalibration;
  picker: (dirty: boolean) => ReactNode;
  back?: ReactNode;
  profile: RegionProfile;
  pose: Pose;
  onDirty?: (dirty: boolean) => void;
}) {
  const { saved, picker, back, profile, pose, onDirty } = props;
  const current = saved.name;
  const region = projectionRegion(saved);
  const { listing } = useAssetListing();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((a) => [a.id, a])) : null),
    [listing],
  );
  const { images, version: imagesVersion } = useAssetImages();
  const [draft, setDraft] = useState<ProjectionCalibration>(() => structuredClone(saved));
  const savedJson = JSON.stringify(saved);
  const [photoIndex, setPhotoIndex] = useState(0);
  // A failure stays as a notice until the next save; success is a short toast.
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const toast = useToast();
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
  const [du0, du1] = draft.patch.u;
  const draftU = useMemo(() => [du0, du1] as const, [du0, du1]);

  const { texture, innerImage } = useMemo(
    () =>
      previewCanvases({
        name: current,
        patch,
        profile,
        assets: assetMap,
        images,
        v1: draftV1,
        centerU: (draftU[0] + draftU[1]) / 2,
        pxPerCm: TEXTURE_PX_PER_CM,
      }),
    [patch, current, assetMap, images, profile, draftV1, draftU],
  );

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
      setSaveState({ kind: "idle" });
      toast.show(`Saved ${draft.name}`);
    } catch (e) {
      setSaveState({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };
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
  const [platform] = useState(currentPlatform);
  const kbdSave = formatKeys("Mod+S", platform);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [viewBar, setViewBar] = useState<HTMLDivElement | null>(null);
  const share = patch?.share ?? null;

  const noticesChip = patchNotice && (
    <span className="popover-anchor">
      <button
        type="button"
        className="chip warn"
        aria-expanded={noticesOpen}
        aria-haspopup="dialog"
        onClick={() => setNoticesOpen((o) => !o)}
      >
        <WarnIcon />1 notice
      </button>
      <Popover
        open={noticesOpen}
        onClose={() => setNoticesOpen(false)}
        label="Notices"
        align="end"
        className="notices-popover"
      >
        <p className="popover-title">Notices</p>
        <ul className="notice-list">
          <li>
            {patchNotice.text} The photo tabs say why.
            {patchNotice.detail && <span className="notice-detail">{patchNotice.detail}</span>}
          </li>
        </ul>
      </Popover>
    </span>
  );

  return (
    <div className="projection-page">
      <TopBar
        notices={noticesChip}
        start={
          <>
            {back}
            {picker(dirty)}
          </>
        }
      >
        <button
          type="button"
          className="ghost"
          disabled={!dirty}
          onClick={() => setDraft(structuredClone(saved))}
          title={dirty ? "Discard the unsaved changes" : "No unsaved changes"}
        >
          Revert
        </button>
        <button
          type="button"
          className={dirty ? "primary" : ""}
          disabled={!canSave}
          onClick={() => void save()}
          aria-keyshortcuts={platform === "mac" ? "Meta+S" : "Control+S"}
          title={
            validationError
              ? `Fix first: ${validationError}`
              : dirty
                ? `Save ${current} (${kbdSave})`
                : "No unsaved changes"
          }
        >
          {saveState.kind === "saving" ? "Saving…" : "Save"} <kbd className="kbd">{kbdSave}</kbd>
        </button>
      </TopBar>
      {(validationError || saveState.kind === "failed") && (
        <div className="notices projection-errors">
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
        </div>
      )}
      {photo && status && (
        <div className="projection-workspace">
          <section className="proj-photo" aria-label="Photo calibration">
            <div
              className="proj-stage"
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
            <div className="float float-bar proj-photo-bar">
              <PhotoTabs photos={draft.photos} index={photoIndex} share={share} onSelect={setPhotoIndex} />
            </div>
            <div className="float status-bar proj-status" title={photoHint(region)}>
              <GridLegend region={region} />
              <span className="spacer" />
              <PhotoMeta status={status} image={image} turn={photo.turn} />
            </div>
          </section>
          <section className="proj-views" aria-label="Preview">
            <div className="proj-3d">
              <ArmViewer
                profile={profile}
                canvas={texture}
                version={0}
                bendDeg={pose.bendDeg}
                viewSides
                toolbarTarget={viewBar}
                screenshotInToolbar
                footer={false}
              />
              <div className="float float-bar proj-3d-bar" title={VIEW_HINT}>
                <div ref={setViewBar} className="viewer-tools" />
              </div>
              <div className="float float-bar proj-pose-bar">
                <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} />
              </div>
            </div>
            <figure className="proj-patch">
              <CanvasHost canvas={innerImage} />
              <figcaption className="float float-bar proj-patch-label">
                <span className="float-title">Combined patch</span>
                <span className="faint">centred on the patch</span>
              </figcaption>
            </figure>
          </section>
          <aside className="proj-inspector" aria-label="Calibration">
            <section className="insp-section" aria-labelledby="proj-photo-head">
              <div className="insp-head">
                <h2 className="float-title" id="proj-photo-head">
                  This photo
                </h2>
                <span className="spacer" />
                <span className="mono photo-name" title={photo.file}>
                  {photo.file.split("/").pop()}
                </span>
              </div>
              <fieldset disabled={!photoReady}>
                <PhotoFields photo={photo} region={region} onChange={setPhoto} />
              </fieldset>
            </section>
            <section className="insp-section" aria-labelledby="proj-patch-head">
              <div className="insp-head">
                <h2 className="float-title" id="proj-patch-head">
                  Patch (all photos)
                </h2>
                <span className="spacer" />
                {share && (
                  <span className="faint xs" title="Photos that supply part of the patch">
                    <span className="mono">{share.filter((x) => x > 0).length}</span> of{" "}
                    <span className="mono">{photoCount}</span> photos
                  </span>
                )}
              </div>
              <fieldset disabled={noData}>
                <PatchFields cal={draft} region={region} onChange={setDraft} />
              </fieldset>
            </section>
            <section className="insp-section" aria-labelledby="proj-share-head">
              <div className="insp-head">
                <h2 className="float-title" id="proj-share-head">
                  Share of the patch
                </h2>
              </div>
              <PhotoShares photos={draft.photos} index={photoIndex} share={share} onSelect={setPhotoIndex} />
            </section>
          </aside>
        </div>
      )}
      <ToastRegion toast={toast} />
    </div>
  );
}

/** Each photo's share of the patch as a bar, with its weight; a row selects that photo. */
function PhotoShares(props: {
  photos: PhotoCalibration[];
  index: number;
  share: number[] | null;
  onSelect: (i: number) => void;
}) {
  const { photos, index, share, onSelect } = props;
  if (!share) return <p className="faint xs share-empty">Shown once the patch is built from the photos.</p>;
  return (
    <ul className="share-list">
      {photos.map((p, i) => {
        const pct = Math.round((share[i] ?? 0) * 100);
        return (
          <li key={p.file}>
            <button
              type="button"
              className={`share-row${i === index ? " active" : ""}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => onSelect(i)}
              title={`${p.file}: ${pct} % of the patch, weight ${p.weight}`}
            >
              <span className="share-name">{photoLabel(p.file)}</span>
              <span className="share-bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="mono share-pct">{pct}%</span>
              <span className="mono faint share-weight">×{p.weight}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Colour key of the grid drawn on the photo (the full explanation is the status bar's tooltip). */
function GridLegend({ region }: { region: RegionId }) {
  const short = REGIONS[region].short;
  const items: { kind: GridLine["kind"] | "edge"; label: string }[] = [
    { kind: "inner", label: REGIONS[region].lines[2] },
    { kind: "side", label: `${short[1]} / ${short[3]}` },
    { kind: "s10", label: "10 cm" },
    { kind: "s", label: "2 cm" },
    { kind: "edge", label: "outline" },
  ];
  return (
    <span className="grid-legend" aria-label="Grid colours">
      {items.map((it) => (
        <span key={it.kind} className="legend-item">
          <span
            className="legend-swatch"
            style={{ background: it.kind === "edge" ? EDGE_COLOR : GRID_COLORS[it.kind] }}
            aria-hidden="true"
          />
          {it.label}
        </span>
      ))}
    </span>
  );
}

/** Right end of the photo status bar: the photo's size and turn, or why it is not shown. */
function PhotoMeta(props: { status: PhotoStatus; image: AssetImage | undefined; turn: number }) {
  const { status, image, turn } = props;
  if (status.kind !== "ready") return <span className={`photo-state ${status.kind}`}>{status.title}</span>;
  return (
    <>
      {image?.status === "ready" && (
        <span className="mono" title="Photo size in pixels">
          {image.width} × {image.height}
        </span>
      )}
      <span className="mono" title="Turned clockwise before calibration">
        {turn}°
      </span>
    </>
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
    <div className="photo-tabs segmented" role="tablist" aria-label="Photos">
      {photos.map((p, i) => (
        <button
          key={p.file}
          id={`projection-photo-tab-${i}`}
          type="button"
          role="tab"
          aria-selected={i === index}
          className={i === index ? "active" : ""}
          aria-controls="projection-photo-panel"
          tabIndex={i === index ? 0 : -1}
          onClick={() => onSelect(i)}
          onKeyDown={onKey}
          title={p.file}
        >
          <span className="photo-tab-name">{photoLabel(p.file)}</span>
          {share && <span className="share mono">{Math.round((share[i] ?? 0) * 100)}%</span>}
        </button>
      ))}
    </div>
  );
}

/** A photo's file name without folder and extension (the tab's tooltip has the full path). */
function photoLabel(file: string): string {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.[a-z0-9]+$/i, "");
}

/** Stands in for the photo while it cannot be shown, and says why. */
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
  region,
  onChange,
}: {
  photo: PhotoCalibration;
  region: RegionId;
  onChange: (p: PhotoCalibration) => void;
}) {
  const start = startLabel(region);
  const far = farLabel(region);
  const startShort = REGIONS[region].ends[0];
  const lines = REGIONS[region].lines;
  return (
    <div className="props">
      <NumberField
        label={`View at ${startShort}`}
        title={`u facing the camera at the ${start}`}
        value={photo.u_view.wrist}
        step={0.005}
        min={0}
        max={1}
        slider
        onChange={(wrist) => onChange({ ...photo, u_view: { ...photo.u_view, wrist } })}
      />
      <NumberField
        label={`View at ${far}`}
        title={`u facing the camera at the ${far}`}
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
          title={`Red mark ${i + 1}: its distance from the ${start} in cm`}
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
        View: the u facing the camera; 0 {lines[0]}, 0.25 {lines[1]}, 0.5 {lines[2]}, 0.75 {lines[3]}. Marks:
        cm from the {start}.
      </p>
    </div>
  );
}

function PatchFields({
  cal,
  region,
  onChange,
}: {
  cal: ProjectionCalibration;
  region: RegionId;
  onChange: (c: ProjectionCalibration) => void;
}) {
  const def = REGIONS[region];
  const patch = (p: Partial<ProjectionCalibration["patch"]>) =>
    onChange({ ...cal, patch: { ...cal.patch, ...p } });
  const blend = (b: Partial<ProjectionCalibration["blend"]>) =>
    onChange({ ...cal, blend: { ...cal.blend, ...b } });
  return (
    <div className="props">
      <RangeField
        label="u range"
        title={`Around the body part: where the patch starts and ends (0.5 = ${def.lines[2]} centre line)`}
        from={{ value: cal.patch.u[0], step: 0.01, onChange: (u) => patch({ u: [u, cal.patch.u[1]] }) }}
        to={{ value: cal.patch.u[1], step: 0.01, onChange: (u) => patch({ u: [cal.patch.u[0], u] }) }}
      />
      <RangeField
        label="v range"
        title={`Along the body part: where the patch starts and ends (0 = ${def.ends[0]}, 1 = ${def.ends[1]})`}
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
