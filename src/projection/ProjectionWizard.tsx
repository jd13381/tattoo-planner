// The guided projection wizard (docs/adr/0014-guided-projection.md): brings an existing tattoo onto a body
// region from one or more photos, one question per step, with the model's skin grid on the photo as
// live feedback. The state and every rule live in wizard.ts and layoutLink.ts; this file only draws.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fileKey } from "../assets/manifestDoc.ts";
import { assetImageUrl, type AssetInfo } from "../assets/types.ts";
import { requestImage, useAssetImages, useAssetListing } from "../assets/useAssets.ts";
import type { RegionProfile } from "../body/profile.ts";
import { REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import { parseLayout } from "../layout/yamlDoc.ts";
import { useLayouts, type WorkingLayout } from "../layout/useLayouts.ts";
import type { AssetImage } from "../render/reference.ts";
import { renderUnwrap } from "../render/unwrapCanvas.ts";
import { useEscape } from "../ui/useEscape.ts";
import { ArmViewer } from "../viewer/ArmViewer.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { layoutTarget, linkProjection } from "./layoutLink.ts";
import { turnedSize } from "./model.ts";
import type { ProjectedPatch } from "./patch.ts";
import { CanvasHost, PhotoEditor, PhotoPlaceholder } from "./PhotoEditor.tsx";
import { photoStatus, type ListingState } from "./photoStatus.ts";
import { previewCanvases } from "./preview.ts";
import type { PhotoCalibration, ProjectionCalibration } from "./schema.ts";
import { patchFor, saveProjection, useProjections } from "./useProjections.ts";
import {
  facingOptions,
  farLabel,
  fromCalibration,
  moveStep,
  nearestFacing,
  newDraft,
  slugify,
  startLabel,
  stepIndex,
  stepIssue,
  stepTitle,
  toCalibration,
  toPhotoCalibration,
  turnPhoto,
  withPhotos,
  wizardSteps,
  type PhotoTask,
  type Turn,
  type WizardDraft,
  type WizardPhoto,
  type WizardStep,
} from "./wizard.ts";
import { EdgesArt, FacingThumb, MarksArt, TurnArt } from "./wizardArt.tsx";
import { useCurrentPerson } from "../assets/person.ts";

const PREVIEW_PX_PER_CM = 10;
const TEXTURE_PX_PER_CM = 12;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string }
  | { kind: "saved"; layout: string | null; created: boolean; note: string | null };

type Props = {
  arm: ArmState;
  pose: Pose;
  /** The projection to edit, or null for a new one. */
  editName: string | null;
  openLayout: WorkingLayout | null;
  onDirty?: (dirty: boolean) => void;
  onClose: () => void;
  onAdvanced: (name: string) => void;
  onAnother: () => void;
};

/** What the region is called in running text ("left arm", "torso"). */
const partName = (r: RegionId) => REGIONS[r].label.toLowerCase();
/** The limb or body in running text: "arm", "leg", "body". */
const limbWord = (r: RegionId) => ({ arm: "arm", leg: "leg", torso: "body" })[REGIONS[r].kind];

