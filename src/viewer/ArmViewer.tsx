import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CameraIcon, ChevronDownIcon } from "../ui/icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { createPortal } from "react-dom";
import type { RegionProfile } from "../body/profile.ts";
import { ArmModel } from "./ArmModel.tsx";
import type { CameraSync } from "./cameraSync.ts";
import { MAX_FLEXION_DEG, regionBendDeg, supportsBend } from "../body/bend.ts";
import { addSample, textureToLayout, type UV } from "../editor/stroke.ts";
import { armGeometry, VIEWER_BACKGROUND } from "./scene.ts";
import { STAGE_DPR, STAGE_GL, StageLights, StageShadow, useCameraFlight } from "./Stage.tsx";
import { useViewState, type ViewState } from "./useViewState.ts";
import { useFreeInsets } from "./useFreeInsets.ts";
import { boundsAspect, CAMERA_FOV, fitCamera, viewDir, viewsFor, type Bounds } from "./views.ts";

type Props = {
  profile: RegionProfile;
  canvas: HTMLCanvasElement;
  version: number;
  hint?: string;
  /** Fixed-view state shared with other viewers; without it the viewer keeps its own. */
  viewState?: ViewState;
  /** false hides the view buttons and the hint (the Compare tab has one toolbar for both arms). */
  toolbar?: boolean;
  /** Keeps the camera in step with other viewers on the same bus. */
  sync?: { bus: CameraSync; id: string };
  /** Shown in the corner of the canvas, e.g. the variant name. */
  label?: string;
  /** Elbow flexion in degrees (0 = straight). */
  bendDeg?: number;
  /** When set, the pose control floats at the bottom of the canvas. */
  onBendDeg?: (deg: number) => void;
  /**
   * Brush tool: while active, dragging on the skin draws instead of rotating (zoom and right-drag pan
   * still work); every finished stroke arrives as layout points, thinned to the minimum step.
   */
  draw?: { active: boolean; onStroke: (samples: UV[]) => void };
  /** Renders the toolbar into this element instead of above the canvas (lets a page align columns). */
  toolbarTarget?: HTMLElement | null;
  /** Floats on top of the canvas (e.g. the drawing hint); use a .canvas-toolbar.top inside. */
  overlay?: ReactNode;
  /** Name the skin side on the view buttons: "Front (inner)", "Back (outer)". */
  viewSides?: boolean;
  /** false leaves out the usage hint under the canvas (the page shows ORBIT_HINT elsewhere). */
  footer?: boolean;
  /** Puts the Screenshot button, as an icon, at the end of the toolbar instead of the canvas corner. */
  screenshotInToolbar?: boolean;
  /** The fixed views frame the region clear of the `.float` panels inside this element. */
  frameAround?: HTMLElement | null;
};

/** How to move the camera; the viewers' hint starts with it. */
export const ORBIT_HINT = "Drag to rotate, scroll to zoom, right-drag to pan, double-click to reset.";

