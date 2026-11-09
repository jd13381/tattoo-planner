// The projection workspace (docs/adr/0024-projection-workspace.md): brings an existing tattoo onto a
// body region from one or more photos in one place instead of a step-by-step wizard. Filmstrip of the
// photos on the left, the photo with the tool in use in the middle, the live result in 3D and on the
// unwrap next to it, the inspector with the photo's checklist on the right; Save, Undo and Redo in the
// page's own bar. The state and every rule live in draft.ts, checks.ts, area.ts, history.ts and
// unwrapDrag.ts; this file only wires them up and draws.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileKey } from "../assets/manifestDoc.ts";
import { assetImageUrl } from "../assets/types.ts";
import { requestImage, useAssetImages, useAssetListing } from "../assets/useAssets.ts";
import { REGIONS } from "../body/regions.ts";
import { screenSign } from "../body/uv.ts";
import { formatKeys, isEditableTarget } from "../editor/shortcuts.ts";
import { currentPlatform } from "../editor/useLayoutShortcuts.ts";
import { parseLayout } from "../layout/yamlDoc.ts";
import { useLayouts, type WorkingLayout } from "../layout/useLayouts.ts";
import { PlusIcon, RedoIcon, UndoIcon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { useEscape } from "../ui/useEscape.ts";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { coveringArc, openingArea, photoFacings, photoSpan } from "./area.ts";
import { draftIssues, photoChecks, photoState, previewable, type StoredSize } from "./checks.ts";
import { editsOf, INK_ONLY_PROMPT, newEdit, shapeWarning } from "./cleanup.ts";
import {
  draftArea,
  draftAutoArea,
  fromCalibration,
  nameIssue,
  newDraft,
  picksOf,
  toCalibration,
  toPhotoCalibration,
  turnPhoto,
  withPhotos,
  type DraftPhoto,
  type ProjectionDraft,
  type Turn,
} from "./draft.ts";
import { EraserStage } from "./Eraser.tsx";
import {
  beginGesture,
  canRedo,
  canUndo,
  cancelGesture,
  commit,
  endGesture,
  historyOf,
  mapHistory,
  redo,
  undo,
  type History,
} from "./history.ts";
import { landmarkChips } from "./landmarks.ts";
import { layoutTarget, linkProjection } from "./layoutLink.ts";
import { LivePreview, type DragPhase, type Ghost } from "./LivePreview.tsx";
import { turnedSize } from "./model.ts";
import { PhotoEditor, PhotoPlaceholder, type GesturePhase } from "./PhotoEditor.tsx";
import { photoStatus } from "./photoStatus.ts";
import type { PhotoCalibration, ProjectionCalibration } from "./schema.ts";
import { SetupSheet, type SetupAnswers } from "./SetupSheet.tsx";
import { openInStudio, type ParkedWorkspace } from "./studioLink.ts";
import { dragPhoto, nudgePhoto, type DragMode } from "./unwrapDrag.ts";
import { patchFor, saveProjection, useProjections } from "./useProjections.ts";
import { TOOLS, WorkspaceInspector, type Tool } from "./WorkspaceInspector.tsx";

/** Resolution of the live picture: coarse enough to rebuild while dragging. */
const PREVIEW_PX_PER_CM = 10;
/** Wait after the last change before the picture is rebuilt, ms. */
const PREVIEW_DEBOUNCE_MS = 150;
/** One colour per photo for the filmstrip and the ghosts. */
const PHOTO_COLORS = ["#4fc3f7", "#ffb74d", "#81c784", "#f06292", "#ba68c8", "#fff176", "#4db6ac", "#e57373"];
export const photoColor = (i: number) => PHOTO_COLORS[i % PHOTO_COLORS.length]!;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string }
  | { kind: "saved"; layout: string | null; created: boolean; note: string | null };

/** Which picture the canvas shows when the photo uses an edited version. */
type Picture = "photo" | "both" | "edit";

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
  /** Asks to delete the saved projection (absent for the read-only sample). */
  onDelete?: (name: string) => void;
  /** The draft parked while a photo was in the Image studio (docs/adr/0023), restored here. */
  parked?: ParkedWorkspace | null;
};