export function ProjectionWizard(props: Props) {
  const { arm, pose, editName, openLayout, onDirty } = props;
  const { files, calibrations } = useProjections();
  const editing = editName ? (calibrations.get(editName) ?? null) : null;
  const [initial] = useState<WizardDraft>(() => (editing ? fromCalibration(editing) : newDraft()));
  const [draft, setDraft] = useState<WizardDraft>(initial);
  const [step, setStep] = useState<WizardStep>(editing ? { kind: "preview" } : { kind: "name" });
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(draft) !== savedJson;
  useEffect(() => onDirty?.(dirty), [onDirty, dirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);

  const profile = arm.region(draft.region);
  const { listing, reload: scanAssets, scanNote } = useAssetListing();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((a) => [a.id, a])) : null),
    [listing],
  );
  const byFile = useMemo(
    () => new Map([...(assetMap?.values() ?? [])].map((a) => [fileKey(a.file), a])),
    [assetMap],
  );
  const { images, version: imagesVersion } = useAssetImages();
  useEffect(() => {
    for (const p of draft.photos) {
      const info = byFile.get(fileKey(p.file));
      if (info?.exists) requestImage(info.id);
    }
  }, [draft.photos, byFile]);
  const readyImage = (file: string) => {
    const info = byFile.get(fileKey(file));
    const img = info ? images.get(info.id) : undefined;
    return img?.status === "ready" ? img : null;
  };
  const sizeOf = (file: string, turn: Turn) => {
    const img = readyImage(file);
    return img ? turnedSize(img.width, img.height, turn) : null;
  };

  const taken = useMemo(() => (files ?? []).map((f) => f.name), [files]);
  const ctx = { taken, sizeOf, profile };
  const steps = wizardSteps(draft);
  const index = stepIndex(draft, step);
  const current = steps[index]!;
  const issue = stepIssue(draft, current, ctx);
  // A step can be opened from the step list once every step before it is answered.
  const firstOpen = steps.findIndex((s) => stepIssue(draft, s, ctx) !== null);
  const reachable = (i: number) => firstOpen < 0 || i <= firstOpen;

  const setPhoto = (i: number, p: WizardPhoto) =>
    setDraft((d) => ({ ...d, photos: d.photos.map((q, k) => (k === i ? p : q)) }));

  // Layouts: where the tattoo goes on save.
  const { files: layoutFiles, save: saveLayout } = useLayouts();
  const regionLayouts = (layoutFiles ?? []).filter((f) => {
    const r = parseLayout(f.text);
    return (r.ok ? (r.layout.region ?? "arm-left") : "arm-left") === draft.region;
  });
  const suggested = layoutFiles
    ? layoutTarget(draft.region, layoutFiles, draft.name || "tattoo", openLayout?.name)
    : null;
  const [layoutChoice, setLayoutChoice] = useState<string | null>(null);
  const targetName =
    layoutChoice && (regionLayouts.some((f) => f.name === layoutChoice) || layoutChoice === suggested?.name)
      ? layoutChoice
      : (suggested?.name ?? null);

  // Preview: the calibration a moment after the last change, built at a coarse resolution.
  const built = useMemo(() => toCalibration(draft, profile), [draft, profile]);
  const [previewCal, setPreviewCal] = useState<ProjectionCalibration | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCal(built.ok ? built.calibration : null), 150);
    return () => clearTimeout(t);
  }, [built]);
  const onPreview = current.kind === "preview";
  const preview = useMemo(() => {
    void imagesVersion;
    if (!previewCal || !onPreview) return null;
    const cal = { ...previewCal, patch: { ...previewCal.patch, px_per_cm: PREVIEW_PX_PER_CM } };
    return patchFor(cal, profile, assetMap, images);
  }, [previewCal, onPreview, profile, assetMap, images, imagesVersion]);
  const patch = preview?.status === "ready" ? preview.patch : null;

  const save = async () => {
    if (!built.ok || saveState.kind === "saving") return;
    const cal = built.calibration;
    setSaveState({ kind: "saving" });
    try {
      await saveProjection(cal);
      let note: string | null = null;
      let layoutName: string | null = targetName;
      let created = false;
      if (layoutName && layoutFiles) {
        const file = layoutFiles.find((f) => f.name === layoutName);
        const parsed = file ? parseLayout(file.text) : null;
        if (openLayout?.name === layoutName && openLayout.dirty) {
          note = `${layoutName} has unsaved edits in the Layout tab, so the tattoo was not added to it. Save or discard them there, then save here again.`;
          layoutName = null;
        } else if (parsed && !parsed.ok) {
          note = `${layoutName} has errors, so the tattoo was not added to it.`;
          layoutName = null;
        } else {
          const link = linkProjection(
            parsed?.ok ? parsed.layout : null,
            { name: layoutName, region: draft.region },
            cal,
            profile,
          );
          created = !file;
          if (link.changed) await saveLayout(link.layout);
        }
      }
      const next: WizardDraft = { ...draft, base: cal, area: { u: cal.patch.u, v: cal.patch.v } };
      setDraft(next);
      setSavedJson(JSON.stringify(next));
      setSaveState({ kind: "saved", layout: layoutName, created, note });
    } catch (e) {
      setSaveState({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const isNew = !draft.base;
  const title = isNew ? "Add existing tattoo" : `Edit ${draft.description || draft.name}`;
  // "Cancel" while leaving would lose something (unsaved answers, or a new tattoo not saved yet),
  // "Close" once everything is saved. Only unsaved answers ask first.
  const unsavedNew = isNew && saveState.kind !== "saved";
  const leave = () => {
    if (dirty && !window.confirm("Leave without saving? The answers so far are lost.")) return;
    props.onClose();
  };
  useEscape(leave);

  return (
    <div className="wizard-page">
      <div className="toolbar wizard-bar">
        <h1 className="wizard-title" title={title}>
          {title}
        </h1>
        <StepRail
          steps={steps}
          index={index}
          reachable={reachable}
          onSelect={(i) => setStep(steps[i]!)}
          draft={draft}
        />
        {!isNew && (
          <button
            type="button"
            className="ghost"
            onClick={() => props.onAdvanced(draft.name)}
            disabled={dirty}
            title={dirty ? "Save first; Advanced opens the saved file" : "Every number of the calibration"}
          >
            Advanced
          </button>
        )}
        <button
          type="button"
          className={dirty || unsavedNew ? "" : "ghost"}
          onClick={leave}
          aria-keyshortcuts="Escape"
          title={
            dirty
              ? "Back to the list of existing tattoos without saving (Esc)"
              : "Back to the list of existing tattoos (Esc)"
          }
        >
          {dirty || unsavedNew ? "Cancel" : "Close"}
        </button>
      </div>
      <div className="wizard-body">
        <section className="wizard-stage" aria-label="Work area">
          <Stage
            step={current}
            draft={draft}
            setDraft={setDraft}
            setPhoto={setPhoto}
            profile={profile}
            pose={pose}
            assets={listing?.status === "ok" ? listing.assets : null}
            listingState={listing === null ? "loading" : listing.status}
            byFile={byFile}
            images={images}
            patch={patch}
            previewCal={previewCal}
            assetMap={assetMap}
          />
        </section>
        <aside className="wizard-panel" aria-label="Step">
          <p className="wizard-count faint xs">
            Step <span className="mono">{index + 1}</span> of <span className="mono">{steps.length}</span>
            {current.kind === "photo" && (
              <>
                {" "}
                · photo <span className="mono">{current.photo + 1}</span> of{" "}
                <span className="mono">{draft.photos.length}</span>
              </>
            )}
          </p>
          <Panel
            step={current}
            draft={draft}
            setDraft={setDraft}
            setPhoto={setPhoto}
            isNew={isNew}
            readyImage={readyImage}
            byFile={byFile}
            scan={{ run: scanAssets, note: scanNote }}
            preview={{
              status: preview?.status ?? null,
              missing: preview?.status === "ready" ? preview.missing : [],
              reason: preview?.status === "unavailable" ? preview.reason : null,
            }}
            layouts={{
              options: regionLayouts.map((f) => f.name),
              suggested,
              target: targetName,
              onChoose: setLayoutChoice,
            }}
          />
          {current.kind === "preview" && (
            <SaveBox
              state={saveState}
              canSave={!issue && saveState.kind !== "saving" && (dirty || isNew)}
              dirty={dirty}
              issue={issue}
              region={draft.region}
              target={targetName}
              onSave={() => void save()}
              onAnother={props.onAnother}
              onClose={props.onClose}
              onAdvanced={() => props.onAdvanced(draft.name)}
            />
          )}
          <div className="wizard-nav">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setStep(moveStep(draft, current, -1))}
            >
              Back
            </button>
            <span className="spacer" />
            {current.kind !== "preview" && (
              <button
                type="button"
                className="primary"
                disabled={!!issue}
                title={issue ?? undefined}
                onClick={() => setStep(moveStep(draft, current, 1))}
              >
                Next
              </button>
            )}
          </div>
          {issue && current.kind !== "preview" && <p className="wizard-issue small">{issue}</p>}
        </aside>
      </div>
    </div>
  );
}

/** The steps as a row: name, photos, one group per photo (its four tasks), check and save. */
function StepRail(props: {
  steps: WizardStep[];
  index: number;
  reachable: (i: number) => boolean;
  onSelect: (i: number) => void;
  draft: WizardDraft;
}) {
  const { steps, index, reachable, onSelect, draft } = props;
  const groups: { label: string; items: { i: number; label: string }[] }[] = [];
  steps.forEach((s, i) => {
    if (s.kind === "photo") {
      const label = `Photo ${s.photo + 1}`;
      let g = groups.at(-1);
      if (!g || g.label !== label) groups.push((g = { label, items: [] }));
      g.items.push({ i, label: stepTitle(s) });
    } else groups.push({ label: stepTitle(s), items: [{ i, label: stepTitle(s) }] });
  });
  return (
    <nav className="wizard-rail" aria-label="Steps">
      <ol>
        {groups.map((g) => {
          const active = g.items.some((it) => it.i === index);
          const file = g.label.startsWith("Photo ")
            ? draft.photos[Number(g.label.slice(6)) - 1]?.file.split("/").pop()
            : undefined;
          return (
            <li key={g.label} className={active ? "active" : undefined}>
              {g.items.length === 1 ? (
                <button
                  type="button"
                  className="rail-step"
                  aria-current={active ? "step" : undefined}
                  disabled={!reachable(g.items[0]!.i)}
                  onClick={() => onSelect(g.items[0]!.i)}
                >
                  {g.label}
                </button>
              ) : (
                <span className="rail-group" title={file}>
                  <span className="rail-group-label">{g.label}</span>
                  {g.items.map((it) => (
                    <button
                      key={it.i}
                      type="button"
                      className="rail-step sub"
                      aria-current={it.i === index ? "step" : undefined}
                      disabled={!reachable(it.i)}
                      onClick={() => onSelect(it.i)}
                    >
                      {it.label}
                    </button>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type ReadyImage = Extract<AssetImage, { status: "ready" }>;

/** The work area: the region in 3D, the photo picker, the photo with its calibration, or the preview. */
function Stage(props: {
  step: WizardStep;
  draft: WizardDraft;
  setDraft: (f: (d: WizardDraft) => WizardDraft) => void;
  setPhoto: (i: number, p: WizardPhoto) => void;
  profile: RegionProfile;
  pose: Pose;
  assets: AssetInfo[] | null;
  listingState: ListingState;
  byFile: ReadonlyMap<string, AssetInfo>;
  images: ReadonlyMap<string, AssetImage>;
  patch: ProjectedPatch | null;
  previewCal: ProjectionCalibration | null;
  assetMap: ReadonlyMap<string, AssetInfo> | null;
}) {
  const { step, draft, profile, pose } = props;
  const regionTexture = useMemo(() => {
    const c = document.createElement("canvas");
    renderUnwrap(c, profile, "grid", null, { pxPerCm: 8, grid: true });
    return c;
  }, [profile]);
  const preview = useMemo(() => {
    if (step.kind !== "preview" || !props.previewCal) return null;
    const cal = props.previewCal;
    return previewCanvases({
      name: cal.name,
      patch: props.patch,
      profile,
      assets: props.assetMap,
      images: props.images,
      v1: Math.min(1, cal.patch.v[1] + 0.03),
      centerU: (cal.patch.u[0] + cal.patch.u[1]) / 2,
      pxPerCm: TEXTURE_PX_PER_CM,
    });
  }, [step.kind, props.previewCal, props.patch, profile, props.assetMap, props.images]);

  switch (step.kind) {
    case "name":
      return (
        <div className="wizard-3d">
          <ArmViewer
            profile={profile}
            canvas={regionTexture}
            version={0}
            bendDeg={pose.bendDeg}
            viewSides
            footer={false}
          />
        </div>
      );
    case "photos":
      return (
        <PhotoPicker
          assets={props.assets}
          listingState={props.listingState}
          picked={draft.photos.map((p) => p.file)}
          onChange={(files) => props.setDraft((d) => withPhotos(d, files))}
        />
      );
    case "photo": {
      const photo = draft.photos[step.photo]!;
      const info = props.byFile.get(fileKey(photo.file)) ?? null;
      const image = info ? props.images.get(info.id) : undefined;
      const status = photoStatus({ file: photo.file, listing: props.listingState, info, image });
      if (status.kind !== "ready" || image?.status !== "ready")
        return (
          <div className="wizard-photo">
            <PhotoPlaceholder
              status={status.kind === "ready" ? { kind: "loading", title: "Loading…" } : status}
              file={photo.file}
            />
          </div>
        );
      const editable = step.task === "edges" ? "edges" : step.task === "marks" ? "marks" : "none";
      const cal = toPhotoCalibration(photo);
      return (
        <div className="wizard-photo">
          <PhotoEditor
            photo={cal}
            image={image}
            profile={profile}
            editable={editable}
            grid={step.task === "marks" || step.task === "facing"}
            handleScale={1.6}
            markLabel={(i, cm) => `${i + 1} · ${cm} cm`}
            onChange={(p: PhotoCalibration) =>
              props.setPhoto(step.photo, { ...photo, edges: p.edges, marks: p.along })
            }
          />
          {(step.task === "marks" || step.task === "facing") && <GridKey region={draft.region} />}
        </div>
      );
    }
    case "preview":
      return (
        <div className="wizard-preview">
          <div className="wizard-3d">
            {preview && (
              <ArmViewer
                profile={profile}
                canvas={preview.texture}
                version={0}
                bendDeg={pose.bendDeg}
                viewSides
                footer={false}
              />
            )}
          </div>
          <figure className="wizard-unwrap">
            {preview && <CanvasHost canvas={preview.innerImage} />}
            <figcaption className="faint xs">The tattoo on the unwrapped skin, centred on it</figcaption>
          </figure>
        </div>
      );
  }
}

/** What the grid lines on the photo mean. */
function GridKey({ region }: { region: RegionId }) {
  const def = REGIONS[region];
  return (
    <p className="wizard-gridkey float xs">
      <span className="legend-swatch" style={{ background: "#e53935" }} aria-hidden="true" /> {def.lines[2]}{" "}
      line
      <span className="legend-swatch" style={{ background: "#43a047" }} aria-hidden="true" /> {def.lines[1]} /{" "}
      {def.lines[3]}
      <span
        className="legend-swatch"
        style={{ background: "rgba(255, 235, 59, 0.8)" }}
        aria-hidden="true"
      />{" "}
      every 2 cm
      <span className="legend-swatch" style={{ background: "#d81b60" }} aria-hidden="true" /> every 10 cm
    </p>
  );
}

/** The catalogued images, photos first; a click picks or unpicks one, the order of picking counts. */
function PhotoPicker(props: {
  assets: AssetInfo[] | null;
  listingState: ListingState;
  picked: string[];
  onChange: (files: string[]) => void;
}) {
  const { assets, listingState, picked, onChange } = props;
  const person = useCurrentPerson();
  const [text, setText] = useState("");
  if (listingState === "loading") return <p className="wizard-message muted">Reading the project folder…</p>;
  if (listingState !== "ok")
    return (
      <div className="wizard-message">
        <p className="muted">
          There is no project folder to take photos from yet.{" "}
          <a href="#settings/project">Set it up in Settings → Project</a>.
        </p>
      </div>
    );
  const visible = (assets ?? []).filter(
    (a) =>
      !a.hidden &&
      // Photos of other persons stay with them (docs/adr/0017-persons.md); the library is shared.
      (a.effectivePerson === null || a.effectivePerson === person.id) &&
      (text === "" || `${a.id} ${a.file} ${a.tags.join(" ")}`.toLowerCase().includes(text.toLowerCase())),
  );
  // The current person's tattoo photos first, then their measuring photos (a new tattoo photo is
  // one until a projection uses it); everything else folded away.
  const mine = (c: string) =>
    visible.filter((a) => a.effectiveCategory === c && a.effectivePerson === person.id);
  const tattoos = mine("existing");
  const measuring = mine("measuring");
  const others = visible.filter((a) => !tattoos.includes(a) && !measuring.includes(a));
  const pickedKeys = picked.map(fileKey);
  const toggle = (a: AssetInfo) => {
    const k = pickedKeys.indexOf(fileKey(a.file));
    onChange(k >= 0 ? picked.filter((_, i) => i !== k) : [...picked, a.file]);
  };
  const grid = (list: AssetInfo[]) => (
    <ul className="asset-grid wizard-grid">
      {list.map((a) => {
        const n = pickedKeys.indexOf(fileKey(a.file));
        return (
          <li key={a.id}>
            <button
              type="button"
              className={`asset-card${n >= 0 ? " current" : ""}${a.exists ? "" : " missing"}`}
              aria-pressed={n >= 0}
              disabled={!a.exists && n < 0}
              title={a.file}
              onClick={() => toggle(a)}
            >
              {a.exists ? (
                <img src={assetImageUrl(a.id)} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="asset-missing">file missing</span>
              )}
              <span className="asset-id">{a.id}</span>
              {n >= 0 && <span className="pick-badge mono">{n + 1}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="wizard-picker">
      <input
        type="search"
        placeholder="Search images"
        aria-label="Search images"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <h3 className="float-title">Tattoo photos</h3>
      {tattoos.length ? (
        grid(tattoos)
      ) : (
        <p className="faint small">
          No tattoo photos yet. Add them in the <a href="#assets">Assets</a> tab (Tattoo photos).
        </p>
      )}
      {measuring.length > 0 && (
        <>
          <h3 className="float-title">Measuring photos</h3>
          {grid(measuring)}
        </>
      )}
      {others.length > 0 && (
        <details
          className="wizard-others"
          open={text !== "" || others.some((a) => pickedKeys.includes(fileKey(a.file)))}
        >
          <summary className="float-title">Other images ({others.length})</summary>
          {grid(others)}
        </details>
      )}
    </div>
  );
}

/** The step's explanation, schematic and controls. */
function Panel(props: {
  step: WizardStep;
  draft: WizardDraft;
  setDraft: (f: (d: WizardDraft) => WizardDraft) => void;
  setPhoto: (i: number, p: WizardPhoto) => void;
  isNew: boolean;
  readyImage: (file: string) => ReadyImage | null;
  byFile: ReadonlyMap<string, AssetInfo>;
  scan: { run: () => void; note: string | null };
  preview: { status: string | null; missing: string[]; reason: string | null };
  layouts: {
    options: string[];
    suggested: ReturnType<typeof layoutTarget> | null;
    target: string | null;
    onChoose: (name: string) => void;
  };
}) {
  const { step, draft, setDraft, isNew } = props;
  const region = draft.region;
  const start = startLabel(region);
  const limb = limbWord(region);
  switch (step.kind) {
    case "name":
      return (
        <StepBody title="Name and body part">
          <p>
            Give the tattoo a name and say where it is. The planner wraps it round that body part, using the
            same measurements as the rest of the planner.
          </p>
          <label className="wizard-field">
            <span className="field-label">Name</span>
            {isNew ? (
              <input
                type="text"
                value={draft.description}
                placeholder="e.g. Rose on the calf"
                autoFocus
                onChange={(e) => {
                  const description = e.target.value;
                  setDraft((d) => ({ ...d, description, name: slugify(description) }));
                }}
              />
            ) : (
              <input
                type="text"
                value={draft.description}
                placeholder={draft.name}
                onChange={(e) => {
                  const description = e.target.value;
                  setDraft((d) => ({ ...d, description }));
                }}
              />
            )}
          </label>
          {draft.name && (
            <p className="faint xs">
              Saved as <span className="mono">{draft.name}</span>
              {!isNew && " (the file name stays)"}
            </p>
          )}
          <fieldset className="wizard-regions">
            <legend className="field-label">Body part</legend>
            {REGION_IDS.map((id) => (
              <label key={id} className={`region-choice${id === region ? " active" : ""}`}>
                <input
                  type="radio"
                  name="wizard-region"
                  value={id}
                  checked={id === region}
                  onChange={() => setDraft((d) => ({ ...d, region: id, area: d.base ? d.area : null }))}
                />
                {REGIONS[id].label}
              </label>
            ))}
          </fieldset>
        </StepBody>
      );
    case "photos":
      return (
        <StepBody title="Photos">
          <p>
            Pick one or more photos of the tattoo. Each photo should show the whole width of the {limb} with a
            little background on both sides, taken from about a metre away. Photos from different sides fill
            in the parts that wrap round.
          </p>
          {draft.photos.length > 0 ? (
            <ol className="wizard-picked">
              {draft.photos.map((p) => (
                <li key={p.file} className="mono xs" title={p.file}>
                  {p.file.split("/").pop()}
                </li>
              ))}
            </ol>
          ) : (
            <p className="faint small">No photo picked yet.</p>
          )}
          <p className="faint small">
            A photo not in the list? Put it into the project folder&apos;s{" "}
            <span className="mono">photos/</span> folder, then look for new images.
          </p>
          <button type="button" onClick={props.scan.run}>
            Look for new images
          </button>
          {props.scan.note && <p className="faint xs">{props.scan.note}</p>}
        </StepBody>
      );
    case "photo":
      return <PhotoPanel {...props} task={step.task} index={step.photo} start={start} limb={limb} />;
    case "preview": {
      const { layouts, preview } = props;
      return (
        <StepBody title="Check and save">
          <p>
            This is the tattoo as the photos put it on the {partName(region)}. If it looks doubled or bent, go
            back to a photo and move its outline or its points a little, or pick another side.
          </p>
          {preview.status === "loading" && (
            <p className="faint small">Building the picture from the photos…</p>
          )}
          {preview.status === "unavailable" && (
            <p className="notice warn small">
              The photos cannot be read here ({preview.reason}). You can still save.
            </p>
          )}
          {preview.missing.length > 0 && (
            <p className="notice warn small">Built without: {preview.missing.join("; ")}</p>
          )}
          {draft.base && (
            <label
              className="inline switch-label"
              title="Off: keep the covered area as saved (for example as set in Advanced)"
            >
              <input
                type="checkbox"
                className="switch"
                checked={draft.area === null}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    area: e.target.checked || !d.base ? null : { u: d.base.patch.u, v: d.base.patch.v },
                  }))
                }
              />
              Fit the covered area to the photos
            </label>
          )}
          <label className="wizard-field">
            <span className="field-label">Show it in layout</span>
            <select value={layouts.target ?? ""} onChange={(e) => layouts.onChoose(e.target.value)}>
              {layouts.options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              {layouts.suggested && !layouts.suggested.exists && (
                <option value={layouts.suggested.name}>New layout {layouts.suggested.name}</option>
              )}
            </select>
          </label>
          <p className="faint xs">
            {layouts.suggested?.why === "linked" && layouts.target === layouts.suggested.name
              ? "It is in this layout already."
              : `The ${partName(region)}'s layouts are listed. The tattoo is added there as an existing tattoo, locked in place.`}
          </p>
        </StepBody>
      );
    }
  }
}

function PhotoPanel(props: {
  task: PhotoTask;
  index: number;
  draft: WizardDraft;
  setPhoto: (i: number, p: WizardPhoto) => void;
  readyImage: (file: string) => ReadyImage | null;
  byFile: ReadonlyMap<string, AssetInfo>;
  start: string;
  limb: string;
}) {
  const { task, index, draft, setPhoto, start, limb } = props;
  const region = draft.region;
  const photo = draft.photos[index]!;
  const set = (p: Partial<WizardPhoto>) => setPhoto(index, { ...photo, ...p });
  const end = REGIONS[region].ends[1];
  switch (task) {
    case "turn": {
      const info = props.byFile.get(fileKey(photo.file));
      return (
        <StepBody title="Turn the photo" art={<TurnArt />}>
          <p>
            Click the picture in which the {limb} stands upright: the {start} at the bottom, the {end} at the
            top.
          </p>
          <div className="turn-choices" role="radiogroup" aria-label="Turn">
            {([0, 90, 180, 270] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={photo.turn === t}
                className={`turn-choice${photo.turn === t ? " current" : ""}`}
                onClick={() => setPhoto(index, turnPhoto(photo, t))}
                title={`Turned ${t}° clockwise`}
              >
                {info?.exists && (
                  <img src={assetImageUrl(info.id)} alt="" style={{ transform: `rotate(${t}deg)` }} />
                )}
              </button>
            ))}
          </div>
        </StepBody>
      );
    }
    case "edges":
      return (
        <StepBody title="Mark the outline" art={<EdgesArt />}>
          <p>
            Drag the four orange dots onto the outline of the {limb}: one line along its left edge, one along
            its right edge. Put the dots far apart, above and below the tattoo. Straight lines are enough,
            even where the outline curves a little.
          </p>
        </StepBody>
      );
    case "marks":
      return (
        <StepBody title="Two known distances" art={<MarksArt />}>
          <p>
            Drag the two red points onto two spots along the {limb} whose distance from the {start} you know,
            and enter the distances. Measure them on the skin with a tape. For example: the {start} itself (0
            cm) and the top of the tattoo.
          </p>
          <p className="faint small">
            The coloured lines show the planner&apos;s model of the skin. When the points are right, the 2 cm
            lines sit at the right height on the tattoo.
          </p>
          {photo.marks.map((m, k) => (
            <label key={k} className="wizard-field inline-field">
              <span className="field-label">Point {k + 1}</span>
              <span className="number-field">
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  value={m.cm}
                  aria-label={`Point ${k + 1}, cm from the ${start}`}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (e.target.value === "" || !Number.isFinite(v)) return;
                    const marks = photo.marks.map((q, i) =>
                      i === k ? { ...q, cm: v } : q,
                    ) as WizardPhoto["marks"];
                    set({ marks });
                  }}
                />
                <span className="faint">cm from the {start.split(" (")[0]}</span>
              </span>
            </label>
          ))}
        </StepBody>
      );
    case "facing": {
      const far = farLabel(region);
      return (
        <StepBody title="Which side faces the camera?">
          <p>
            Each drawing shows a slice through the {limb} seen from above, with the camera below. Click the
            one that looks like the photo: the side nearest the camera is the side you see in the middle of
            the photo.
          </p>
          <FacingChoices
            region={region}
            value={photo.facing}
            onChange={(facing) => set({ facing, ...(photo.twisted ? {} : { facingFar: facing }) })}
          />
          <FineTune
            value={photo.facing}
            onChange={(facing) => set({ facing, ...(photo.twisted ? {} : { facingFar: facing }) })}
          />
          <label className="inline switch-label">
            <input
              type="checkbox"
              className="switch"
              checked={photo.twisted}
              onChange={(e) => set({ twisted: e.target.checked, facingFar: photo.facing })}
            />
            The {limb} is twisted: another side faces the camera at the {far}
          </label>
          {photo.twisted && (
            <>
              <p className="faint small">Which side faces the camera at the {far}?</p>
              <FacingChoices
                region={region}
                value={photo.facingFar}
                onChange={(facingFar) => set({ facingFar })}
              />
              <FineTune value={photo.facingFar} onChange={(facingFar) => set({ facingFar })} />
            </>
          )}
          <p className="faint small">
            Check it on the photo: the red line should run down the middle of the {REGIONS[region].lines[2]}{" "}
            side and the green lines along the sides where you see them.
          </p>
        </StepBody>
      );
    }
  }
}

function FacingChoices({
  region,
  value,
  onChange,
}: {
  region: RegionId;
  value: number;
  onChange: (u: number) => void;
}) {
  const near = nearestFacing(region, value).u;
  return (
    <div className="facing-choices" role="radiogroup" aria-label="Side facing the camera">
      {facingOptions(region).map((o) => (
        <button
          key={o.u}
          type="button"
          role="radio"
          aria-checked={o.u === near}
          className={`facing-choice${o.u === near ? " current" : ""}`}
          onClick={() => onChange(o.u)}
          title={o.label}
        >
          <FacingThumb region={region} u={o.u} />
          <span className="xs">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function FineTune({ value, onChange }: { value: number; onChange: (u: number) => void }) {
  return (
    <label
      className="wizard-field inline-field"
      title="Turn the model a little until the grid fits the photo"
    >
      <span className="field-label">Fine-tune</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={((value % 1) + 1) % 1}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function StepBody({ title, art, children }: { title: string; art?: ReactNode; children: ReactNode }) {
  return (
    <div className="wizard-step">
      <h2>{title}</h2>
      {art && <div className="wizard-art-wrap">{art}</div>}
      {children}
    </div>
  );
}

function SaveBox(props: {
  state: SaveState;
  canSave: boolean;
  dirty: boolean;
  issue: string | null;
  region: RegionId;
  target: string | null;
  onSave: () => void;
  onAnother: () => void;
  onClose: () => void;
  onAdvanced: () => void;
}) {
  const { state } = props;
  return (
    <div className="wizard-save">
      {props.issue && <p className="wizard-issue small">{props.issue}</p>}
      {state.kind === "failed" && (
        <p className="notice error small" role="alert">
          Not saved: {state.message}
        </p>
      )}
      {state.kind === "saved" && !props.dirty && (
        <div className="notice ok small" role="status">
          <p>
            Saved.{" "}
            {state.layout
              ? `It is in layout ${state.layout}${state.created ? " (new)" : ""} on the ${partName(props.region)}: open it in the Layout tab.`
              : "It is not in a layout yet."}
          </p>
          {state.note && <p>{state.note}</p>}
          <p className="wizard-after">
            <a className="button" href="#layout">
              Layout tab
            </a>
            <button type="button" onClick={props.onAnother}>
              Add another
            </button>
            <button type="button" className="ghost" onClick={props.onAdvanced}>
              Fine-tune (Advanced)
            </button>
            <button type="button" className="ghost" onClick={props.onClose}>
              Back to the list
            </button>
          </p>
        </div>
      )}
      {(state.kind !== "saved" || props.dirty) && (
        <button type="button" className="primary" disabled={!props.canSave} onClick={props.onSave}>
          {state.kind === "saving" ? "Saving…" : props.target ? `Save and add to ${props.target}` : "Save"}
        </button>
      )}
    </div>
  );
}
