// The guided projection wizard (docs/adr/0014-guided-projection.md): brings an existing tattoo onto a body
// region from one or more photos, one question per step, with the model's skin grid on the photo as
// live feedback. The state and every rule live in wizard.ts and layoutLink.ts; this file only draws.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { editsOf, INK_ONLY_PROMPT, isEditOf, newEdit, shapeWarning } from "./cleanup.ts";
import { describeFacing, joinFacing, neighbours, sideChoices, splitFacing } from "./sides.ts";
import { openInStudio, type ParkedWizard } from "./studioLink.ts";
import { DEFAULT_CLEANUP } from "./schema.ts";
import {
  farLabel,
  fromCalibration,
  moveStep,
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
import { CameraDial, EdgesArt, MarksArt, TurnArt } from "./wizardArt.tsx";
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
  /** Answers parked while the photo was in the Image studio (docs/adr/0023), restored here. */
  parked?: ParkedWizard | null;
};

/** What the region is called in running text ("left arm", "torso"). */
const partName = (r: RegionId) => REGIONS[r].label.toLowerCase();
/** The limb or body in running text: "arm", "leg", "body". */
const limbWord = (r: RegionId) => ({ arm: "arm", leg: "leg", torso: "body" })[REGIONS[r].kind];

export function ProjectionWizard(props: Props) {
  const { arm, pose, editName, openLayout, onDirty, parked } = props;
  const { files, calibrations } = useProjections();
  const editing = editName ? (calibrations.get(editName) ?? null) : null;
  const [initial] = useState<WizardDraft>(
    () => parked?.draft ?? (editing ? fromCalibration(editing) : newDraft()),
  );
  const [draft, setDraft] = useState<WizardDraft>(initial);
  const [step, setStep] = useState<WizardStep>(
    () => parked?.step ?? (editing ? { kind: "preview" } : { kind: "name" }),
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [savedJson, setSavedJson] = useState(() => parked?.savedJson ?? JSON.stringify(initial));
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
    for (const p of draft.photos)
      for (const file of [p.file, p.cleaned]) {
        const info = file ? byFile.get(fileKey(file)) : undefined;
        if (info?.exists) requestImage(info.id);
      }
  }, [draft.photos, byFile]);
  // Back from the Image studio: use the edit saved there (the newest one that was not there before).
  const [awaitingEdit, setAwaitingEdit] = useState(() =>
    parked ? { photo: parked.photo, known: parked.knownEdits } : null,
  );
  if (awaitingEdit && listing?.status === "ok") {
    // Adjusted while rendering (once the listing is there), not in an effect.
    setAwaitingEdit(null);
    const photo = draft.photos[awaitingEdit.photo];
    const edit = photo
      ? newEdit(awaitingEdit.known, editsOf(byFile.get(fileKey(photo.file)) ?? null, listing.assets))
      : null;
    if (edit)
      setDraft((d) => ({
        ...d,
        photos: d.photos.map((q, k) => (k === awaitingEdit.photo ? { ...q, cleaned: edit.file } : q)),
      }));
  }
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
  const onPreview = current.kind === "preview" || current.kind === "cleanup";
  const onCleanup = current.kind === "cleanup";
  const preview = useMemo(() => {
    void imagesVersion;
    if (!previewCal || !onPreview) return null;
    const cal = { ...previewCal, patch: { ...previewCal.patch, px_per_cm: PREVIEW_PX_PER_CM } };
    return patchFor(cal, profile, assetMap, images);
  }, [previewCal, onPreview, profile, assetMap, images, imagesVersion]);
  const patch = preview?.status === "ready" ? preview.patch : null;
  // The clean-up step compares with the photos as they are: no ink only, no edited versions.
  const before = useMemo(() => {
    void imagesVersion;
    if (!previewCal || !onCleanup) return null;
    const { cleanup: _drop, ...rest } = previewCal;
    void _drop;
    const cal = {
      ...rest,
      patch: { ...previewCal.patch, px_per_cm: PREVIEW_PX_PER_CM },
      photos: previewCal.photos.map(({ cleaned: _c, ...ph }) => (void _c, ph)),
    };
    const r = patchFor(cal, profile, assetMap, images);
    return r.status === "ready" ? r.patch : null;
  }, [previewCal, onCleanup, profile, assetMap, images, imagesVersion]);

  /** Parks the answers and opens the photo (or its edit in use) in the Image studio. */
  const sendToStudio = (index: number) => {
    const photo = draft.photos[index];
    if (!photo || listing?.status !== "ok") return;
    const original = byFile.get(fileKey(photo.file)) ?? null;
    const current = photo.cleaned ? byFile.get(fileKey(photo.cleaned)) : undefined;
    const open = current?.exists ? current : original;
    if (!open) return;
    const edits = editsOf(original, listing.assets);
    openInStudio(
      {
        assetId: open.id,
        instruction: INK_ONLY_PROMPT,
        purpose: `Cleaning up photo ${index + 1} of “${draft.description || draft.name || "the new tattoo"}” for its projection: keep only the ink. The built-in “Tattoo ink only” is picked; under Generative the GPT prompt is filled in.`,
        back: "settings/projection",
      },
      {
        editName: draft.base ? draft.name : null,
        draft,
        savedJson,
        step: { kind: "cleanup" },
        photo: index,
        knownEdits: edits.map((e) => e.id),
      },
    );
  };

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
            before={before}
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
            assets={listing?.status === "ok" ? listing.assets : []}
            onStudio={sendToStudio}
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
  before: ProjectedPatch | null;
  previewCal: ProjectionCalibration | null;
  assetMap: ReadonlyMap<string, AssetInfo> | null;
}) {
  const { step, draft, profile, pose } = props;
  const regionTexture = useMemo(() => {
    const c = document.createElement("canvas");
    renderUnwrap(c, profile, "grid", null, { pxPerCm: 8, grid: true });
    return c;
  }, [profile]);
  const { previewCal, assetMap, images } = props;
  const canvasesOf = useCallback(
    (patch: ProjectedPatch | null) =>
      previewCal
        ? previewCanvases({
            name: previewCal.name,
            patch,
            profile,
            assets: assetMap,
            images,
            v1: Math.min(1, previewCal.patch.v[1] + 0.03),
            centerU: (previewCal.patch.u[0] + previewCal.patch.u[1]) / 2,
            pxPerCm: TEXTURE_PX_PER_CM,
          })
        : null,
    [previewCal, profile, assetMap, images],
  );
  const showsPatch = step.kind === "preview" || step.kind === "cleanup";
  const preview = useMemo(
    () => (showsPatch ? canvasesOf(props.patch) : null),
    [showsPatch, canvasesOf, props.patch],
  );
  const beforeView = useMemo(
    () => (step.kind === "cleanup" ? canvasesOf(props.before) : null),
    [step.kind, canvasesOf, props.before],
  );

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
    case "cleanup":
      return (
        <div className="wizard-cleanup">
          <figure className="wizard-unwrap">
            {beforeView && props.before ? (
              <CanvasHost canvas={beforeView.innerImage} />
            ) : (
              <p className="faint small">Building the picture from the photos…</p>
            )}
            <figcaption className="faint xs">
              Before: the photos as they are, with skin and shadows
            </figcaption>
          </figure>
          <figure className="wizard-unwrap">
            {preview && props.patch ? (
              <CanvasHost canvas={preview.innerImage} />
            ) : (
              <p className="faint small">Building the picture from the photos…</p>
            )}
            <figcaption className="faint xs">
              After:{" "}
              {draft.cleanup || draft.photos.some((p) => p.cleaned)
                ? "what goes onto the skin"
                : "unchanged (clean-up is off)"}
            </figcaption>
          </figure>
        </div>
      );
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
  const sides = sideChoices(region);
  return (
    <p className="wizard-gridkey float xs">
      <span className="legend-swatch" style={{ background: "#e53935" }} aria-hidden="true" /> middle of the{" "}
      {sides[2]!.label.toLowerCase()}
      <span className="legend-swatch" style={{ background: "#43a047" }} aria-hidden="true" />{" "}
      {sides[1]!.label.toLowerCase()} / {sides[3]!.label.toLowerCase()}
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
  assets: AssetInfo[];
  onStudio: (photo: number) => void;
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
    case "cleanup":
      return <CleanupPanel {...props} limb={limb} />;
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
      const setNear = (facing: number) => set({ facing, ...(photo.twisted ? {} : { facingFar: facing }) });
      return (
        <StepBody title="Where was the camera?">
          <p>
            Which side of the {limb} does the photo show? Click it below, or drag the camera round the{" "}
            {partName(region)} in the picture.
          </p>
          <SidePicker region={region} value={photo.facing} onChange={setNear} />
          <p className="faint small">
            Check it on the photo: the coloured lines should run along the {limb} and the line of the side you
            picked down the middle of the photo. If they sit a little to one side, turn the camera a little.
          </p>
          <details className="wizard-advanced" open={photo.twisted}>
            <summary className="small">Advanced</summary>
            <label className="inline switch-label">
              <input
                type="checkbox"
                className="switch"
                checked={photo.twisted}
                onChange={(e) => set({ twisted: e.target.checked, facingFar: photo.facing })}
              />
              Another side faces the camera at the {far} (the {limb} is twisted in the photo)
            </label>
            {photo.twisted && (
              <>
                <p className="faint small">Where was the camera, seen from the {far}?</p>
                <SidePicker
                  region={region}
                  value={photo.facingFar}
                  onChange={(facingFar) => set({ facingFar })}
                  compact
                />
              </>
            )}
          </details>
        </StepBody>
      );
    }
  }
}

