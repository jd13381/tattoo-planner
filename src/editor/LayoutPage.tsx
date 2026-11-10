import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AssetBrowser } from "../assets/AssetBrowser.tsx";
import { ImagePicker } from "../assets/ImagePicker.tsx";
import { assetImageUrl, type AssetInfo } from "../assets/types.ts";
import { useAssetListing } from "../assets/useAssets.ts";
import { useLayoutSources } from "../assets/useLayoutSources.ts";
import { SHOW_ELEMENT_EVENT, type ShowElement } from "../assets/navigation.ts";
import { defaultFilter, isFigureLike } from "../layout/imageFit.ts";
import { layoutSchema, type ElementType, type Layout, type LayoutElement } from "../layout/schema.ts";
import { classify, resolveElement } from "../layout/shapes.ts";
import { useLayouts, type StoredLayout, type WorkingLayout } from "../layout/useLayouts.ts";
import { activeVariant } from "../project/persons.ts";
import { usePersons, setActiveVariant } from "../project/personsStore.ts";
import { projectStatus } from "../project/projectData.ts";
import { layoutRegion, parseLayout } from "../layout/yamlDoc.ts";
import { coverage } from "../metrics/coverage.ts";
import { MetricsPanel } from "../metrics/MetricsPanel.tsx";
import { renderUnwrap, timed, type RenderMode } from "../render/unwrapCanvas.ts";
import { ExportButton } from "../export/ExportButton.tsx";
import type { ExportInput } from "../export/runExport.ts";
import { supportsBend } from "../body/bend.ts";
import { inputKeys } from "../body/inputs.ts";
import { DEFAULT_REGION, editorCentres, REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import { SAMPLES } from "../body/samples.ts";
import { ArmViewer, ORBIT_HINT, PoseControl } from "../viewer/ArmViewer.tsx";
import { BodyViewer, type RegionTexture } from "../viewer/BodyViewer.tsx";
import { anubisSize, type ArmState, type Pose } from "../viewer/useArm.ts";
import { Popover } from "../ui/Popover.tsx";
import {
  BandIcon,
  ChevronLeftIcon,
  ExistingIcon,
  FigureIcon,
  FillerIcon,
  HelpIcon,
  HomeIcon,
  ImageIcon,
  LayersIcon,
  RedLineIcon,
  RedoIcon,
  SelectIcon,
  StarIcon,
  UndoIcon,
  WarnIcon,
} from "../ui/icons.tsx";
import { createValueStore, useValue, type ValueStore } from "../ui/valueStore.ts";
import { ToastRegion, useToast } from "../ui/Toast.tsx";
import { freeSpot, newElement, suggestVariantName } from "./edit.ts";
import { GridIcon, MinusIcon, PlusSmallIcon, SidePanelIcon, TargetIcon } from "./editorIcons.tsx";
import { countNoun, elementSummary, KIND_HELP, KIND_LABEL, KIND_SHORT } from "./labels.ts";
import { readFlag, writeFlag } from "./viewPrefs.ts";
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
import { CATALOGUE_ERROR, STANDARD_BACKGROUNDS } from "../assets/useStandardBackgrounds.ts";
import {
  addLayer,
  deleteLayer,
  duplicateLayer,
  moveLayerTo as moveBackground,
  removeShape,
  setLayer,
} from "./backgroundOps.ts";
import {
  AddLayerMenu,
  BACKGROUND_TOOLS,
  LayerList,
  LayerPanel,
  type BackgroundTool,
} from "./LayersPanel.tsx";
import { patternInfo } from "../render/backgrounds/catalogue.ts";
import type { MotifDisplay } from "../render/reference.ts";
import type { BackgroundLayer, BackgroundSource } from "../layout/schema.ts";
import { SaveAsForm } from "./SaveAsForm.tsx";
import { formatKeys, isEditableTarget, SHORTCUTS, type ShortcutAction } from "./shortcuts.ts";
import { applyStroke, type UV } from "./stroke.ts";
import { BACKGROUND_HINT, EDITOR_HINT, UnwrapEditor } from "./UnwrapEditor.tsx";
import { currentPlatform, useLayoutShortcuts } from "./useLayoutShortcuts.ts";

// "cm grid" is gone from the switch: Blockout with Grid on shows the same grid with the layout.
const MODES: { id: RenderMode; label: string }[] = [
  { id: "reference", label: "Reference" },
  { id: "blockout", label: "Blockout" },
];

/** `?debug` in the URL shows developer readouts (the texture render time). */
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");

const HINTS: Record<RenderMode, string | undefined> = {
  blockout:
    "Dark grey: figures, light grey: background layers, striped: bands, red: lines, outlined: existing tattoo.",
  reference:
    "Reference images cut to their boxes (grayscale on the forearm by default), background layers under the motifs, patterns for bands, lines on top.",
  grid: undefined,
};

/** Texture and editor resolution; blockout shapes are flat, so 12 px per cm is plenty. */
const PX_PER_CM = 12;
/** Metrics resolution: 6 px per cm gives areas within a fraction of a percent. */
const METRICS_PX_PER_CM = 6;

/** The tool rail's add buttons, in rail order, with their keys. Lines are drawn with the Line tool. */
const ADD_TOOLS: { type: "figure" | "existing" | "band"; icon: ReactNode; key: string }[] = [
  { type: "figure", icon: <FigureIcon />, key: "F" },
  { type: "existing", icon: <ExistingIcon />, key: "T" },
  { type: "band", icon: <BandIcon />, key: "B" },
];

const READ_ONLY_HINT =
  "The sample is read-only: try anything, nothing is saved. Create your own project to keep a layout (Settings → Project).";

/** Remembered view choices (src/editor/viewPrefs.ts). */
const COVERAGE_KEY = "layout.coverage";
const SIDE_PANEL_KEY = "layout.sidePanel";

/** The body of a tool's tooltip: its name with the key, and one line on what it does. */
function ToolTip({ name, keys, children }: { name: string; keys?: string; children: ReactNode }) {
  return (
    <span className="tip" aria-hidden="true">
      <span className="rt-head">
        <span className="rt-name">{name}</span>
        {keys && <kbd className="kbd">{keys}</kbd>}
      </span>
      <span className="rt-desc">{children}</span>
    </span>
  );
}

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
  /**
   * Opens a region from elsewhere (Home): its `variant`, or with null its last opened or active
   * one. A new `nonce` asks again for the same region.
   */
  openRequest?: LayoutRequest | null;
  /**
   * Set while the tab was opened from Home: the picker then starts with "‹ Home › person ›", and Esc
   * with nothing left to clear (selection, Draw mode, a popover) returns there.
   */
  onBackToHome?: () => void;
};