export function ArmViewer(props: Props) {
  const { profile, canvas, version, hint, viewState, toolbar = true, sync, label } = props;
  // The pose is shared across tabs; a region that cannot bend (torso, legs) ignores it.
  const bendDeg = regionBendDeg(profile.kind, props.bendDeg ?? 0);
  const own = useViewState();
  const vs = viewState ?? own;
  const geometry = useMemo(() => armGeometry(profile, bendDeg), [profile, bendDeg]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const bounds = useMemo<Bounds>(() => {
    const box = geometry.boundingBox;
    return box ? { min: box.min.toArray(), max: box.max.toArray() } : { min: [0, 0, 0], max: [1, 1, 1] };
  }, [geometry]);
  const drawing = !!props.draw?.active;
  const brush = useBrush(profile, props.draw);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const screenshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The canvas is transparent (the workspace gradient is CSS); flatten it onto an opaque background.
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle =
      VIEWER_BACKGROUND[document.documentElement.classList.contains("light") ? "light" : "dark"];
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    // Downloads go to the browser's download folder, never into the repo.
    flat.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tattoo-planner-${vs.free ? "free" : vs.view}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };

  const screenshotTitle = "Save this view as a PNG in the browser's download folder";
  const toolbarEl = toolbar && (
    <div className="toolbar viewer-toolbar" role="toolbar" aria-label="3D view">
      <ViewButtons state={vs} sides={props.viewSides} profile={profile} />
      {props.screenshotInToolbar && (
        <>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="ghost icon-button"
            onClick={screenshot}
            aria-label="Screenshot"
            title={`Screenshot: ${screenshotTitle}`}
          >
            <CameraIcon />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="viewer">
      {props.toolbarTarget
        ? createPortal(toolbarEl, props.toolbarTarget)
        : props.toolbarTarget === undefined && toolbarEl}
      <div className={`canvas-wrap${drawing ? " drawing" : ""}`}>
        {label && <span className="viewer-label">{label}</span>}
        {props.overlay}
        {toolbar && !props.screenshotInToolbar && (
          <button type="button" className="canvas-action" onClick={screenshot} title={screenshotTitle}>
            Screenshot
          </button>
        )}
        {toolbar && props.onBendDeg && supportsBend(profile.kind) && (
          <div className="canvas-toolbar bottom">
            <PoseControl bendDeg={bendDeg} onChange={props.onBendDeg} />
          </div>
        )}
        <Canvas
          ref={canvasRef}
          camera={{ fov: CAMERA_FOV, near: 1, far: 2000 }}
          gl={STAGE_GL}
          dpr={STAGE_DPR}
          // Static view: a frame only when something changed (controls, texture, pose, resize).
          frameloop="demand"
          onPointerMissed={(e) => {
            // Double-click resets the camera to the current fixed view (not while drawing).
            if (e.type === "dblclick" && !drawing) vs.select(vs.view);
          }}
        >
          <StageLights />
          <StageShadow bounds={bounds} />
          <ArmModel
            geometry={geometry}
            canvas={canvas}
            version={version}
            onPointerDown={drawing ? brush.down : undefined}
            onPointerMove={drawing ? brush.move : undefined}
          />
          {brush.preview.length >= 2 && (
            <Line points={brush.preview} color="#d01810" lineWidth={4} depthTest={false} />
          )}
          <CameraRig
            profile={profile}
            bounds={bounds}
            state={vs}
            sync={sync}
            rotate={!drawing}
            frameAround={props.frameAround}
          />
        </Canvas>
      </div>
      {toolbar && props.footer !== false && (
        <p className="muted small">
          {ORBIT_HINT}{" "}
          {hint ??
            "Grid: 1 cm, bold every 5 cm; red lines mark outer, lateral, inner and medial centre lines."}
        </p>
      )}
    </div>
  );
}

/** The four fixed view buttons; `sides` adds the skin side: "Front (inner)", "Back (outer)". */
export function ViewButtons({
  state,
  sides = false,
  profile,
}: {
  state: ViewState;
  sides?: boolean;
  /** The region whose views to offer; default the left arm's. */
  profile?: Pick<RegionProfile, "kind" | "mirrored">;
}) {
  return (
    <span className="segmented" role="group" aria-label="View">
      {viewsFor(profile ?? { kind: "arm", mirrored: false }).map((v) => {
        const on = !state.free && state.view === v.name;
        return (
          <button
            key={v.name}
            type="button"
            className={on ? "active" : ""}
            aria-pressed={on}
            title={v.hint}
            onClick={() => state.select(v.name)}
          >
            {v.label}
            {sides && v.side && <span className="view-side">({v.side})</span>}
          </button>
        );
      })}
    </span>
  );
}

/** The pose in words: "Straight", "Bent 90°" or the angle. */
export function poseLabel(bendDeg: number): string {
  return bendDeg === 0 ? "Straight" : bendDeg === 90 ? "Bent 90°" : `${bendDeg}°`;
}

/** Presets and the free slider of the elbow pose. */
function PoseFields({ bendDeg, onChange }: { bendDeg: number; onChange: (deg: number) => void }) {
  return (
    <>
      <span className="segmented">
        <button
          type="button"
          className={bendDeg === 0 ? "active" : ""}
          aria-pressed={bendDeg === 0}
          onClick={() => onChange(0)}
        >
          Straight
        </button>
        <button
          type="button"
          className={bendDeg === 90 ? "active" : ""}
          aria-pressed={bendDeg === 90}
          onClick={() => onChange(90)}
        >
          Bent 90°
        </button>
      </span>
      <input
        type="range"
        min={0}
        max={MAX_FLEXION_DEG}
        step={5}
        value={bendDeg}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Elbow flexion in degrees"
        aria-valuetext={poseLabel(bendDeg)}
        title="Elbow flexion"
      />
    </>
  );
}

/**
 * Elbow pose: a flexion slider with presets (the same texture bends with the skin). "inline" is one
 * row for a toolbar; "panel" is a compact button showing the pose that opens the presets and the
 * slider in a popover (a rarely used control should not cover the viewport).
 */
export function PoseControl({
  bendDeg,
  onChange,
  variant = "inline",
}: {
  bendDeg: number;
  onChange: (deg: number) => void;
  variant?: "inline" | "panel";
}) {
  const [open, setOpen] = useState(false);
  if (variant === "panel")
    return (
      <span className="pose-control panel popover-anchor" role="group" aria-label="Elbow pose">
        <button
          type="button"
          className="ghost vw-pose-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title="Elbow pose: straight, bent 90° or any angle up to 120°"
        >
          <span className="vw-pose-name">Elbow</span>
          <span className="vw-pose-state">{poseLabel(bendDeg)}</span>
          <ChevronDownIcon />
        </button>
        <Popover open={open} onClose={() => setOpen(false)} label="Elbow pose" className="vw-pose-pop">
          <span className="pose-head">
            <span className="popover-title">Elbow pose</span>
            <span className="pose-value mono">{bendDeg}°</span>
          </span>
          <PoseFields bendDeg={bendDeg} onChange={onChange} />
        </Popover>
      </span>
    );
  return (
    <span className="pose-control" role="group" aria-label="Elbow pose">
      <PoseFields bendDeg={bendDeg} onChange={onChange} />
      <span className="muted small pose-value">{bendDeg}°</span>
    </span>
  );
}

/** Records a stroke on the skin: raycast hit → texture UV → layout point, with a live preview line. */
function useBrush(profile: RegionProfile, draw: Props["draw"]) {
  const samples = useRef<UV[] | null>(null);
  const [preview, setPreview] = useState<[number, number, number][]>([]);
  const onStroke = draw?.onStroke;

  // Finish on any pointer release, also when it happens beside the arm.
  useEffect(() => {
    if (!onStroke) return;
    const up = () => {
      const s = samples.current;
      samples.current = null;
      setPreview([]);
      if (s && s.length >= 2) onStroke(s);
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [onStroke]);

  const sample = (e: ThreeEvent<PointerEvent>): boolean => {
    // Only the skin (material group 0) has UVs; the rounded ends do not.
    if (!e.uv || e.face?.materialIndex !== 0) return false;
    const p = textureToLayout(profile, e.uv.x, e.uv.y);
    if (!p || !samples.current) return false;
    const next = addSample(profile, samples.current, p);
    if (next === samples.current) return true;
    samples.current = next;
    // Just above the skin, so the preview is not hidden in it.
    const n = e.face.normal;
    const at: [number, number, number] = [
      e.point.x + n.x * 0.15,
      e.point.y + n.y * 0.15,
      e.point.z + n.z * 0.15,
    ];
    setPreview((pts) => [...pts, at]);
    return true;
  };

  return {
    preview,
    down: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      samples.current = [];
      setPreview([]);
      sample(e);
    },
    move: (e: ThreeEvent<PointerEvent>) => {
      if (samples.current) {
        e.stopPropagation();
        sample(e);
      }
    },
  };
}

/** Room around the region in a fixed view (1 = touching the free part's edges). */
const FRAME_MARGIN = 1.15;

function CameraRig(props: {
  profile: RegionProfile;
  bounds: Bounds;
  state: ViewState;
  sync?: { bus: CameraSync; id: string };
  rotate?: boolean;
  frameAround?: HTMLElement | null;
}) {
  const { profile, bounds, state, sync, rotate = true } = props;
  const { view, request, free, setFree } = state;
  // What the last framing was for: a new pose re-frames a fixed view, but not a hand-rotated camera.
  const framedFor = useRef<{ key: string; profile: RegionProfile | null }>({ key: "", profile: null });
  // Set while a camera from another viewer is applied, so it is not sent back.
  const applying = useRef(false);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const dir = viewDir(profile, view);
  const insets = useFreeInsets(props.frameAround, boundsAspect(bounds, dir, FRAME_MARGIN));
  const { controls, fly } = useCameraFlight();
  // The view request framed last: only a new button press animates; resizes and poses jump.
  const lastRequest = useRef<{ view: string; request: number } | null>(null);
  const radius = useMemo(() => Math.hypot(...bounds.max.map((v, i) => v - bounds.min[i]!)) / 2, [bounds]);

  // Re-frame on a view request and whenever the region or the canvas changes size; panels that move
  // only re-frame a fixed view, never a hand-rotated camera.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const key = `${view}:${request}:${size.width}x${size.height}`;
    if (free && framedFor.current.key === key && framedFor.current.profile === profile) return;
    framedFor.current = { key, profile };
    const fit = fitCamera(bounds, dir, size.width, size.height, insets, FRAME_MARGIN);
    if ("setViewOffset" in camera) {
      if (fit.offset[0] === 0 && fit.offset[1] === 0) camera.clearViewOffset();
      else
        camera.setViewOffset(size.width, size.height, fit.offset[0], fit.offset[1], size.width, size.height);
    }
    const distance = Math.hypot(...fit.position.map((v, i) => v - fit.target[i]!));
    const prev = lastRequest.current;
    lastRequest.current = { view, request };
    const pressed = prev !== null && (prev.view !== view || prev.request !== request);
    fly({ position: fit.position, target: fit.target }, pressed, Math.max(radius * 10, distance * 1.5));
    invalidate();
    // `dir` follows `view` and `profile`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, bounds, view, request, free, camera, size.width, size.height, insets, fly, controls, radius]);

  useEffect(() => {
    if (!sync) return;
    return sync.bus.subscribe(sync.id, (s) => {
      const c = controls.current;
      if (!c) return;
      applying.current = true;
      camera.position.set(...s.position);
      c.target.set(...s.target);
      c.update();
      applying.current = false;
      invalidate();
    });
  }, [sync, camera, invalidate, controls]);

  const publish = () => {
    const c = controls.current;
    if (!sync || !c || applying.current) return;
    sync.bus.publish(sync.id, {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [c.target.x, c.target.y, c.target.z],
    });
  };

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.14}
      enableRotate={rotate}
      // Close enough to read a 1 mm line; the far limit is set per framing (see above).
      minDistance={radius * 0.45}
      onStart={setFree}
      onChange={publish}
    />
  );
}