/** The four sides as the picture shows them: front and back first, then its left and right. */
const sideOrder = (region: RegionId) =>
  [90, 270, 180, 0].map((a) => sideChoices(region).find((sd) => sd.angle === a)!);

/**
 * The camera picture, the four sides as big buttons and "a little from the side": one facing u, split
 * into the nearest side and a small turn (src/projection/sides.ts).
 */
function SidePicker({
  region,
  value,
  onChange,
  compact,
}: {
  region: RegionId;
  value: number;
  onChange: (u: number) => void;
  compact?: boolean;
}) {
  const { main, offset } = splitFacing(value);
  const [less, more] = neighbours(region, main);
  const now = describeFacing(region, value);
  return (
    <div className={`side-picker${compact ? " compact" : ""}`}>
      <CameraDial region={region} value={value} onChange={onChange} label="Camera position" />
      <div className="side-choices" role="radiogroup" aria-label="Side in the photo">
        {sideOrder(region).map((sd) => (
          <button
            key={sd.u}
            type="button"
            role="radio"
            aria-checked={sd.u === main}
            className={`side-choice${sd.u === main ? " current" : ""}`}
            onClick={() => onChange(sd.u)}
          >
            <span className="side-label">{sd.label}</span>
            {sd.hint && <span className="side-hint xs">{sd.hint}</span>}
          </button>
        ))}
      </div>
      <label className="wizard-field side-turn">
        <span className="field-label">
          A little from the side?{" "}
          <span className="faint">
            {now.turnDeg === 0
              ? "straight on"
              : `${Math.abs(now.turnDeg)}° towards the ${(now.turnDeg < 0 ? less : more).label.toLowerCase()}`}
          </span>
        </span>
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={Math.round(offset * 360)}
          aria-valuetext={now.turnDeg === 0 ? "straight on" : `${now.turnDeg} degrees`}
          onChange={(e) => onChange(joinFacing(main, Number(e.target.value) / 360))}
        />
        <span className="side-turn-ends faint xs" aria-hidden="true">
          <span>← {less.label.toLowerCase()}</span>
          <span>{more.label.toLowerCase()} →</span>
        </span>
      </label>
    </div>
  );
}