/** A request to open a region's layout in the Layout tab (Home → region card). */
export type LayoutRequest = { region: RegionId; variant: string | null; nonce: number };

export function LayoutPage({
  arm,
  pose,
  onWorking,
  active = true,
  header,
  openRequest,
  onBackToHome,
}: Props) {
  const { current: person } = usePersons();
  const readOnlyProject = projectStatus?.sample === true;
  const activeMap = useMemo(() => person?.active ?? {}, [person]);
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
  const [sideTab, setSideTab] = useState<"elements" | "layers" | "assets">("elements");
  // Background layers (docs/adr/0019): the Background view edits them with the motifs dimmed.
  const [view, setView] = useState<"motifs" | "background">("motifs");
  const [showMotifs, setShowMotifs] = useState(true);
  const [selLayer, setSelLayer] = useState<number | null>(null);
  const [bgTool, setBgTool] = useState<BackgroundTool>("select");
  const [brushCm, setBrushCm] = useState(1);
  const [selShape, setSelShape] = useState<number | null>(null);
  // Former fillers read as background layers when the variant was opened (written so on save).
  const [converted, setConverted] = useState<string[]>([]);
  const inBackground = view === "background";
  const motifs2d: MotifDisplay = !showMotifs ? "hide" : inBackground ? "dim" : "show";
  const motifs3d: MotifDisplay = showMotifs ? "show" : "hide";
  const enterView = (v: "motifs" | "background") => {
    setView(v);
    setSideTab(v === "background" ? "layers" : "elements");
    if (v === "background") setDrawing(false);
  };
  const [fitRequest, setFitRequest] = useState(0);
  const [zoomRequest, setZoomRequest] = useState({ factor: 1, nonce: 0 });
  const zoomBy = (factor: number) => setZoomRequest((z) => ({ factor, nonce: z.nonce + 1 }));
  // The coverage table folds into a one-line summary; the side panel can be put away on a narrow
  // window (it is always shown on a wide one). Both choices are remembered.
  const [coverageOpen, setCoverageOpen] = useState(() => readFlag(COVERAGE_KEY, false));
  const [panelOpen, setPanelOpen] = useState(() => readFlag(SIDE_PANEL_KEY, true));
  // On a narrow window the open table and the side panel would cover each other: opening one puts
  // the other away.
  const narrow = () => window.matchMedia("(max-width: 1279px)").matches;
  const setCoverage = (open: boolean) => {
    writeFlag(COVERAGE_KEY, open);
    setCoverageOpen(open);
  };
  const showPanel = (open: boolean) => {
    writeFlag(SIDE_PANEL_KEY, open);
    setPanelOpen(open);
    if (open && coverageOpen && narrow()) setCoverage(false);
  };
  const toggleCoverage = () => {
    if (!coverageOpen && panelOpen && narrow()) showPanel(false);
    setCoverage(!coverageOpen);
  };
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
    setSelLayer(null);
    setSelShape(null);
    setSaveError(null);
    setConverted(r.ok ? (r.converted ?? []) : []);
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
    // Open the left arm's active variant (else v1-baseline, else the first variant) once the list
    // arrives.
    const marked = activeMap[DEFAULT_REGION];
    const first =
      list.find((f) => f.name === marked && layoutRegion(f.text) === DEFAULT_REGION) ??
      list.find((f) => f.name === "v1-baseline") ??
      list[0];
    if (first) open(first.name, list);
  });

  // Assets: the manifest listing and the decoded images of every asset the layout uses.
  const { listing, reload: reloadAssets, scanNote } = useAssetListing();
  const allAssets = listing?.status === "ok" ? listing.assets : null;
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
        selected: inBackground ? undefined : (selected ?? undefined),
        aspects,
        sources,
        motifs: motifs3d,
      }),
    );
    return { canvas, ms };
  }, [profile, mode, layout, grid, selected, aspects, sources, motifs3d, inBackground]);

  // Editor image: centred on the chosen line.
  const editorImage = useMemo(() => {
    if (centerU === 0 && motifs2d === motifs3d) return texture;
    const canvas = document.createElement("canvas");
    renderUnwrap(canvas, profile, mode, layout, {
      pxPerCm: PX_PER_CM,
      grid,
      existing: anubisSize,
      selected: inBackground ? undefined : (selected ?? undefined),
      centerU,
      aspects,
      sources,
      motifs: motifs2d,
    });
    return canvas;
  }, [
    texture,
    centerU,
    profile,
    mode,
    layout,
    grid,
    selected,
    aspects,
    sources,
    motifs2d,
    motifs3d,
    inBackground,
  ]);

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

  // Background layers: one undo history with the elements.
  const layers = layout?.backgrounds ?? [];
  const selLayerObj: BackgroundLayer | undefined = selLayer !== null ? layers[selLayer] : undefined;
  const setLayerAt = (i: number, b: BackgroundLayer, key?: string) => commit((l) => setLayer(l, i, b), key);
  const applyLayers = (edit: (l: Layout) => { layout: Layout; selected: number | null }) => {
    if (!layout) return;
    const r = edit(layout);
    if (r.layout !== layout) commit(() => r.layout);
    setSelLayer(r.selected);
    setSelShape(null);
  };
  const onAddLayer = (source: BackgroundSource) => {
    applyLayers((l) => addLayer(l, source));
    enterView("background");
  };
  const labelOf = (n: string) =>
    patternInfo(n)?.label ?? STANDARD_BACKGROUNDS.find((s) => s.name === n)?.label;
  const layerIssues = useMemo(() => {
    const out = new Map<string, string>();
    for (const b of layout?.backgrounds ?? []) {
      const s = b.source;
      if ("image" in s) {
        const info = assetMap?.get(s.image);
        const img = sources.images.get(s.image);
        if (!assetMap) out.set(b.id, `${s.image}: no project images available`);
        else if (!info) out.set(b.id, `${s.image}: not in the project's images`);
        else if (!info.exists) out.set(b.id, `${s.image}: file missing`);
        else if (img?.status === "error") out.set(b.id, `${s.image}: ${img.message}`);
      } else if ("standard" in s && !STANDARD_BACKGROUNDS.some((x) => x.name === s.standard))
        out.set(b.id, `unknown standard background ${s.standard}: nothing is drawn`);
      if ((b.cover ?? "region") === "area" && !b.shapes?.length && !b.mask?.length)
        out.set(b.id, "empty area: draw a shape or paint with the brush (or switch to Whole region)");
    }
    return out;
  }, [layout, assetMap, sources]);

  // Background view tool keys (M rect, E ellipse, P polygon, B brush, X eraser; V is the select tool).
  useEffect(() => {
    if (!inBackground || !active) return;
    const keys: Record<string, BackgroundTool> = {
      m: "rect",
      e: "ellipse",
      p: "polygon",
      b: "brush",
      x: "eraser",
    };
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      const t = keys[e.key.toLowerCase()];
      if (t) {
        e.preventDefault();
        setBgTool(t);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [inBackground, active]);

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
      setConverted([]);
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
  // "Used in" links of the Assets tab: open that layout and select the element.
  const [pendingShow, setPendingShow] = useState<ShowElement | null>(null);
  const switchToRef = useRef(switchTo);
  useEffect(() => {
    switchToRef.current = switchTo;
  });
  useEffect(() => {
    const onShow = (e: Event) => {
      const target = (e as CustomEvent<ShowElement>).detail;
      setPendingShow(target);
      switchToRef.current(target.layout);
    };
    window.addEventListener(SHOW_ELEMENT_EVENT, onShow);
    return () => window.removeEventListener(SHOW_ELEMENT_EVENT, onShow);
  }, []);
  if (pendingShow && layout && name === pendingShow.layout) {
    const index = layout.elements.findIndex((el) => el.id === pendingShow.element);
    setPendingShow(null);
    if (index >= 0) setSelected(index);
  }
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
  // The active variant per region (docs/adr/0017-persons.md): the one Home shows.
  const variantList = useMemo(
    () => (files ?? []).map((f) => ({ name: f.name, region: regionByFile.get(f.name) ?? DEFAULT_REGION })),
    [files, regionByFile],
  );
  const activeOf = (id: RegionId) => activeVariant(id, variantList, activeMap);
  const isActive = name !== null && activeOf(region) === name;
  const savedVariant = name !== null && files?.some((f) => f.name === name) === true;
  const markActive = async () => {
    if (!name || !savedVariant || isActive) return;
    try {
      await setActiveVariant(region, name);
      toast.show(`${name} is now the active ${REGIONS[region].label.toLowerCase()} layout on Home`);
    } catch (e) {
      toast.show(`Could not set the active variant: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

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
    const target = last && names.includes(last) ? last : activeOf(next);
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

  // A region opened from Home. The latest switch functions are kept in a ref, so the effect runs only
  // when a new request arrives (or the layouts finish loading).
  const handledRequest = useRef<number | null>(null);
  const requestHandlers = useRef<{ switchRegion: (r: RegionId) => void; switchTo: (n: string) => void }>(
    null!,
  );
  useEffect(() => {
    requestHandlers.current = { switchRegion, switchTo };
  });
  useEffect(() => {
    if (!openRequest || !files || handledRequest.current === openRequest.nonce) return;
    handledRequest.current = openRequest.nonce;
    const { region: r, variant } = openRequest;
    if (variant && files.some((f) => f.name === variant)) requestHandlers.current.switchTo(variant);
    else requestHandlers.current.switchRegion(r);
  }, [openRequest, files]);

  // Full-body view: the other regions show their last opened (or active) variant.
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
      const file =
        names.find((f) => f.name === lastByRegion[id]) ??
        names.find((f) => f.name === activeVariant(id, variantList, activeMap));
      const r = file ? parseLayout(file.text) : null;
      return r?.ok ? [{ id, layout: r.layout }] : [];
    });
  }, [view3d, region, files, regionByFile, lastByRegion, variantList, activeMap]);

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
  const canChangeImage = !!sel && isFigureLike(sel) && !sel.locked;
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

  const canSave = dirty && !validationError && !readOnlyProject;
  const explainReadOnly = () => toast.show(READ_ONLY_HINT, "info");
  const selFixed = !!sel?.locked || (selected !== null && resolvedEls[selected]?.shape.kind === "patch");
  const runShortcut = (a: ShortcutAction) => {
    switch (a.type) {
      case "save":
        if (readOnlyProject) explainReadOnly();
        else if (canSave && layout) void doSave(layout);
        else if (!dirty) toast.show("No unsaved changes", "info");
        return;
      case "undo":
        return doUndo();
      case "redo":
        return doRedo();
      case "help":
        return setHelpOpen((o) => !o);
      case "tool":
        if (inBackground && a.tool === "select") return setBgTool("select");
        if (inBackground) enterView("motifs");
        // The brush draws on the region view only.
        if (a.tool === "draw") setView3d("region");
        return setDrawing(a.tool === "draw" ? (d) => !d : false);
      case "deselect":
        // Esc clears one thing at a time; with nothing left it goes back to Home (when opened there).
        if (inBackground) {
          if (selShape !== null) setSelShape(null);
          else if (selLayer !== null) setSelLayer(null);
          else onBackToHome?.();
          return;
        }
        if (pickerAnchor) setPickerAnchor(null);
        else if (drawing) setDrawing(false);
        else if (helpOpen) setHelpOpen(false);
        else if (selected !== null) setSelected(null);
        else onBackToHome?.();
        return;
    }
    if (inBackground) {
      // Delete removes the selected shape of the selected layer; the layer itself goes with its button.
      if (a.type === "delete" && selLayer !== null && selLayerObj && selShape !== null) {
        if (selLayerObj.locked) return toast.show(`${selLayerObj.id} is locked`, "info");
        setLayerAt(selLayer, removeShape(selLayerObj, selShape));
        setSelShape(null);
      }
      return;
    }
    // F, T and B add an element (in the Background view B is the brush, handled above).
    if (a.type === "add") return addElement(a.element);
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
    ...(converted.length > 0
      ? [
          {
            key: "converted",
            text: (
              <>
                Fillers are background layers now: {converted.join(", ")}. The file keeps the old form until
                you save the variant.
              </>
            ),
          },
        ]
      : []),
    ...(CATALOGUE_ERROR
      ? [{ key: "catalogue", text: <>Standard backgrounds catalogue cannot be read: {CATALOGUE_ERROR}</> }]
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

  // Elements list: the image of each figure as its row's thumbnail.
  const thumbs = useMemo(() => {
    const out = new Map<string, string>();
    for (const el of layout?.elements ?? [])
      if (isFigureLike(el) && el.asset && assetMap?.get(el.asset)?.exists)
        out.set(el.id, assetImageUrl(el.asset));
    return out;
  }, [layout, assetMap]);

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
      {onBackToHome && (
        // Opened from Home: the region and variant pickers read as the end of "Home › person ›".
        <span className="layout-crumbs">
          <button
            type="button"
            className="ghost crumb-back"
            onClick={onBackToHome}
            aria-keyshortcuts="Escape"
            aria-label="Back to Home"
            title={`Back to Home${person ? `: ${person.name}'s whole body` : ""} (Esc with nothing selected)`}
          >
            <ChevronLeftIcon />
            <HomeIcon />
            <span className="crumb-back-label">Home</span>
          </button>
          {person && (
            // Hidden on narrower windows, where the person chip next to it shows the avatar anyway.
            <span className="crumb-person" title={`Layouts of ${person.name}`}>
              <span className="crumb-sep" aria-hidden="true">
                ›
              </span>
              <span className="crumb-person-name">{person.name}</span>
            </span>
          )}
          <span className="crumb-sep" aria-hidden="true">
            ›
          </span>
        </span>
      )}
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
              title={canSave ? undefined : readOnlyProject ? READ_ONLY_HINT : "Fix the layout errors first"}
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
        className={`ghost icon-button active-star${isActive ? " on" : ""}`}
        onClick={() => void markActive()}
        disabled={!savedVariant || readOnlyProject || !person}
        aria-pressed={isActive}
        aria-label={isActive ? "Active variant" : "Set as active variant"}
        title={
          !savedVariant
            ? "Save this variant first, then mark it as the one Home shows"
            : isActive
              ? `Active: Home shows ${name} on the ${REGIONS[region].label.toLowerCase()}`
              : readOnlyProject
                ? "The sample is read-only"
                : !person
                  ? "Move this folder into a project first (Settings → Project)"
                  : `Set as active: show ${name} on Home`
        }
      >
        <StarIcon filled={isActive} />
      </button>
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
          className={readOnlyProject ? "lp-readonly" : undefined}
          onClick={() => (readOnlyProject ? explainReadOnly() : setSaveAsOpen((o) => !o))}
          disabled={!layout || !!validationError}
          aria-disabled={readOnlyProject || undefined}
          aria-expanded={readOnlyProject ? undefined : saveAsOpen}
          aria-haspopup={readOnlyProject ? undefined : "dialog"}
          title={
            readOnlyProject ? READ_ONLY_HINT : "Save what you see as a new variant to try an alternative"
          }
        >
          Save as…
        </button>
        <Popover
          open={saveAsOpen && !!layout && !readOnlyProject}
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
      {readOnlyProject ? (
        // Not disabled: a click (or the key) says why nothing can be saved here.
        <button
          type="button"
          className="lp-readonly"
          aria-disabled="true"
          onClick={explainReadOnly}
          aria-keyshortcuts={platform === "mac" ? "Meta+S" : "Control+S"}
          title={READ_ONLY_HINT}
        >
          Save <kbd className="kbd">{kbdSave}</kbd>
        </button>
      ) : (
        <button
          type="button"
          className={dirty ? "primary" : ""}
          onClick={() => layout && void doSave(layout)}
          disabled={!canSave}
          aria-keyshortcuts={platform === "mac" ? "Meta+S" : "Control+S"}
          title={
            dirty
              ? validationError
                ? "Fix the layout errors first"
                : `Save the changes to this variant (${kbdSave})`
              : "No unsaved changes"
          }
        >
          Save <kbd className="kbd">{kbdSave}</kbd>
        </button>
      )}
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
              aria-pressed={!drawing && (!inBackground || bgTool === "select")}
              aria-label="Select and move"
              aria-keyshortcuts="V"
              onClick={() => {
                setDrawing(false);
                if (inBackground) setBgTool("select");
              }}
            >
              <SelectIcon />
              <ToolTip name="Select and move" keys="V">
                Click an element to select it, drag it to move it. Drag the empty sheet to pan.
              </ToolTip>
            </button>
            <button
              type="button"
              className="tool draw-tool"
              aria-pressed={drawing}
              aria-label="Line: draw on the 3D view"
              aria-keyshortcuts="R"
              onClick={() => {
                setView3d("region");
                if (inBackground) enterView("motifs");
                setDrawing((d) => !d);
              }}
            >
              <RedLineIcon />
              <ToolTip name="Draw a line" keys="R">
                {KIND_HELP.line} Click again, or press Esc, to stop drawing.
              </ToolTip>
            </button>
            <span className="rail-sep" aria-hidden="true" />
            <span className="rail-label" aria-hidden="true">
              Add
            </span>
            {ADD_TOOLS.map((t) => (
              <button
                key={t.type}
                type="button"
                className="tool rt-add"
                aria-label={`Add ${KIND_LABEL[t.type].toLowerCase()}`}
                aria-keyshortcuts={t.key}
                onClick={() => {
                  if (inBackground) enterView("motifs");
                  addElement(t.type);
                }}
              >
                {t.icon}
                <ToolTip name={`Add ${KIND_LABEL[t.type].toLowerCase()}`} keys={t.key}>
                  {KIND_HELP[t.type]}
                </ToolTip>
              </button>
            ))}
            <span className="rail-sep" aria-hidden="true" />
            <button
              type="button"
              className="tool"
              aria-pressed={inBackground}
              aria-label="Background layers: edit the layers under the motifs"
              onClick={() => enterView(inBackground ? "motifs" : "background")}
            >
              <FillerIcon />
              <ToolTip name="Background layers">
                Clouds, stars, patterns or an image under the motifs. Opens the Background view.
              </ToolTip>
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
                <ToolTip name="Keyboard shortcuts" keys="?">
                  Every key of the editor, on one card.
                </ToolTip>
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
                <p className="faint small sc-note">Keys rest while you type in a field, except Save.</p>
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
              zoomRequest={zoomRequest}
              hint={false}
              background={
                inBackground
                  ? {
                      layer: selLayerObj ?? null,
                      tool: bgTool,
                      brushCm,
                      selectedShape: selShape,
                      onSelectShape: setSelShape,
                      onChange: (b, gesture) => selLayer !== null && setLayerAt(selLayer, b, gesture),
                    }
                  : undefined
              }
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
              <span
                className="segmented"
                role="group"
                aria-label="Edit"
                title="Motifs: figures, bands and lines. Background: the layers under them (motifs dimmed)."
              >
                <button
                  type="button"
                  className={!inBackground ? "active" : ""}
                  aria-pressed={!inBackground}
                  onClick={() => enterView("motifs")}
                >
                  Motifs
                </button>
                <button
                  type="button"
                  className={inBackground ? "active" : ""}
                  aria-pressed={inBackground}
                  onClick={() => enterView("background")}
                  title={BACKGROUND_HINT}
                >
                  Background
                </button>
              </span>
              <span className="toolbar-sep" aria-hidden="true" />
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
              <button
                type="button"
                className="ghost bar-toggle"
                aria-pressed={grid}
                onClick={() => setGrid((g) => !g)}
                title="Grid: 1 cm lines over the skin, bold every 5 cm, labelled every 10 cm"
              >
                <GridIcon />
                <span className="bar-toggle-label">Grid</span>
              </button>
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
              fallbackName={sel?.id}
              format={(p) => formatPointCm(profile, p, regionNames(region))}
              onFit={() => setFitRequest((n) => n + 1)}
              onZoom={zoomBy}
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
              <label
                className="inline switch-label"
                title="Show the motifs over the background layers, or the background alone"
              >
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={showMotifs}
                  onChange={(e) => setShowMotifs(e.target.checked)}
                />
                Motifs
              </label>
              <span className="toolbar-sep" aria-hidden="true" />
              <div ref={setViewerToolbar} className="viewer-tools" />
            </div>
            {view3d === "region" && supportsBend(profile.kind) && (
              <div className="float pose-panel">
                <PoseControl bendDeg={pose.bendDeg} onChange={pose.setBendDeg} variant="panel" />
              </div>
            )}
            {metrics && (
              <MetricsPanel
                coverage={metrics}
                variant="float"
                collapsible={{ open: coverageOpen, onToggle: toggleCoverage }}
              />
            )}

            {!panelOpen && (
              // Narrow windows only (CSS): the side panel is put away to give the 3D view the room.
              <button
                type="button"
                className="float ws-panel-open"
                aria-expanded={false}
                onClick={() => showPanel(true)}
                title="Show the elements and their properties"
              >
                <SidePanelIcon />
                {sel ? sel.id : "Elements"}
              </button>
            )}
            <div className={`ws-stack${panelOpen ? "" : " ws-stack-away"}`}>
              <section className="float side-tabs" aria-label="Elements and assets">
                <div className="float-head" role="tablist" aria-label="Side panel">
                  <button
                    type="button"
                    role="tab"
                    id="side-tab-elements"
                    aria-selected={sideTab === "elements"}
                    aria-controls="side-panel-elements"
                    className="panel-tab"
                    onClick={() => enterView("motifs")}
                  >
                    <LayersIcon />
                    Elements <span className="count">{layout.elements.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="side-tab-layers"
                    aria-selected={sideTab === "layers"}
                    aria-controls="side-panel-layers"
                    className="panel-tab"
                    onClick={() => enterView("background")}
                    title="Background layers under the motifs (opens the Background view)"
                  >
                    <FillerIcon />
                    Layers <span className="count">{layers.length}</span>
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
                  {sideTab === "layers" ? (
                    <AddLayerMenu standard={STANDARD_BACKGROUNDS} images={allAssets} onAdd={onAddLayer} />
                  ) : sideTab === "elements" ? null : (
                    <button
                      type="button"
                      className="ghost small-button"
                      onClick={reloadAssets}
                      title="Look for new images in the project folder, then re-read manifest.yaml and the images"
                    >
                      Reload
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost icon-button small-button ws-panel-close"
                    aria-label="Hide the side panel"
                    aria-expanded
                    title="Hide this panel to give the 3D view the room"
                    onClick={() => showPanel(false)}
                  >
                    <SidePanelIcon />
                  </button>
                </div>
                <div
                  className="side-tab-body"
                  role="tabpanel"
                  id={`side-panel-${sideTab}`}
                  aria-labelledby={`side-tab-${sideTab}`}
                >
                  {sideTab === "layers" ? (
                    <LayerList
                      layers={layers}
                      selected={selLayer}
                      onSelect={(i) => {
                        setSelLayer(i);
                        setSelShape(null);
                      }}
                      onChange={(i, b) => setLayerAt(i, b)}
                      onMove={(from, to) => applyLayers((l) => moveBackground(l, from, to))}
                      issues={layerIssues}
                      labelOf={labelOf}
                    />
                  ) : sideTab === "elements" ? (
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
                      thumbs={thumbs}
                      empty={
                        <p className="el-empty">
                          Nothing here yet. Add a figure, an existing tattoo or a band with the tools on the
                          left.
                        </p>
                      }
                    />
                  ) : (
                    <AssetBrowser
                      heading={false}
                      listing={listing}
                      onReload={reloadAssets}
                      note={scanNote}
                      current={sel && isFigureLike(sel) ? sel.asset : undefined}
                      photos={sel?.type === "existing"}
                      assignBlocked={assignBlocked}
                      onPick={pickAsset}
                    />
                  )}
                </div>
              </section>
              <div className="float inspector">
                {inBackground ? (
                  selLayerObj && selLayer !== null ? (
                    <LayerPanel
                      layer={selLayerObj}
                      index={selLayer}
                      count={layers.length}
                      standard={STANDARD_BACKGROUNDS}
                      images={allAssets}
                      issue={layerIssues.get(selLayerObj.id)}
                      onChange={(b) => setLayerAt(selLayer, b, typingKey(`bg${selLayer}`))}
                      onDelete={() => {
                        applyLayers((l) => deleteLayer(l, selLayer));
                        toast.show(`Deleted ${selLayerObj.id} (${keyHint("Mod+Z")} to undo)`, "info");
                      }}
                      onDuplicate={() => applyLayers((l) => duplicateLayer(l, selLayer))}
                      tool={bgTool}
                      onTool={setBgTool}
                      brushCm={brushCm}
                      onBrushCm={setBrushCm}
                      selectedShape={selShape}
                      onSelectShape={setSelShape}
                    />
                  ) : (
                    <section className="panel variant-panel">
                      <div className="panel-head inspector-head">
                        <h2>Background</h2>
                        <span className="faint">layers under the motifs</span>
                      </div>
                      <p className="ins-help bg-intro">
                        {layers.length === 0
                          ? "Add a layer with the + in the Layers tab: a standard background such as clouds, stars or smoke, a line pattern, or a tileable image from the project."
                          : "Select a layer in the list to edit it. Each layer covers the whole region or an area you draw or paint; motifs on top cover it."}
                      </p>
                      <h3 className="props-head">Tools for a layer's area</h3>
                      <dl className="shortcut-list bg-help">
                        {BACKGROUND_TOOLS.map((t) => (
                          <div key={t.id}>
                            <dt>
                              <kbd>{t.key}</kbd> {t.label}
                            </dt>
                            <dd>{t.hint}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="ins-help">
                        Delete removes the selected shape. Motifs are dimmed here and cannot be picked.
                      </p>
                    </section>
                  )
                ) : sel && selected !== null ? (
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
                    idError={issueSplit?.idErrors.get(selected) ?? null}
                    keys={{
                      duplicate: keyHint("Mod+D"),
                      delete: "Delete",
                      forward: "]",
                      back: "[",
                    }}
                  />
                ) : (
                  <section className="panel variant-panel" aria-label="Layout variant">
                    <div className="panel-head inspector-head">
                      <h2>{layout.name}</h2>
                      <span className="faint">{REGIONS[region].label} layout</span>
                      <span className="spacer" />
                      {dirty && <span className="chip warn">unsaved</span>}
                    </div>
                    <dl className="vp-stats">
                      <div title={elementSummary(layout.elements.map((e) => e.type))}>
                        <dt>Elements</dt>
                        <dd>{layout.elements.length}</dd>
                      </div>
                      <div title="Background layers under the motifs">
                        <dt>Backgrounds</dt>
                        <dd>{layers.length}</dd>
                      </div>
                      <div title="Share of the skin under an element or a background layer">
                        <dt>Covered</dt>
                        <dd>
                          {metrics
                            ? `${100 - Math.round((100 * metrics.total.byCategory.open) / (metrics.total.area || 1))}%`
                            : "–"}
                        </dd>
                      </div>
                    </dl>
                    <p className="ins-help vp-summary">
                      {elementSummary(layout.elements.map((e) => e.type))}
                      {layers.length > 0 ? `, ${countNoun(layers.length, "background layer")}` : ""}.
                    </p>
                    <label className="props vp-desc">
                      Description
                      <textarea
                        rows={3}
                        value={layout.description ?? ""}
                        placeholder="What this variant tries, in a sentence or two"
                        onChange={(e) =>
                          commit(
                            (l) => ({ ...l, description: e.target.value || undefined }),
                            typingKey("description"),
                          )
                        }
                      />
                    </label>
                    <h3 className="props-head">Add to this layout</h3>
                    <div className="vp-actions">
                      {ADD_TOOLS.map((t) => (
                        <button
                          key={t.type}
                          type="button"
                          onClick={() => addElement(t.type)}
                          title={KIND_HELP[t.type]}
                        >
                          {t.icon}
                          <span className="vp-action-name">{KIND_LABEL[t.type]}</span>
                          <span className="vp-action-help">{KIND_SHORT[t.type]}</span>
                          <kbd className="kbd">{t.key}</kbd>
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-pressed={drawing}
                        onClick={() => {
                          setView3d("region");
                          setDrawing((d) => !d);
                        }}
                        title={KIND_HELP.line}
                      >
                        <RedLineIcon />
                        <span className="vp-action-name">{drawing ? "Stop drawing" : "Line"}</span>
                        <span className="vp-action-help">{KIND_SHORT.line}</span>
                        <kbd className="kbd">R</kbd>
                      </button>
                    </div>
                    <p className="ins-help">
                      {layout.elements.length > 0
                        ? "To edit an element, click it on the sheet or in the list above."
                        : "New elements land in the middle of the sheet. Drag them into place."}
                    </p>
                    {readOnlyProject && <p className="ins-help vp-readonly">{READ_ONLY_HINT}</p>}
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
          photos={sel.type === "existing"}
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

/** Bottom of the 2D view: the skin point under the pointer (or the selection's centre) and the zoom. */
function StatusBar(props: {
  cursor: ValueStore<SkinUV | null>;
  zoom: ValueStore<number>;
  fallback: SkinUV | null;
  /** Whose position `fallback` is (the selected element). */
  fallbackName?: string;
  format: (p: SkinUV) => string;
  onFit: () => void;
  /** Zooms by a factor about the middle of the view. */
  onZoom: (factor: number) => void;
}) {
  const hover = useValue(props.cursor);
  const zoom = useValue(props.zoom);
  const p = hover ?? props.fallback;
  return (
    <div className="float status-bar">
      <span className="sb-where" title={EDITOR_HINT}>
        <TargetIcon />
        {p ? (
          <>
            {!hover && props.fallbackName && <span className="sb-name">{props.fallbackName}</span>}
            <span className="sb-cm">{props.format(p)}</span>
            {hover && (
              // The pointer's numbers; a selection's are in the inspector.
              <span
                className="sb-uv mono"
                title="The same point as the layout file stores it: u around, v along"
              >
                u {p.u.toFixed(2)} · v {p.v.toFixed(2)}
              </span>
            )}
          </>
        ) : (
          <span className="faint">Point at the skin to read a position</span>
        )}
      </span>
      <span className="spacer" />
      <span className="sb-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          className="ghost icon-button small-button"
          onClick={() => props.onZoom(1 / 1.25)}
          aria-label="Zoom out"
          title="Zoom out (or scroll)"
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          className="ghost small-button sb-zoom-value mono"
          onClick={props.onFit}
          aria-label={`Zoom ${zoom}%. Fit the whole sheet`}
          title="Fit the whole sheet (or double-click the background)"
        >
          {zoom}%
        </button>
        <button
          type="button"
          className="ghost icon-button small-button"
          onClick={() => props.onZoom(1.25)}
          aria-label="Zoom in"
          title="Zoom in (or scroll)"
        >
          <PlusSmallIcon />
        </button>
      </span>
    </div>
  );
}
