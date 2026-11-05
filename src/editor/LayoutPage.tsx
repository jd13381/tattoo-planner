import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AssetBrowser } from "../assets/AssetBrowser.tsx";
import { stepAsset } from "../assets/filter.ts";
import { ImagePicker } from "../assets/ImagePicker.tsx";
import type { AssetInfo } from "../assets/types.ts";
import { useAssetListing } from "../assets/useAssets.ts";
import { useLayoutSources } from "../assets/useLayoutSources.ts";
import { defaultFilter, isFigureLike } from "../layout/imageFit.ts";
import { layoutSchema, type ElementType, type Layout, type LayoutElement } from "../layout/schema.ts";
import { classify, resolveElement } from "../layout/shapes.ts";
import { useLayouts, type StoredLayout, type WorkingLayout } from "../layout/useLayouts.ts";
import { layoutRegion, parseLayout } from "../layout/yamlDoc.ts";
import { coverage } from "../metrics/coverage.ts";
import { MetricsPanel } from "../metrics/MetricsPanel.tsx";
import { renderUnwrap, timed, type RenderMode } from "../render/unwrapCanvas.ts";
import { ExportButton } from "../export/ExportButton.tsx";
import type { ExportInput } from "../export/runExport.ts";
import { inputKeys } from "../body/inputs.ts";
import { DEFAULT_REGION, editorCentres, REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import { SAMPLES } from "../body/samples.ts";
import { ArmViewer, ORBIT_HINT, PoseControl } from "../viewer/ArmViewer.tsx";
import { BodyViewer, type RegionTexture } from "../viewer/BodyViewer.tsx";
import { anubisSize, type ArmState, type Pose } from "../viewer/useArm.ts";
import { Popover } from "../ui/Popover.tsx";
import {
  BandIcon,
  ExistingIcon,
  FigureIcon,
  FillerIcon,
  FitIcon,
  HelpIcon,
  ImageIcon,
  LayersIcon,
  RedLineIcon,
  RedoIcon,
  SelectIcon,
  UndoIcon,
  WarnIcon,
} from "../ui/icons.tsx";
import { createValueStore, useValue, type ValueStore } from "../ui/valueStore.ts";
import { ToastRegion, useToast } from "../ui/Toast.tsx";
import { freeSpot, newElement, suggestVariantName } from "./edit.ts";
import { ElementList } from "./ElementList.tsx";
import { ColorField, ElementPanel } from "./ElementPanel.tsx";
import { canRedo, canUndo, createHistory, push, redo, reset, seal, undo, type History } from "./history.ts";
import {
  burstKey,
  deleteAt,
  duplicateAt,
  elementIssues,
  followSelection,
  moveLayer,
  moveLayerTo,
  nextBurst,
  splitIssues,
  type Burst,
  type LayoutEdit,
} from "./layoutOps.ts";
import {
  elementAnchor,
  formatPointCm,
  formatPositionCm,
  nudgeElement,
  nudgeStepCm,
  regionNames,
  type UV as SkinUV,
} from "./nudge.ts";
import { RegionTextureSource } from "./RegionTextures.tsx";
import { SaveAsForm } from "./SaveAsForm.tsx";
import { formatKeys, isEditableTarget, SHORTCUTS, type ShortcutAction } from "./shortcuts.ts";
import { applyStroke, type UV } from "./stroke.ts";
import { EDITOR_HINT, UnwrapEditor } from "./UnwrapEditor.tsx";
import { currentPlatform, useLayoutShortcuts } from "./useLayoutShortcuts.ts";

// "cm grid" is gone from the switch: Blockout with Grid on shows the same grid with the layout.
const MODES: { id: RenderMode; label: string }[] = [
  { id: "reference", label: "Reference" },
  { id: "blockout", label: "Blockout" },
];

/** `?debug` in the URL shows developer readouts (the texture render time). */
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");

const HINTS: Record<RenderMode, string | undefined> = {
  blockout: "Dark grey: figures, light grey: fillers, striped: bands, red: lines, outlined: existing tattoo.",
  reference:
    "Reference images cut to their boxes (grayscale on the forearm by default), patterns for fillers and bands, lines on top.",
  grid: undefined,
};

/** Texture and editor resolution; blockout shapes are flat, so 12 px per cm is plenty. */
const PX_PER_CM = 12;
/** Metrics resolution: 6 px per cm gives areas within a fraction of a percent. */
const METRICS_PX_PER_CM = 6;

/** The tool rail's add buttons, in rail order. Lines are drawn with the Line tool (brush). */
const ADD_TOOLS: { type: ElementType; label: string; icon: ReactNode }[] = [
  { type: "figure", label: "Figure", icon: <FigureIcon /> },
  { type: "existing", label: "Existing tattoo", icon: <ExistingIcon /> },
  { type: "filler", label: "Filler", icon: <FillerIcon /> },
  { type: "band", label: "Band", icon: <BandIcon /> },
];

/** A free name for a new layout on a region: torso-1, torso-2, … */
function draftName(region: RegionId, taken: string[]): string {
  for (let i = 1; ; i++) if (!taken.includes(`${region}-${i}`)) return `${region}-${i}`;
}

/** Where the page puts its controls in the app's top bar (App.tsx). */
export type HeaderSlots = { notices: HTMLElement | null; actions: HTMLElement | null };

type Props = {
  arm: ArmState;
  pose: Pose;
  /** Reports the open variant and its unsaved state (the Compare tab offers unsaved edits). */
  onWorking?: (w: WorkingLayout | null) => void;
  /** Whether the tab is open; the page stays mounted while hidden and then leaves the top bar alone. */
  active?: boolean;
  header?: HeaderSlots;
};

export function LayoutPage({ arm, pose, onWorking, active = true, header }: Props) {
  // The body region being edited; every layout belongs to one (docs/adr/0011).
  const [region, setRegion] = useState<RegionId>(DEFAULT_REGION);
  const profile = arm.region(region);
  // The variant last opened on each region, so switching back returns to it (and the full-body view
  // shows it on that region).
  const [lastByRegion, setLastByRegion] = useState<Partial<Record<RegionId, string>>>({});
  const [view3d, setView3d] = useState<"region" | "body">("region");
  const [name, setName] = useState<string | null>(null);
  // The open layout with its undo/redo stacks; `layout` is the present state.
  const [history, setHistory] = useState<History<Layout> | null>(null);
  const layout = history?.present ?? null;
  const [savedJson, setSavedJson] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [viewerToolbar, setViewerToolbar] = useState<HTMLDivElement | null>(null);
  // The 3D pane: its floating panels are kept clear of the region in the fixed views.
  const [pane3d, setPane3d] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<RenderMode>("reference");
  const [grid, setGrid] = useState(true);
  const [centerU, setCenterU] = useState(0);
  // Line tool (brush): draw lines on the 3D arm, in the chosen colour.
  const [drawing, setDrawing] = useState(false);
  const [lineColor, setLineColor] = useState("red");
  // The image picker and the button it opened from (element panel or the floating button).
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  // Switching variants with unsaved edits asks first (Save / Discard / Cancel).
  const [pendingSwitch, setPendingSwitch] = useState<{ label: string; go: () => void } | null>(null);
  const [appendStrokes, setAppendStrokes] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [sideTab, setSideTab] = useState<"elements" | "assets">("elements");
  const [fitRequest, setFitRequest] = useState(0);
  // Cursor and zoom of the 2D editor change on every pointer move: only the status bar re-renders.
  const [cursor] = useState(() => createValueStore<SkinUV | null>(null));
  const [zoom] = useState(() => createValueStore(100));
  const toast = useToast();
  // Export progress and results sit with the toasts at the bottom, not in the top bar.
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [platform] = useState(currentPlatform);
  const keyHint = (keys: string) => formatKeys(keys, platform);

  /** Switches the region and puts the editor on its first centre line. */
  const enterRegion = (next: RegionId) => {
    if (next !== region) setCenterU(editorCentres(next)[0]!.u);
    setRegion(next);
  };

  const open = (fileName: string, list: StoredLayout[] | null) => {
    const file = list?.find((f) => f.name === fileName);
    if (!file) return;
    const r = parseLayout(file.text);
    const fileReg = layoutRegion(file.text);
    enterRegion(fileReg);
    setLastByRegion((m) => ({ ...m, [fileReg]: fileName }));
    setName(fileName);
    setSelected(null);
    setSaveError(null);
    if (r.ok) {
      setHistory(createHistory(r.layout));
      setSavedJson(JSON.stringify(r.layout));
      setParseError(null);
    } else {
      setHistory(null);
      setParseError(r.error);
    }
  };

  const {
    files,
    error: loadError,
    save,
  } = useLayouts((list) => {
    // Open v1-baseline (or the first variant) once the list arrives.
    const first = list.find((f) => f.name === "v1-baseline") ?? list[0];
    if (first) open(first.name, list);
  });

  // Assets: the manifest listing and the decoded images of every asset the layout uses.
  const { listing, reload: reloadAssets, scanNote } = useAssetListing();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((a) => [a.id, a])) : null),
    [listing],
  );
  const {
    aspects,
    patches,
    patchIssues,
    sources,
    loading: loadingImages,
  } = useLayoutSources(layout, assetMap, listing !== null, profile);

  const dirty = layout !== null && JSON.stringify(layout) !== savedJson;
  // A layout saved elsewhere (the projection wizard links a tattoo into it) reloads here, unless it
  // has unsaved edits: then the next save here wins, as for a hand edit of the file.
  const openText = files?.find((f) => f.name === name)?.text;
  const [seenText, setSeenText] = useState<string | undefined>(undefined);
  if (openText !== seenText) {
    setSeenText(openText);
    const r = openText !== undefined && seenText !== undefined && !dirty ? parseLayout(openText) : null;
    if (r?.ok && JSON.stringify(r.layout) !== savedJson) {
      setHistory(createHistory(r.layout));
      setSavedJson(JSON.stringify(r.layout));
    }
  }
  useEffect(() => {
    onWorking?.(name && layout ? { name, layout, dirty } : null);
  }, [onWorking, name, layout, dirty]);
  const validation = useMemo(() => (layout ? layoutSchema.safeParse(layout) : null), [layout]);
  const validationError =
    validation && !validation.success
      ? validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : null;
  // Id problems show under the id field of the selected element; the rest in a floating notice.
  const issueSplit = useMemo(
    () =>
      validation && !validation.success && layout
        ? splitIssues(
            validation.error.issues,
            layout.elements.map((e) => e.id),
          )
        : null,
    [validation, layout],
  );

  // 3D texture: always centred on the outer line. The render time is shown next to the mode switch.
  const { canvas: texture, ms: renderMs } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ms = timed(() =>
      renderUnwrap(canvas, profile, mode, layout, {
        pxPerCm: PX_PER_CM,
        grid,
        existing: anubisSize,
        selected: selected ?? undefined,
        aspects,
        sources,
      }),
    );
    return { canvas, ms };
  }, [profile, mode, layout, grid, selected, aspects, sources]);

  // Editor image: centred on the chosen line.
  const editorImage = useMemo(() => {
    if (centerU === 0) return texture;
    const canvas = document.createElement("canvas");
    renderUnwrap(canvas, profile, mode, layout, {
      pxPerCm: PX_PER_CM,
      grid,
      existing: anubisSize,
      selected: selected ?? undefined,
      centerU,
      aspects,
      sources,
    });
    return canvas;
  }, [texture, centerU, profile, mode, layout, grid, selected, aspects, sources]);

  const metrics = useMemo(
    () =>
      layout
        ? coverage(classify(layout, profile, METRICS_PX_PER_CM, anubisSize, 0, aspects, patches), profile)
        : null,
    [layout, profile, aspects, patches],
  );

  const flagsFor = useMemo(() => {
    if (!layout) return [];
    const cls = classify(
      { ...layout, elements: layout.elements },
      profile,
      1,
      anubisSize,
      0,
      aspects,
      patches,
    );
    return cls.resolved.map((r) => r.flags);
  }, [layout, profile, aspects, patches]);
  // Resolved shapes, e.g. to tell whether the selection is fixed by its projection.
  const resolvedEls = useMemo(
    () =>
      layout?.elements.map((el) =>
        resolveElement(el, profile, anubisSize, aspects?.get(el.id), patches?.get(el.id)),
      ) ?? [],
    [layout, profile, aspects, patches],
  );

  const flagged =
    layout?.elements.filter((_, i) => flagsFor[i]?.includes("height not set")).map((e) => e.id) ?? [];

  // Values of the open region that nobody measured (they come from the sample body).
  const fromSample = region === "arm-left" ? arm.placeholders : arm.body.regions[region].fromSample;
  const inputCount = inputKeys(REGIONS[region].kind).length;

  // Export: the saved layout exactly as shown, once every image it uses has loaded.
  const exportInput = useMemo<ExportInput | null>(
    () =>
      layout
        ? {
            layout,
            profile,
            existing: anubisSize,
            aspects,
            sources,
            placeholderMeasurements: fromSample,
            measurementCount: inputCount,
            region,
          }
        : null,
    [layout, profile, aspects, sources, fromSample, inputCount, region],
  );
  const exportBlocked = validationError
    ? "Fix the layout errors first."
    : loadingImages
      ? "Waiting for the reference images to load."
      : null;

  // Every edit goes through the history. `key` coalesces a run of changes (one drag, one typing
  // burst in a field) into one undo step.
  const commit = (fn: (l: Layout) => Layout, key?: string) =>
    setHistory((h) => (h ? push(h, fn(h.present), key ? { coalesceKey: key } : {}) : h));
  const apply = (edit: (l: Layout) => LayoutEdit) => {
    if (!layout) return;
    const r = edit(layout);
    if (r.layout !== layout) commit(() => r.layout);
    setSelected(r.selected);
  };
  const burst = useRef<Burst | null>(null);
  /** The coalesce key for a typing burst in the focused field; clicks on buttons and boxes stay single steps. */
  const typingKey = (target: string): string | undefined => {
    const field = document.activeElement;
    if (!field || !isEditableTarget(field)) return undefined;
    const fieldName =
      field.id || field.getAttribute("aria-label") || field.closest("label")?.textContent || "";
    burst.current = nextBurst(burst.current, `${target}:${fieldName}`, performance.now());
    return burstKey(burst.current);
  };
  const setElement = (index: number, el: LayoutElement, key?: string) =>
    commit((l) => ({ ...l, elements: l.elements.map((e, i) => (i === index ? el : e)) }), key);

  const addElement = (type: ElementType) => {
    if (!layout) return;
    // Each new element lands a little beside the previous one instead of on top of it.
    const at = freeSpot(layout.elements.map(elementAnchor), centerU, 0.5);
    const el = newElement(
      type,
      at.u,
      at.v,
      layout.elements.map((e) => e.id),
    );
    commit((l) => ({ ...l, elements: [...l.elements, el] }));
    setSelected(layout.elements.length);
  };

  const doUndo = () => {
    if (!history || !canUndo(history)) return;
    const h = undo(history);
    setHistory(h);
    setSelected(followSelection(history.present, h.present, selected));
  };
  const doRedo = () => {
    if (!history || !canRedo(history)) return;
    const h = redo(history);
    setHistory(h);
    setSelected(followSelection(history.present, h.present, selected));
  };

  const doSave = async (target: Layout, from?: string): Promise<boolean> => {
    setSaveError(null);
    try {
      await save(target, from);
      setName(target.name);
      setHistory((h) => (h ? reset(h, target) : createHistory(target)));
      setSavedJson(JSON.stringify(target));
      toast.show(target.name === name ? `Saved ${target.name}` : `Saved as a new variant: ${target.name}`);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      toast.show("Save failed", "error");
      return false;
    }
  };

  const saveAs = (newName: string) => {
    if (!layout) return;
    setSaveAsOpen(false);
    // Comments come from the file the variant was opened from.
    void doSave({ ...layout, name: newName }, name ?? undefined);
  };

  const switchTo = (next: string) => {
    if (next === name) return;
    if (dirty) {
      setPendingSwitch({ label: next, go: () => open(next, files) });
      return;
    }
    open(next, files);
  };
  const resolveSwitch = async (choice: "save" | "discard" | "cancel") => {
    const next = pendingSwitch;
    setPendingSwitch(null);
    if (!next || choice === "cancel") return;
    if (choice === "save" && (!layout || !(await doSave(layout)))) return;
    next.go();
  };

  // Variants per region; the picker offers the open region's (plus an unsaved new one).
  const regionByFile = useMemo(
    () => new Map((files ?? []).map((f) => [f.name, layoutRegion(f.text)] as const)),
    [files],
  );
  const variantNames = (files ?? []).filter((f) => regionByFile.get(f.name) === region).map((f) => f.name);
  if (name && !variantNames.includes(name)) variantNames.push(name);
  const countByRegion = (id: RegionId) => (files ?? []).filter((f) => regionByFile.get(f.name) === id).length;

  /**
   * Opens a region: its last or first variant, or a new empty layout that becomes a file on the first
   * save (new layouts get the chosen region).
   */
  const switchRegion = (next: RegionId) => {
    if (next === region) return;
    if (dirty) {
      setPendingSwitch({ label: REGIONS[next].label.toLowerCase(), go: () => openRegion(next) });
      return;
    }
    openRegion(next);
  };
  const openRegion = (next: RegionId) => {
    const names = (files ?? []).filter((f) => regionByFile.get(f.name) === next).map((f) => f.name);
    const last = lastByRegion[next];
    const target = last && names.includes(last) ? last : names[0];
    if (target) return open(target, files);
    const draft: Layout = {
      name: draftName(
        next,
        (files ?? []).map((f) => f.name),
      ),
      region: next,
      elements: [],
    };
    enterRegion(next);
    setName(draft.name);
    setSelected(null);
    setSaveError(null);
    setParseError(null);
    setHistory(createHistory(draft));
    setSavedJson(JSON.stringify(draft));
  };

  // Full-body view: the other regions show their last opened (or first) variant.
  const [bodyTextures, setBodyTextures] = useState<Partial<Record<RegionId, RegionTexture>>>({});
  const onRegionTexture = useCallback(
    (id: RegionId, t: RegionTexture | null) =>
      setBodyTextures((m) => {
        if ((m[id] ?? null) === t) return m;
        return { ...m, [id]: t ?? undefined };
      }),
    [],
  );
  const otherLayouts = useMemo(() => {
    if (view3d !== "body") return [];
    return REGION_IDS.filter((id) => id !== region).flatMap((id) => {
      const names = (files ?? []).filter((f) => regionByFile.get(f.name) === id);
      const file = names.find((f) => f.name === lastByRegion[id]) ?? names[0];
      const r = file ? parseLayout(file.text) : null;
      return r?.ok ? [{ id, layout: r.layout }] : [];
    });
  }, [view3d, region, files, regionByFile, lastByRegion]);

  const sel = selected !== null && layout ? layout.elements[selected] : undefined;
  const appendTarget = appendStrokes && sel?.type === "line" && !sel.locked ? selected : null;
  const onStroke = (samples: UV[]) => {
    if (!layout) return;
    const r = applyStroke(profile, layout, samples, appendTarget, lineColor);
    if (!r) return;
    commit(() => r.layout);
    setSelected(r.index);
  };
  const selAsset: AssetInfo | null | undefined =
    sel && isFigureLike(sel) && sel.asset && assetMap ? (assetMap.get(sel.asset) ?? null) : undefined;
  const assignBlocked = !sel
    ? "Select a figure first, then click an image to assign it."
    : !isFigureLike(sel)
      ? "Only figures and existing tattoos take an image."
      : sel.locked
        ? `${sel.id} is locked: unlock it to change its image.`
        : null;
  const pickAsset = (a: AssetInfo) => {
    if (selected === null || !sel || !isFigureLike(sel) || sel.locked) return;
    if (sel.asset === a.id) return;
    // A new image gets its own cut-out: drop a crop that belonged to the old one. One undo step.
    setElement(selected, { ...sel, asset: a.id, crop: undefined });
  };
  const allAssets = listing?.status === "ok" ? listing.assets : null;
  const canChangeImage = !!sel && isFigureLike(sel) && !sel.locked;
  const stepImage =
    canChangeImage && allAssets && sel && isFigureLike(sel)
      ? (dir: 1 | -1) => {
          const next = stepAsset(allAssets, sel.asset, dir, sel.type === "existing" ? "existing" : undefined);
          if (next) pickAsset(next);
        }
      : null;
  const canStep =
    !!stepImage && !!sel && isFigureLike(sel) && stepAsset(allAssets ?? [], sel.asset, 1) !== null;
  // The picker belongs to the selection: it closes when the selection changes.
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  if (pickerAnchor && pickerFor !== selected) {
    setPickerAnchor(null);
    setPickerFor(null);
  }
  const openPicker = (anchor: HTMLElement) => {
    setPickerFor(selected);
    setPickerAnchor((a) => (a === anchor ? null : anchor));
  };

  const deleteSelected = () => {
    if (selected === null || !sel || sel.locked) return;
    apply((l) => deleteAt(l, selected));
    toast.show(`Deleted ${sel.id} (${keyHint("Mod+Z")} to undo)`, "info");
  };

  const canSave = dirty && !validationError;
  const selFixed = !!sel?.locked || (selected !== null && resolvedEls[selected]?.shape.kind === "patch");
  const runShortcut = (a: ShortcutAction) => {
    switch (a.type) {
      case "save":
        if (canSave && layout) void doSave(layout);
        else if (!dirty) toast.show("No unsaved changes", "info");
        return;
      case "undo":
        return doUndo();
      case "redo":
        return doRedo();
      case "help":
        return setHelpOpen((o) => !o);
      case "tool":
        // The brush draws on the region view only.
        if (a.tool === "draw") setView3d("region");
        return setDrawing(a.tool === "draw" ? (d) => !d : false);
      case "deselect":
        if (pickerAnchor) setPickerAnchor(null);
        else if (drawing) setDrawing(false);
        else if (helpOpen) setHelpOpen(false);
        else setSelected(null);
        return;
    }
    if (selected === null || !sel) return;
    switch (a.type) {
      case "duplicate":
        if (sel.locked) return toast.show(`${sel.id} is locked`, "info");
        return apply((l) => duplicateAt(l, selected));
      case "delete":
        if (sel.locked) return toast.show(`${sel.id} is locked: unlock it to delete`, "info");
        return deleteSelected();
      case "layerUp":
        return apply((l) => moveLayer(l, selected, 1));
      case "layerDown":
        return apply((l) => moveLayer(l, selected, -1));
      case "nudge": {
        if (selFixed)
          return toast.show(`${sel.id} is ${sel.locked ? "locked" : "placed by its projection"}`, "info");
        const { dxCm, dyCm } = nudgeStepCm(a.dx, a.dy, a.big);
        burst.current = nextBurst(burst.current, `nudge:${selected}`, performance.now());
        return setElement(selected, nudgeElement(sel, profile, dxCm, dyCm), burstKey(burst.current));
      }
    }
  };
  useLayoutShortcuts(rootRef, runShortcut);

  // Element list: a warning dot per element.
  const assetIds = useMemo(
    () => (listing?.status === "ok" ? new Set(listing.assets.map((a) => a.id)) : null),
    [listing],
  );
  const issues =
    layout?.elements.map((el, i) => elementIssues(el, flagsFor[i] ?? [], assetIds, patchIssues.get(el.id))) ??
    [];

  // Errors stay as banners; warnings fold into one compact group when there are several.
  const warnings: { key: string; text: ReactNode }[] = [
    ...(fromSample.length > 0
      ? [
          {
            key: "placeholder",
            text: (
              <>
                Placeholder {region === "arm-left" ? "body" : REGIONS[region].label.toLowerCase()}:{" "}
                {fromSample.length} of {inputCount} values not measured yet; proportions come from the{" "}
                {SAMPLES[arm.body.body].label.toLowerCase()} until the measurements are filled in (Settings →
                Body &amp; measurements).
              </>
            ),
          },
        ]
      : []),
    ...[...patchIssues].map(([id, issue]) => ({
      key: `patch-${id}`,
      text: (
        <>
          {id}: {patches.has(id) ? "" : "projection not shown, the element's own box is used instead: "}
          {issue}.
        </>
      ),
    })),
    ...(flagged.length > 0
      ? [{ key: "height", text: <>Height not set, shown at 10 cm: {flagged.join(", ")}.</> }]
      : []),
  ];
  // Id errors of the selected element show under its id field; everything else floats as a notice.
  const otherIssues = issueSplit
    ? [
        ...[...issueSplit.idErrors]
          .filter(([i]) => i !== selected)
          .map(([i, msg]) => `${layout?.elements[i]?.id ?? `element ${i + 1}`}: ${msg}`),
        ...issueSplit.other.map((o) => o.text),
      ]
    : [];
  const errors = !!(loadError || parseError || saveError || otherIssues.length > 0);

  const kbdSave = keyHint("Mod+S");
  const assetCount = listing?.status === "ok" ? listing.assets.length : null;

  // Top bar, left of the data-folder chip: the warnings as one chip with a popover.
  const noticesChip = warnings.length > 0 && (
    <span className="popover-anchor">
      <button
        type="button"
        className="chip warn"
        aria-expanded={noticesOpen}
        aria-haspopup="dialog"
        onClick={() => setNoticesOpen((o) => !o)}
        title={warnings.length === 1 ? undefined : "Show the notices"}
      >
        <WarnIcon />
        {warnings.length} {warnings.length === 1 ? "notice" : "notices"}
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
          {warnings.map((w) => (
            <li key={w.key}>{w.text}</li>
          ))}
        </ul>
      </Popover>
    </span>
  );

  // Top bar, right of the data-folder chip: variant, undo/redo, save, export.
  const headerActions = (
    <>
      <span className="header-sep" aria-hidden="true" />
      <span className="select-wrap" title="Body region: each layout belongs to one">
        <select
          className="region-select"
          aria-label="Body region"
          value={region}
          onChange={(e) => switchRegion(e.target.value as RegionId)}
          disabled={!files}
        >
          {REGION_IDS.map((id) => (
            <option key={id} value={id}>
              {REGIONS[id].label}
              {files ? ` (${countByRegion(id)})` : ""}
            </option>
          ))}
        </select>
      </span>
      <span className="popover-anchor">
        <span className="select-wrap" title={dirty ? "Unsaved edits" : undefined}>
          <select
            className="variant-select"
            aria-label="Variant"
            value={name ?? ""}
            onChange={(e) => switchTo(e.target.value)}
            disabled={!files}
          >
            {variantNames.map((n) => (
              <option key={n} value={n}>
                {n}
                {files && !files.some((f) => f.name === n) ? " (new)" : ""}
              </option>
            ))}
          </select>
          {dirty && <span className="dirty-dot" role="img" aria-label="unsaved changes" />}
        </span>
        <Popover
          open={pendingSwitch !== null}
          onClose={() => void resolveSwitch("cancel")}
          label="Unsaved changes"
          className="switch-popover"
        >
          <p className="popover-title">Unsaved changes in {name}</p>
          <p className="muted small">Save them before opening {pendingSwitch?.label}?</p>
          <div className="toolbar">
            <button
              type="button"
              className="primary"
              data-autofocus
              disabled={!canSave}
              title={canSave ? undefined : "Fix the layout errors first"}
              onClick={() => void resolveSwitch("save")}
            >
              Save
            </button>
            <button type="button" className="danger" onClick={() => void resolveSwitch("discard")}>
              Discard
            </button>
            <button type="button" className="ghost" onClick={() => void resolveSwitch("cancel")}>
              Cancel
            </button>
          </div>
        </Popover>
      </span>
      <button
        type="button"
        className="ghost icon-button"
        onClick={doUndo}
        disabled={!history || !canUndo(history)}
        aria-label="Undo"
        title={`Undo (${keyHint("Mod+Z")})`}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="ghost icon-button"
        onClick={doRedo}
        disabled={!history || !canRedo(history)}
        aria-label="Redo"
        title={`Redo (${keyHint("Shift+Mod+Z")})`}
      >
        <RedoIcon />
      </button>
      <span className="header-sep" aria-hidden="true" />
      <span className="popover-anchor">
        <button
          type="button"
          onClick={() => setSaveAsOpen((o) => !o)}
          disabled={!layout || !!validationError}
          aria-expanded={saveAsOpen}
          aria-haspopup="dialog"
          title="Save what you see as a new variant to try an alternative"
        >
          Save as…
        </button>
        <Popover
          open={saveAsOpen && !!layout}
          onClose={() => setSaveAsOpen(false)}
          label="Save as"
          align="end"
        >
          {layout && (
            <SaveAsForm
              suggested={suggestVariantName(
                layout.name,
                (files ?? []).map((f) => f.name),
              )}
              taken={(files ?? []).map((f) => f.name)}
              current={name}
              onSave={saveAs}
              onCancel={() => setSaveAsOpen(false)}
            />
          )}
        </Popover>
      </span>
      <button
        type="button"
        className={dirty ? "primary" : ""}
        onClick={() => layout && void doSave(layout)}
        disabled={!canSave}
        aria-keyshortcuts={platform === "mac" ? "Meta+S" : "Control+S"}
        title={dirty ? `Save the changes to the variant's YAML file (${kbdSave})` : "No unsaved changes"}
      >
        Save <kbd className="kbd">{kbdSave}</kbd>
      </button>
      <ExportButton
        input={exportInput}
        blocked={exportBlocked}
        saveFirst={dirty && canSave && layout ? () => doSave(layout) : null}
        statusTarget={statusSlot}
      />
    </>
  );

  return (
    <div className="layout-page" ref={rootRef}>
      {active && header?.notices && noticesChip && createPortal(noticesChip, header.notices)}
      {active && header?.actions && createPortal(headerActions, header.actions)}
      {!header && (
        <div className="toolbar layout-toolbar">
          {noticesChip}
          {headerActions}
        </div>
      )}

      {/* Floats over the workspace instead of pushing it down. */}
      {errors && (
        <div className="notices layout-errors">
          {loadError && <p className="notice error">{loadError}</p>}
          {parseError && (
            <p className="notice error" role="alert">
              <strong>Variant {name} cannot be opened:</strong> {parseError}
            </p>
          )}
          {otherIssues.length > 0 && (
            <p className="notice error">Cannot save yet: {otherIssues.join("; ")}</p>
          )}
          {saveError && <p className="notice error">Save failed: {saveError}</p>}
        </div>
      )}

      {layout && (
        <div className="workspace">
          <aside className="tool-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
            <button
              type="button"
              className="tool"
              aria-pressed={!drawing}
              aria-label="Select and move"
              aria-keyshortcuts="V"
              onClick={() => setDrawing(false)}
            >
              <SelectIcon />
              <span className="tool-key" aria-hidden="true">
                V
              </span>
              <span className="tip" aria-hidden="true">
                Select &amp; move <kbd className="kbd">V</kbd>
              </span>
            </button>
            <span className="rail-sep" aria-hidden="true" />
            <span className="rail-label" aria-hidden="true">
              Add
            </span>
            {ADD_TOOLS.map((t) => (
              <button
                key={t.type}
                type="button"
                className="tool"
                aria-label={`Add ${t.label.toLowerCase()}`}
                onClick={() => addElement(t.type)}
              >
                {t.icon}
                <span className="tip" aria-hidden="true">
                  Add {t.label.toLowerCase()}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="tool draw-tool"
              aria-pressed={drawing}
              aria-label="Line: draw on the 3D view"
              aria-keyshortcuts="R"
              onClick={() => {
                setView3d("region");
                setDrawing((d) => !d);
              }}
            >
              <RedLineIcon />
              <span className="tool-key" aria-hidden="true">
                R
              </span>
              <span className="tip" aria-hidden="true">
                Line: draw on the 3D view <kbd className="kbd">R</kbd>
              </span>
            </button>
            <span className="spacer" />
            <span className="popover-anchor">
              <button
                type="button"
                className="tool"
                aria-label="Keyboard shortcuts"
                aria-expanded={helpOpen}
                aria-haspopup="dialog"
                aria-keyshortcuts="?"
                onClick={() => setHelpOpen((o) => !o)}
              >
                <HelpIcon />
                <span className="tip" aria-hidden="true">
                  Keyboard shortcuts <kbd className="kbd">?</kbd>
                </span>
              </button>
              <Popover
                open={helpOpen}
                onClose={() => setHelpOpen(false)}
                label="Keyboard shortcuts"
                className="shortcuts-popover side"
              >
                <p className="popover-title">Keyboard shortcuts</p>
                <dl className="shortcut-list">
                  {SHORTCUTS.map((s) => (
                    <div key={s.description}>
                      <dt>
                        {s.keys.map((k) => (
                          <kbd key={k}>{keyHint(k)}</kbd>
                        ))}
                      </dt>
                      <dd>{s.description}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>
                      <kbd>{platform === "mac" ? "⌥" : "Alt"}</kbd>
                      <span className="kbd-plus">+ click</span>
                    </dt>
                    <dd>Select the element underneath (2D editor)</dd>
                  </div>
                </dl>
                <p className="faint small">Inactive while typing in a field, except save.</p>
              </Popover>
            </span>
          </aside>

          <section className="ws-2d" aria-label="2D editor">
            <UnwrapEditor
              key={`${region}:${profile.length}:${profile.maxCircumference}`}
              profile={profile}
              lines={REGIONS[region].lines}
              layout={layout}
              existing={anubisSize}
              aspects={aspects}
              patches={patches}
              image={editorImage}
              version={0}
              centerU={centerU}
              selected={selected}
              onSelect={setSelected}
              onChange={setElement}
              onGestureEnd={() => setHistory((h) => (h ? seal(h) : h))}
              onCursor={cursor.set}
              onZoom={zoom.set}
              fitRequest={fitRequest}
              hint={false}
              selectionAction={
                canChangeImage ? (
                  <button
                    type="button"
                    className="change-image-float"
                    onClick={(e) => openPicker(e.currentTarget)}
                    aria-expanded={!!pickerAnchor}
                    title="Pick another image for this figure"
                  >
                    <ImageIcon />
                    Change image
                  </button>
                ) : undefined
              }
            />
            <div className="float float-bar ws-2d-bar">
              <span className="segmented" role="group" aria-label="Mode" title={HINTS[mode]}>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={mode === m.id ? "active" : ""}
                    aria-pressed={mode === m.id}
                    onClick={() => setMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </span>
              {DEBUG && (
                <span
                  className="render-ms mono"
                  data-render-ms={renderMs.toFixed(1)}
                  title="Texture render time"
                >
                  {Math.round(renderMs)} ms
                </span>
              )}
              <span className="toolbar-sep" aria-hidden="true" />
              <label className="inline switch-label" title="1 cm grid over the skin, bold every 5 cm">
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={grid}
                  onChange={(e) => setGrid(e.target.checked)}
                />
                Grid
              </label>
              <span className="toolbar-sep" aria-hidden="true" />
              <span
                className="segmented"
                role="group"
                aria-label="Editor centre"
                title="Centre of the 2D editor"
              >
                {editorCentres(region).map((c) => (
                  <button
                    key={c.u}
                    type="button"
                    className={centerU === c.u ? "active" : ""}
                    aria-pressed={centerU === c.u}
                    onClick={() => setCenterU(c.u)}
                    title={c.title}
                  >
                    {c.label}
                  </button>
                ))}
              </span>
            </div>
            <StatusBar
              cursor={cursor}
              zoom={zoom}
              fallback={sel ? elementAnchor(sel) : null}
              format={(p) => formatPointCm(profile, p, regionNames(region))}
              onFit={() => setFitRequest((n) => n + 1)}
            />
          </section>

          <section className="ws-3d" aria-label="3D view" ref={setPane3d}>
            {view3d === "body" && (
              <>
                {otherLayouts.map((o) => (
                  <RegionTextureSource
                    key={o.id}
                    id={o.id}
                    layout={o.layout}
                    profile={arm.region(o.id)}
                    mode={mode}
                    grid={grid}
                    existing={anubisSize}
                    assetMap={assetMap}
                    listingLoaded={listing !== null}
                    onTexture={onRegionTexture}
                  />
                ))}
                <BodyViewer
                  body={arm.body}
                  textures={{
                    ...Object.fromEntries(otherLayouts.map((o) => [o.id, bodyTextures[o.id]])),
                    [region]: { canvas: texture, version: 0 },
                  }}
                  active={region}
                  onPick={(id) => {
                    switchRegion(id);
                  }}
                  toolbarTarget={viewerToolbar}
                  frameAround={pane3d}
                />
              </>
            )}
            {view3d === "region" && (
              <ArmViewer
                profile={profile}
                canvas={texture}
                version={0}
                hint={HINTS[mode]}
                bendDeg={pose.bendDeg}
                draw={{ active: drawing, onStroke }}
                toolbarTarget={viewerToolbar}
                screenshotInToolbar
                footer={false}
                frameAround={pane3d}
                overlay={
                  drawing && (
                    <div className="canvas-toolbar top">
                      <span className="draw-color">
                        Colour <ColorField value={lineColor} onChange={setLineColor} />
                      </span>
                      {sel?.type === "line" && !sel.locked && (
                        <label className="inline check">
                          <input
                            type="checkbox"
                            checked={appendStrokes}
                            onChange={(e) => setAppendStrokes(e.target.checked)}
                          />
                          continue {sel.id}
                        </label>
                      )}
                      <span>
                        {appendTarget !== null
                          ? `Strokes extend ${sel?.id} at its nearer end.`
                          : "Each stroke becomes a new line."}{" "}
                        <span className="muted">Rotation is off (right-drag pans, scroll zooms).</span>
                      </span>
                    </div>
                  )
                }
              />
            )}
            <div className="float float-bar ws-3d-bar" title={`${ORBIT_HINT} ${HINTS[mode] ?? ""}`}>
              <span className="segmented" role="group" aria-label="3D view">
                <button
                  type="button"
                  className={view3d === "region" ? "active" : ""}
                  aria-pressed={view3d === "region"}
                  onClick={() => setView3d("region")}
                  title={`Only the ${REGIONS[region].label.toLowerCase()}, with the fixed views`}
                >
                  {REGIONS[region].label}
                </button>
                <button
                  type="button"
                  className={view3d === "body" ? "active" : ""}
                  aria-pressed={view3d === "body"}
                  onClick={() => {
                    setDrawing(false);
                    setView3d("body");
                  }}
                  title="The whole body with every region's layout; click a region to edit it"
                >
                  Full body
                </button>
              </span>
              <span className="toolbar-sep" aria-hidden="true" />
              <div ref={setViewerToolbar} className="viewer-tools" />
            </div>
            {view3d === "region" && profile.kind === "arm" && (
              <div className="float pose-panel">
                <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} variant="panel" />
              </div>
            )}
            {metrics && <MetricsPanel coverage={metrics} variant="float" />}

            <div className="ws-stack">
              <section className="float side-tabs" aria-label="Elements and assets">
                <div className="float-head" role="tablist" aria-label="Side panel">
                  <button
                    type="button"
                    role="tab"
                    id="side-tab-elements"
                    aria-selected={sideTab === "elements"}
                    aria-controls="side-panel-elements"
                    className="panel-tab"
                    onClick={() => setSideTab("elements")}
                  >
                    <LayersIcon />
                    Elements <span className="count">{layout.elements.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="side-tab-assets"
                    aria-selected={sideTab === "assets"}
                    aria-controls="side-panel-assets"
                    className="panel-tab"
                    onClick={() => setSideTab("assets")}
                  >
                    <ImageIcon />
                    Assets {assetCount !== null && <span className="count">{assetCount}</span>}
                  </button>
                  <span className="spacer" />
                  {sideTab === "elements" ? (
                    <span
                      className="faint xs"
                      title="The list shows the top layer first; drag a row to change the order."
                    >
                      top first
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="ghost small-button"
                      onClick={reloadAssets}
                      title="Look for new images in the project folder, then re-read manifest.yaml and the images"
                    >
                      Reload
                    </button>
                  )}
                </div>
                <div
                  className="side-tab-body"
                  role="tabpanel"
                  id={`side-panel-${sideTab}`}
                  aria-labelledby={`side-tab-${sideTab}`}
                >
                  {sideTab === "elements" ? (
                    <ElementList
                      heading={false}
                      elements={layout.elements}
                      issues={issues}
                      selected={selected}
                      onSelect={setSelected}
                      onToggleLock={(i) => {
                        const el = layout.elements[i]!;
                        setElement(i, { ...el, locked: el.locked ? undefined : true });
                      }}
                      onMove={(from, to) => apply((l) => moveLayerTo(l, from, to))}
                    />
                  ) : (
                    <AssetBrowser
                      heading={false}
                      listing={listing}
                      onReload={reloadAssets}
                      note={scanNote}
                      current={sel && isFigureLike(sel) ? sel.asset : undefined}
                      assignBlocked={assignBlocked}
                      onPick={pickAsset}
                    />
                  )}
                </div>
              </section>
              <div className="float inspector">
                {sel && selected !== null ? (
                  <ElementPanel
                    element={sel}
                    asset={selAsset}
                    autoFilter={isFigureLike(sel) ? defaultFilter(sel, profile) : "none"}
                    flags={flagsFor[selected] ?? []}
                    positionCm={formatPositionCm(profile, sel, regionNames(region))}
                    index={selected}
                    count={layout.elements.length}
                    onChange={(el) => setElement(selected, el, typingKey(`el${selected}`))}
                    onLayer={(dir) => apply((l) => moveLayer(l, selected, dir))}
                    onDelete={deleteSelected}
                    onDuplicate={() => apply((l) => duplicateAt(l, selected))}
                    onChangeImage={canChangeImage ? openPicker : undefined}
                    onStepImage={canStep ? stepImage : null}
                    idError={issueSplit?.idErrors.get(selected) ?? null}
                    keys={{
                      duplicate: keyHint("Mod+D"),
                      delete: "Delete",
                      forward: "]",
                      back: "[",
                    }}
                  />
                ) : (
                  <section className="panel variant-panel">
                    <div className="panel-head inspector-head">
                      <h2>{layout.name}</h2>
                      <span className="faint">variant</span>
                      <span className="spacer" />
                      {dirty && <span className="chip warn">unsaved</span>}
                    </div>
                    <label className="props">
                      description
                      <textarea
                        rows={3}
                        value={layout.description ?? ""}
                        onChange={(e) =>
                          commit(
                            (l) => ({ ...l, description: e.target.value || undefined }),
                            typingKey("description"),
                          )
                        }
                      />
                    </label>
                    <p className="muted small">
                      {layout.elements.length} elements. Select one in the list or the editor to edit it.
                    </p>
                  </section>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
      {pickerAnchor && sel && isFigureLike(sel) && (
        <ImagePicker
          listing={listing}
          current={sel.asset}
          elementId={sel.id}
          anchor={pickerAnchor}
          onPick={(a) => {
            pickAsset(a);
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      <div className="status-stack">
        <div ref={setStatusSlot} className="export-status-slot" />
        <ToastRegion toast={toast} />
      </div>
    </div>
  );
}

/** Bottom of the 2D view: the skin point under the cursor (or the selection's anchor), zoom and Fit. */
function StatusBar(props: {
  cursor: ValueStore<SkinUV | null>;
  zoom: ValueStore<number>;
  fallback: SkinUV | null;
  format: (p: SkinUV) => string;
  onFit: () => void;
}) {
  const hover = useValue(props.cursor);
  const zoom = useValue(props.zoom);
  const p = hover ?? props.fallback;
  return (
    <div className="float status-bar" title={EDITOR_HINT}>
      {p ? (
        <>
          <span className="mono">u {p.u.toFixed(2)}</span>
          <span className="mono">v {p.v.toFixed(2)}</span>
          <span className="faint status-cm">{props.format(p)}</span>
        </>
      ) : (
        <span className="faint">Point at the skin to read its position.</span>
      )}
      <span className="spacer" />
      <button
        type="button"
        className="ghost icon-button small-button"
        onClick={props.onFit}
        aria-label="Fit the whole sheet"
        title="Fit the whole sheet (double-click the background)"
      >
        <FitIcon />
      </button>
      <span className="mono faint" aria-label={`Zoom ${zoom}%`}>
        {zoom}%
      </span>
    </div>
  );
}