/** The clean-up step: ink only (built in), and per photo an edited version from the Image studio. */
function CleanupPanel(props: {
  draft: WizardDraft;
  setDraft: (f: (d: WizardDraft) => WizardDraft) => void;
  setPhoto: (i: number, p: WizardPhoto) => void;
  readyImage: (file: string) => ReadyImage | null;
  byFile: ReadonlyMap<string, AssetInfo>;
  assets: AssetInfo[];
  onStudio: (photo: number) => void;
  limb: string;
}) {
  const { draft, setDraft, setPhoto, byFile, assets, readyImage, limb } = props;
  const cleanup = draft.cleanup;
  const setCleanup = (c: Partial<NonNullable<WizardDraft["cleanup"]>>) =>
    setDraft((d) => ({ ...d, cleanup: { ...(d.cleanup ?? DEFAULT_CLEANUP), ...c } }));
  return (
    <StepBody title="Clean up">
      <p>
        A photo shows more than the tattoo: the skin, its light and shadow and the shape of the {limb}. Here
        only the ink is kept, so the planner&apos;s {limb} shows the tattoo, not the photo&apos;s light.
        Compare before and after on the left.
      </p>
      <label className="inline switch-label">
        <input
          type="checkbox"
          className="switch"
          checked={!!cleanup}
          onChange={(e) =>
            setDraft((d) => ({ ...d, cleanup: e.target.checked ? { ...DEFAULT_CLEANUP } : null }))
          }
        />
        Keep only the ink
      </label>
      {cleanup && (
        <div className="cleanup-controls">
          <label className="wizard-field">
            <span className="field-label">
              Strength <span className="faint mono">{Math.round(cleanup.strength * 100)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(cleanup.strength * 100)}
              onChange={(e) => setCleanup({ strength: Number(e.target.value) / 100 })}
            />
            <span className="side-turn-ends faint xs" aria-hidden="true">
              <span>keeps faint lines and grey</span>
              <span>only clear lines, solid</span>
            </span>
          </label>
          <label className="wizard-field">
            <span className="field-label">
              Shadows up to <span className="faint mono">{cleanup.flatten_cm} cm</span>
            </span>
            <input
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={cleanup.flatten_cm}
              onChange={(e) => setCleanup({ flatten_cm: Number(e.target.value) })}
            />
            <span className="faint xs">
              Larger evens out wider shadows; it should stay wider than the tattoo&apos;s thickest lines.
            </span>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={cleanup.keep_color}
              onChange={(e) => setCleanup({ keep_color: e.target.checked })}
            />{" "}
            Keep the ink&apos;s colour
          </label>
        </div>
      )}
      <h3 className="float-title">Edited photos</h3>
      <p className="faint small">
        Not clean enough (a shadow left, the background in the way)? Edit the photo in the Image studio, with
        the built-in “Tattoo ink only” or with GPT. Save it there and come back: the projection then uses the
        edit, the points you placed stay.
      </p>
      <ol className="cleanup-photos">
        {draft.photos.map((p, i) => {
          const original = byFile.get(fileKey(p.file)) ?? null;
          const edits = editsOf(original, assets).filter((e) => e.exists);
          const known = isEditOf(p.cleaned, edits);
          const warn =
            p.cleaned && readyImage(p.file) && readyImage(p.cleaned)
              ? shapeWarning(readyImage(p.file), readyImage(p.cleaned))
              : null;
          return (
            <li key={p.file} className="cleanup-photo">
              <span className="mono xs" title={p.file}>
                {i + 1}. {p.file.split("/").pop()}
              </span>
              <span className="cleanup-photo-row">
                <select
                  aria-label={`Picture used for photo ${i + 1}`}
                  value={p.cleaned ?? ""}
                  onChange={(e) => setPhoto(i, { ...p, cleaned: e.target.value || null })}
                >
                  <option value="">The photo itself</option>
                  {edits.map((e) => (
                    <option key={e.id} value={e.file}>
                      Edit {e.id}
                    </option>
                  ))}
                  {p.cleaned && !known && <option value={p.cleaned}>{p.cleaned} (not found)</option>}
                </select>
                <button
                  type="button"
                  disabled={!original?.exists}
                  title={original?.exists ? "Your answers so far are kept" : "The photo is missing"}
                  onClick={() => props.onStudio(i)}
                >
                  Edit in Image studio
                </button>
              </span>
              {warn && <span className="notice warn xs">{warn}</span>}
            </li>
          );
        })}
      </ol>
    </StepBody>
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