export function ProjectionWorkspace(props: Props) {
  const { arm, pose, editName, openLayout, onDirty, parked } = props;
  const { files, calibrations } = useProjections();
  const editing = editName ? (calibrations.get(editName) ?? null) : null;
  const [initial] = useState<ProjectionDraft>(
    () => parked?.draft ?? (editing ? fromCalibration(editing) : newDraft()),
  );
  const [hist, setHist] = useState<History<ProjectionDraft>>(() => historyOf(initial));
  const draft = hist.present;
  const [savedJson, setSavedJson] = useState(() => parked?.savedJson ?? JSON.stringify(initial));
  const dirty = JSON.stringify(draft) !== savedJson;
  useEffect(() => onDirty?.(dirty), [onDirty, dirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const isNew = !draft.base;

  const [sheet, setSheet] = useState(() => isNew && !parked);
  const [index, setIndex] = useState(() => parked?.photo ?? 0);
  const [tool, setTool] = useState<Tool>(() => (parked ? "cleanup" : "outline"));
  const [activeMark, setActiveMark] = useState<0 | 1>(0);
  const [ghosts, setGhosts] = useState(true);
  const [ruler, setRuler] = useState(true);
  const [picture, setPicture] = useState<Picture>("photo");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [saveMenu, setSaveMenu] = useState(false);
  const [layoutChoice, setLayoutChoice] = useState<string | null>(null);
  const [areaNote, setAreaNote] = useState<string | null>(null);
  const [platform] = useState(currentPlatform);
  const rootRef = useRef<HTMLDivElement>(null);

  const change = useCallback(
    (f: (d: ProjectionDraft) => ProjectionDraft, key?: string) =>
      setHist((h) => commit(h, f(h.present), key)),
    [],
  );
  const setPhotoAt = useCallback(
    (i: number, p: DraftPhoto, key?: string) =>
      change((d) => ({ ...d, photos: d.photos.map((q, k) => (k === i ? p : q)) }), key),
    [change],
  );
  const gesture = useCallback(
    (phase: GesturePhase) =>
      setHist((h) =>
        phase === "start" ? beginGesture(h) : phase === "end" ? endGesture(h) : cancelGesture(h),
      ),
    [],
  );

  const photoIndex = Math.min(index, Math.max(0, draft.photos.length - 1));
  const photo = draft.photos[photoIndex] ?? null;
  const profile = arm.region(draft.region);

  // Images.
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
  const readyImage = useCallback(
    (file: string) => {
      const info = byFile.get(fileKey(file));
      const img = info ? images.get(info.id) : undefined;
      return img?.status === "ready" ? img : null;
    },
    [byFile, images],
  );
  // Sizes as they become known (imagesVersion changes when an image arrives).
  const storedSize: StoredSize = useMemo(() => {
    void imagesVersion;
    return (file: string) => {
      const img = readyImage(file);
      return img ? { width: img.width, height: img.height } : null;
    };
  }, [readyImage, imagesVersion]);
  const sizeOf = useCallback(
    (file: string, turn: Turn) => {
      const s = storedSize(file);
      return s ? turnedSize(s.width, s.height, turn) : null;
    },
    [storedSize],
  );

  // Back from the Image studio: use the edit saved there (the newest one that was not there before).
  const [awaitingEdit, setAwaitingEdit] = useState(() =>
    parked ? { photo: parked.photo, known: parked.knownEdits } : null,
  );
  if (awaitingEdit && listing?.status === "ok") {
    // Adjusted while rendering (once the listing is there), not in an effect.
    setAwaitingEdit(null);
    const p = draft.photos[awaitingEdit.photo];
    const edit = p
      ? newEdit(awaitingEdit.known, editsOf(byFile.get(fileKey(p.file)) ?? null, listing.assets))
      : null;
    if (edit)
      setHist((h) =>
        commit(h, {
          ...h.present,
          photos: h.present.photos.map((q, k) =>
            k === awaitingEdit.photo
              ? { ...q, cleaned: edit.file, cleanedFit: null, cleanedOffset: null }
              : q,
          ),
        }),
      );
  }

  // Checks, to-dos and the area.
  const taken = useMemo(() => (files ?? []).map((f) => f.name), [files]);
  const checks = useMemo(
    () => draft.photos.map((p) => photoChecks(p, draft.region, storedSize, !!draft.cleanup)),
    [draft.photos, draft.region, draft.cleanup, storedSize],
  );
  const issues = useMemo(() => draftIssues(draft, taken, storedSize), [draft, taken, storedSize]);
  const errors = issues.filter((i) => i.severity === "error");
  const area = useMemo(() => draftArea(draft, profile, sizeOf), [draft, profile, sizeOf]);
  // An existing projection whose saved area cuts off what its photos show opens on the automatic
  // area, once every photo's size is known (one undo step, so the saved area is one Undo away).
  const [areaChecked, setAreaChecked] = useState(() => !draft.base || draft.area === null);
  if (!areaChecked && draft.photos.every((p) => sizeOf(p.file, p.turn))) {
    setAreaChecked(true);
    const held = draft.area;
    if (held && openingArea(held, draftAutoArea(draft, profile, sizeOf)) === null) {
      setHist((h) => commit(h, { ...h.present, area: null }));
      setAreaNote(
        "The saved area cut off part of what the photos show, so it now follows the photos. Save to keep it; Undo brings the saved area back.",
      );
    }
  }

  // The live picture: the photos with an outline and two distances, a moment after the last change.
  const previewIdx = useMemo(
    () => draft.photos.flatMap((_, i) => (checks[i] && previewable(checks[i]) ? [i] : [])),
    [draft.photos, checks],
  );
  const built = useMemo(() => {
    if (previewIdx.length === 0) return null;
    const r = toCalibration(
      { ...draft, name: draft.name || "preview", area, photos: previewIdx.map((i) => draft.photos[i]!) },
      profile,
      sizeOf,
    );
    return r.ok ? r.calibration : null;
  }, [draft, area, previewIdx, profile, sizeOf]);
  const [previewCal, setPreviewCal] = useState<ProjectionCalibration | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCal(built), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [built]);
  const onCleanup = tool === "cleanup";
  const preview = useMemo(() => {
    void imagesVersion;
    if (!previewCal) return null;
    return patchFor(
      { ...previewCal, patch: { ...previewCal.patch, px_per_cm: PREVIEW_PX_PER_CM } },
      profile,
      assetMap,
      images,
    );
  }, [previewCal, profile, assetMap, images, imagesVersion]);
  const patch = preview?.status === "ready" ? preview.patch : null;
  // The Clean up tool draws the eraser's strokes live over the patch without them (Eraser.tsx), and
  // compares with the photos as they are.
  const cleanupPatches = useMemo(() => {
    void imagesVersion;
    if (!previewCal || !onCleanup) return null;
    const coarse = { ...previewCal.patch, px_per_cm: PREVIEW_PX_PER_CM };
    const { erase: _e, ...noErase } = previewCal;
    const { cleanup: _c, ...plain } = noErase;
    void _e;
    void _c;
    const after = patchFor({ ...noErase, patch: coarse }, profile, assetMap, images);
    const before = patchFor(
      { ...plain, patch: coarse, photos: plain.photos.map(({ cleaned: _x, ...ph }) => (void _x, ph)) },
      profile,
      assetMap,
      images,
    );
    return {
      after: after.status === "ready" ? after.patch : null,
      before: before.status === "ready" ? before.patch : null,
    };
  }, [previewCal, onCleanup, profile, assetMap, images, imagesVersion]);
  const previewNote =
    previewIdx.length === 0
      ? draft.photos.length === 0
        ? "Add a photo to begin."
        : "The tattoo shows here as soon as one photo has its outline and two distances."
      : preview?.status === "unavailable"
        ? `The photos cannot be read here (${preview.reason}).`
        : preview?.status === "loading" || (built && !previewCal)
          ? "Building the picture from the photos…"
          : preview?.status === "ready" && preview.missing.length > 0
            ? `Built without: ${preview.missing.join("; ")}`
            : null;

  // Ghosts: where each photo in the picture lands.
  const ghostList: Ghost[] = useMemo(
    () =>
      previewIdx.flatMap((i) => {
        const p = draft.photos[i]!;
        const cal = toPhotoCalibration(p);
        const span = photoSpan(cal, sizeOf(p.file, p.turn), profile);
        if (!span) return [];
        const s: [number, number] = [Math.max(0, span[0]), Math.min(profile.length, span[1])];
        return [{ index: i, color: photoColor(i), u: coveringArc(photoFacings(cal), 0.25), s }];
      }),
    [previewIdx, draft.photos, sizeOf, profile],
  );
  const currentGhost = ghostList.find((g) => g.index === photoIndex) ?? null;

  // Correction on the unwrap: one undo step per drag, Esc puts it back.
  const dragStart = useRef<{ photo: DraftPhoto; index: number; span: [number, number] } | null>(null);
  const onUnwrapDrag = (
    phase: DragPhase,
    mode: DragMode,
    from: { u: number; s: number },
    to: { u: number; s: number },
  ) => {
    if (phase === "start") {
      if (!photo || !currentGhost) return;
      dragStart.current = { photo, index: photoIndex, span: currentGhost.s };
      gesture("start");
    } else if (phase === "move") {
      const st = dragStart.current;
      if (st) setPhotoAt(st.index, dragPhoto(st.photo, mode, from, to, st.span));
    } else {
      dragStart.current = null;
      gesture(phase === "end" ? "end" : "cancel");
    }
  };
  const onNudge = (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", big: boolean, atS: number) => {
    if (!photo) return;
    setPhotoAt(
      photoIndex,
      nudgePhoto(photo, key, big, profile.circumferenceAt(atS), screenSign(profile)),
      `nudge-${photoIndex}`,
    );
  };

  // Layouts: where the tattoo goes on save.
  const { files: layoutFiles, save: saveLayout } = useLayouts();
  const regionLayouts = (layoutFiles ?? []).filter((f) => {
    const r = parseLayout(f.text);
    return (r.ok ? (r.layout.region ?? "arm-left") : "arm-left") === draft.region;
  });
  const suggested = layoutFiles
    ? layoutTarget(draft.region, layoutFiles, draft.name || "tattoo", openLayout?.name)
    : null;
  const targetName =
    layoutChoice === "" && !isNew
      ? null
      : layoutChoice &&
          (regionLayouts.some((f) => f.name === layoutChoice) || layoutChoice === suggested?.name)
        ? layoutChoice
        : (suggested?.name ?? null);

  /** Parks the draft and opens the photo (or its edit in use) in the Image studio. */
  const sendToStudio = (i: number) => {
    const p = draft.photos[i];
    if (!p || listing?.status !== "ok") return;
    const original = byFile.get(fileKey(p.file)) ?? null;
    const current = p.cleaned ? byFile.get(fileKey(p.cleaned)) : undefined;
    const open = current?.exists ? current : original;
    if (!open) return;
    const edits = editsOf(original, listing.assets);
    openInStudio(
      {
        assetId: open.id,
        instruction: INK_ONLY_PROMPT,
        purpose: `Cleaning up photo ${i + 1} of “${draft.description || draft.name || "the new tattoo"}” for its projection: keep only the ink. The built-in “Tattoo ink only” is picked; under Generative the GPT prompt is filled in.`,
        back: "settings/projection",
      },
      {
        editName: draft.base ? draft.name : null,
        draft,
        savedJson,
        photo: i,
        knownEdits: edits.map((e) => e.id),
      },
    );
  };

  const canSave = errors.length === 0 && saveState.kind !== "saving" && (dirty || isNew);
  const save = async () => {
    if (!canSave) return;
    const r = toCalibration(draft, profile, sizeOf);
    if (!r.ok) {
      setSaveState({ kind: "failed", message: r.error });
      return;
    }
    const cal = r.calibration;
    setSaveState({ kind: "saving" });
    setSaveMenu(false);
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
      // Every state in the history now edits the saved file (undo after a save keeps it saved-as).
      setHist((h) => mapHistory(h, (d) => ({ ...d, base: cal })));
      setSavedJson(JSON.stringify({ ...draft, base: cal }));
      setAreaNote(null);
      setSaveState({ kind: "saved", layout: layoutName, created, note });
    } catch (e) {
      setSaveState({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const title = isNew
    ? draft.description || draft.name || "New existing tattoo"
    : draft.description || draft.name;
  const leave = () => {
    if (dirty && !window.confirm("Leave without saving? The changes so far are lost.")) return;
    props.onClose();
  };
  useEscape(leave, !sheet);

  // Keys: Mod+Z, Mod+Shift+Z / Mod+Y, Mod+S, G (ghosts), 1–4 (tools), [ and ] are the eraser's.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (e.defaultPrevented || e.isComposing || !root || root.closest("[hidden]") || sheet) return;
      if (document.querySelector("dialog[open]")) return;
      const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (mod && !e.altKey) {
        if (key === "s") {
          e.preventDefault();
          void save();
          return;
        }
        if (isEditableTarget(e.target)) return;
        if (key === "z") {
          e.preventDefault();
          setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
        } else if (key === "y" && !e.shiftKey) {
          e.preventDefault();
          setHist(redo);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (key === "g") {
        e.preventDefault();
        setGhosts((g) => !g);
      } else {
        const t = TOOLS.find((x) => x.key === key);
        if (t) {
          e.preventDefault();
          setTool(t.id);
        }
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const k = (keys: string) => formatKeys(keys, platform);
  const status = photo
    ? photoStatus({
        file: photo.file,
        listing: listing === null ? "loading" : listing.status,
        info: byFile.get(fileKey(photo.file)) ?? null,
        image: (() => {
          const info = byFile.get(fileKey(photo.file));
          return info ? images.get(info.id) : undefined;
        })(),
      })
    : null;
  const ready = photo ? readyImage(photo.file) : null;
  const editImage = photo?.cleaned ? readyImage(photo.cleaned) : null;
  const original = photo ? (byFile.get(fileKey(photo.file)) ?? null) : null;
  const edits =
    listing?.status === "ok" && original ? editsOf(original, listing.assets).filter((e) => e.exists) : [];
  const chips = useMemo(
    () => landmarkChips(profile, arm.body.regions[draft.region].fromSample),
    [profile, arm.body, draft.region],
  );

  return (
    <div className="pw-page" ref={rootRef}>
      <div className="toolbar pw-bar">
        <button
          type="button"
          className="ghost pw-title"
          onClick={() => setSheet(true)}
          title="Name, body part and photos"
        >
          <span className="pw-title-text">{title}</span>
          <span className="faint xs">{REGIONS[draft.region].label}</span>
        </button>
        <span className="toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className="ghost icon-button"
          disabled={!canUndo(hist)}
          onClick={() => setHist(undo)}
          aria-label="Undo"
          title={`Undo (${k("Mod+Z")})`}
          aria-keyshortcuts={platform === "mac" ? "Meta+Z" : "Control+Z"}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="ghost icon-button"
          disabled={!canRedo(hist)}
          onClick={() => setHist(redo)}
          aria-label="Redo"
          title={`Redo (${k("Mod+Shift+Z")})`}
        >
          <RedoIcon />
        </button>
        <span className="spacer" />
        {saveState.kind === "failed" && (
          <span className="notice error xs pw-bar-note" role="alert">
            Not saved: {saveState.message}
          </span>
        )}
        {saveState.kind === "saved" && !dirty && (
          <span className="pw-bar-note xs" role="status">
            Saved
            {saveState.layout
              ? `, in layout ${saveState.layout}${saveState.created ? " (new)" : ""}. `
              : ", not in a layout yet. "}
            {saveState.note && <span className="warn-text">{saveState.note} </span>}
            <a href="#layout">Layout tab</a> ·{" "}
            <button type="button" className="link" onClick={props.onAnother}>
              Add another
            </button>
          </span>
        )}
        {!isNew && props.onDelete && (
          <button
            type="button"
            className="ghost danger-text"
            onClick={() => props.onDelete?.(draft.base?.name ?? draft.name)}
            title="Move this tattoo's projection file to the Trash; the photos stay"
          >
            Delete…
          </button>
        )}
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
          className={dirty || isNew ? "" : "ghost"}
          onClick={leave}
          aria-keyshortcuts="Escape"
          title={
            dirty ? "Back to the list without saving (Esc)" : "Back to the list of existing tattoos (Esc)"
          }
        >
          {dirty || isNew ? "Cancel" : "Close"}
        </button>
        <span className="popover-anchor pw-save">
          <span className="pw-save-split">
            <button
              type="button"
              className="primary"
              disabled={!canSave}
              onClick={() => void save()}
              title={
                errors.length
                  ? `Not yet: ${errors[0]!.text}`
                  : targetName
                    ? `Save and show it in layout ${targetName} (${k("Mod+S")})`
                    : `Save (${k("Mod+S")})`
              }
            >
              {saveState.kind === "saving" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={`pw-save-more${issues.length ? " has-todo" : ""}`}
              aria-expanded={saveMenu}
              aria-label={`Save options and to-do list (${issues.length} open)`}
              onClick={() => setSaveMenu((o) => !o)}
            >
              {issues.length > 0 ? <span className="mono">{issues.length}</span> : "▾"}
            </button>
          </span>
          <Popover
            open={saveMenu}
            onClose={() => setSaveMenu(false)}
            label="Save"
            align="end"
            className="pw-save-menu"
          >
            <label className="wizard-field">
              <span className="field-label">Show it in layout</span>
              <select
                value={targetName ?? ""}
                onChange={(e) => setLayoutChoice(e.target.value)}
                data-autofocus
              >
                {regionLayouts.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
                {suggested && !suggested.exists && (
                  <option value={suggested.name}>New layout {suggested.name}</option>
                )}
                {!isNew && <option value="">No layout (only save the projection)</option>}
              </select>
            </label>
            <p className="faint xs">
              {suggested?.why === "linked" && targetName === suggested.name
                ? "It is in this layout already."
                : `The ${REGIONS[draft.region].label.toLowerCase()}'s layouts are listed. The tattoo is added there as an existing tattoo, locked in place.`}
            </p>
            <h3 className="float-title">To do</h3>
            {issues.length === 0 ? (
              <p className="small">Nothing left to do.</p>
            ) : (
              <ul className="pw-todo">
                {issues.map((it, n) => (
                  <li key={n}>
                    <button
                      type="button"
                      className={`pw-todo-item ${it.severity}`}
                      onClick={() => {
                        setSaveMenu(false);
                        if (it.photo === null) {
                          if (it.check === "name" || it.check === "photos") setSheet(true);
                          return;
                        }
                        setIndex(it.photo);
                        setTool(
                          it.check === "outline"
                            ? "outline"
                            : it.check === "distances"
                              ? "distances"
                              : it.check === "facing"
                                ? "camera"
                                : "cleanup",
                        );
                      }}
                    >
                      <span className={`pw-check-dot ${it.severity}`} aria-hidden="true" />
                      <span>
                        {it.photo !== null && <strong>Photo {it.photo + 1}: </strong>}
                        {it.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {errors.length > 0 && <p className="faint xs">Red items block saving; the others can wait.</p>}
          </Popover>
        </span>
      </div>

      <div className="pw-body">
        <nav className="pw-filmstrip" aria-label="Photos">
          <ol>
            {draft.photos.map((p, i) => {
              const info = byFile.get(fileKey(p.file));
              const state = checks[i] ? photoState(checks[i]) : "todo";
              return (
                <li key={p.file} className={i === photoIndex ? "current" : undefined}>
                  <button
                    type="button"
                    className="pw-thumb"
                    aria-current={i === photoIndex ? "true" : undefined}
                    onClick={() => setIndex(i)}
                    title={`${p.file}${p.cleaned ? `\nusing ${p.cleaned}` : ""}`}
                    style={{ borderColor: i === photoIndex ? photoColor(i) : undefined }}
                  >
                    {info?.exists ? (
                      <img
                        src={assetImageUrl(info.id)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        style={{ transform: `rotate(${p.turn}deg)` }}
                      />
                    ) : (
                      <span className="faint xs">missing</span>
                    )}
                    <span className="pw-thumb-n mono" style={{ background: photoColor(i) }}>
                      {i + 1}
                    </span>
                    <span
                      className={`pw-check-dot ${state}`}
                      title={
                        state === "done" ? "Complete" : state === "error" ? "Needs fixing" : "Something to do"
                      }
                    />
                    {p.cleaned && <span className="pw-thumb-edit xs">edit</span>}
                  </button>
                  <button
                    type="button"
                    className="ghost icon-button pw-thumb-remove"
                    aria-label={`Remove photo ${i + 1}`}
                    title="Remove this photo from the projection (Undo brings it back)"
                    onClick={() => {
                      change((d) => ({ ...d, photos: d.photos.filter((_, k) => k !== i) }));
                      if (photoIndex >= i && photoIndex > 0) setIndex(photoIndex - 1);
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className="pw-add" onClick={() => setSheet(true)} title="Pick more photos">
            <PlusIcon />
            <span className="xs">Add photo</span>
          </button>
        </nav>

        <section className="pw-canvas" aria-label="Photo">
          <div className="toolbar pw-tools" role="toolbar" aria-label="Tools">
            <span className="segmented" role="group" aria-label="Tool">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tool === t.id ? "active" : ""}
                  aria-pressed={tool === t.id}
                  aria-keyshortcuts={t.key}
                  onClick={() => setTool(t.id)}
                  title={`${t.hint} (${t.key})`}
                >
                  {t.label}
                </button>
              ))}
            </span>
            {photo && tool !== "cleanup" && (
              <>
                <span className="toolbar-sep" aria-hidden="true" />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPhotoAt(photoIndex, turnPhoto(photo, ((photo.turn + 270) % 360) as Turn))}
                  title="Turn the photo a quarter to the left: the start of the body part (e.g. the wrist) goes at the bottom"
                  aria-label="Turn left"
                >
                  ↺
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPhotoAt(photoIndex, turnPhoto(photo, ((photo.turn + 90) % 360) as Turn))}
                  title="Turn the photo a quarter to the right"
                  aria-label="Turn right"
                >
                  ↻
                </button>
                <label
                  className="inline xs"
                  title="A cm ruler along the left edge, from the points' distances"
                >
                  <input type="checkbox" checked={ruler} onChange={(e) => setRuler(e.target.checked)} /> Ruler
                </label>
                {photo.cleaned && (
                  <span className="segmented" role="group" aria-label="Picture">
                    {(["photo", "both", "edit"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={picture === m ? "active" : ""}
                        aria-pressed={picture === m}
                        onClick={() => setPicture(m)}
                        title={
                          m === "photo"
                            ? "The photo the points are placed on"
                            : m === "both"
                              ? "The edited version over the photo, to check that they line up"
                              : "The edited version alone"
                        }
                      >
                        {m === "photo" ? "Photo" : m === "both" ? "Both" : "Edit"}
                      </button>
                    ))}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="pw-stage">
            {!photo ? (
              <div className="wizard-message">
                <p className="muted">No photo yet.</p>
                <button type="button" className="primary" onClick={() => setSheet(true)}>
                  Add photos
                </button>
              </div>
            ) : tool === "cleanup" ? (
              <EraserStage
                before={cleanupPatches?.before ?? null}
                after={cleanupPatches?.after ?? null}
                erase={draft.erase}
                onErase={(erase) => change((d) => ({ ...d, erase }))}
                mirrored={profile.mirrored}
                cleaned={!!draft.cleanup || draft.photos.some((p) => p.cleaned)}
              />
            ) : status?.kind !== "ready" || !ready ? (
              <div className="pw-photo">
                <PhotoPlaceholder
                  status={
                    !status || status.kind === "ready" ? { kind: "loading", title: "Loading…" } : status
                  }
                  file={photo.file}
                />
              </div>
            ) : (
              <div className="pw-photo">
                <PhotoEditor
                  photo={toPhotoCalibration(photo)}
                  image={ready}
                  profile={profile}
                  editable={tool === "outline" ? "edges" : tool === "distances" ? "marks" : "none"}
                  grid={tool !== "outline"}
                  handleScale={1.6}
                  ruler={ruler && tool !== "outline" ? { length: profile.length } : null}
                  overlay={
                    editImage
                      ? {
                          image: editImage,
                          fit: photo.cleanedFit ?? undefined,
                          offset: photo.cleanedOffset,
                          opacity: picture === "edit" ? 1 : picture === "both" ? 0.55 : 0,
                        }
                      : null
                  }
                  activeMark={activeMark}
                  onActiveMark={setActiveMark}
                  markLabel={(i, cm) => `${i + 1} · ${cm} cm`}
                  onGesture={gesture}
                  onChange={(p: PhotoCalibration, key) =>
                    setPhotoAt(photoIndex, { ...photo, edges: p.edges, marks: p.along }, key)
                  }
                />
              </div>
            )}
          </div>
        </section>

        <LivePreview
          profile={profile}
          pose={pose}
          cal={previewCal}
          patch={patch}
          note={previewNote}
          assets={assetMap}
          images={images}
          area={area}
          auto={draft.area === null}
          ghosts={ghostList}
          showGhosts={ghosts}
          onToggleGhosts={() => setGhosts((g) => !g)}
          current={currentGhost}
          onDrag={onUnwrapDrag}
          onNudge={onNudge}
        />

        {photo ? (
          <WorkspaceInspector
            draft={draft}
            index={photoIndex}
            photo={photo}
            checks={checks[photoIndex] ?? []}
            tool={tool}
            setTool={setTool}
            setPhoto={(p, key) => setPhotoAt(photoIndex, p, key)}
            change={change}
            chips={chips}
            activeMark={activeMark}
            setActiveMark={setActiveMark}
            area={area}
            regionLength={profile.length}
            areaNote={areaNote}
            edits={edits}
            onStudio={original?.exists && listing?.status === "ok" ? () => sendToStudio(photoIndex) : null}
            shapeWarning={
              photo.cleaned ? shapeWarning(storedSize(photo.file), storedSize(photo.cleaned)) : null
            }
            onAlign={() => picture === "photo" && setPicture("both")}
          />
        ) : (
          <aside className="pw-inspector" aria-label="Inspector">
            <p className="muted small">Pick the tattoo&apos;s photos to begin.</p>
          </aside>
        )}
      </div>

      {sheet && (
        <SetupSheet
          isNew={isNew}
          initial={{
            description: draft.description,
            name: draft.name,
            region: draft.region,
            picks: picksOf(draft),
          }}
          nameIssue={(name) => nameIssue({ name, base: draft.base }, taken)}
          assets={listing?.status === "ok" ? listing.assets : null}
          listingState={listing === null ? "loading" : listing.status}
          scan={{ run: scanAssets, note: scanNote }}
          onCancel={() => {
            if (isNew && draft.photos.length === 0) props.onClose();
            else setSheet(false);
          }}
          onApply={(a: SetupAnswers) => {
            change((d) => ({
              ...withPhotos(d, a.picks),
              description: a.description,
              name: a.name,
              region: a.region,
            }));
            const firstNew = a.picks.findIndex((p) => !draft.photos.some((q) => q.file === p.file));
            if (firstNew >= 0) {
              setIndex(firstNew);
              setTool("outline");
            }
            setSheet(false);
          }}
        />
      )}
    </div>
  );
}
