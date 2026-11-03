import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ArmProfile } from "../arm/profile.ts";
import { ArmModel } from "./ArmModel.tsx";
import type { CameraSync } from "./cameraSync.ts";
import { MAX_FLEXION_DEG } from "../arm/bend.ts";
import { armGeometry, LIGHTS, VIEWER_BACKGROUND } from "./scene.ts";
import { useViewState, type ViewState } from "./useViewState.ts";
import { CAMERA_FOV, VIEWS, viewCamera, type Bounds } from "./views.ts";

type Props = {
  profile: ArmProfile;
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
  /** When set, the toolbar shows the pose control. */
  onBendDeg?: (deg: number) => void;
};

export function ArmViewer(props: Props) {
  const { profile, canvas, version, hint, viewState, toolbar = true, sync, label } = props;
  const bendDeg = props.bendDeg ?? 0;
  const own = useViewState();
  const vs = viewState ?? own;
  const geometry = useMemo(() => armGeometry(profile, bendDeg), [profile, bendDeg]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const bounds = useMemo<Bounds | undefined>(() => {
    const box = geometry.boundingBox;
    return bendDeg > 0 && box ? { min: box.min.toArray(), max: box.max.toArray() } : undefined;
  }, [geometry, bendDeg]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const screenshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Downloads go to the browser's download folder, never into the repo.
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tattoo-planner-${vs.free ? "free" : vs.view}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };

  return (
    <div className="viewer">
      {toolbar && (
        <div className="toolbar" role="toolbar" aria-label="Views">
          <ViewButtons state={vs} />
          {props.onBendDeg && <PoseControl bendDeg={bendDeg} onChange={props.onBendDeg} />}
          <span className="spacer" />
          <button type="button" onClick={screenshot}>
            Screenshot
          </button>
        </div>
      )}
      <div className="canvas-wrap">
        {label && <span className="viewer-label">{label}</span>}
        <Canvas
          ref={canvasRef}
          camera={{ fov: CAMERA_FOV, near: 1, far: 2000 }}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          dpr={[1, 2]}
        >
          <color attach="background" args={[VIEWER_BACKGROUND]} />
          <hemisphereLight
            args={[LIGHTS.hemisphere.sky, LIGHTS.hemisphere.ground, LIGHTS.hemisphere.intensity]}
          />
          <directionalLight position={LIGHTS.key.position} intensity={LIGHTS.key.intensity} />
          <directionalLight position={LIGHTS.fill.position} intensity={LIGHTS.fill.intensity} />
          <ArmModel geometry={geometry} canvas={canvas} version={version} />
          <CameraRig profile={profile} bounds={bounds} state={vs} sync={sync} />
        </Canvas>
      </div>
      {toolbar && (
        <p className="muted small">
          Drag to rotate, scroll to zoom, right-drag to pan.{" "}
          {hint ??
            "Grid: 1 cm, bold every 5 cm; red lines mark outer, lateral, inner and medial centre lines."}
        </p>
      )}
    </div>
  );
}

/** The four fixed view buttons (front = inner, back = outer, medial, lateral). */
export function ViewButtons({ state }: { state: ViewState }) {
  return (
    <>
      {VIEWS.map((v) => (
        <button
          key={v.name}
          type="button"
          className={!state.free && state.view === v.name ? "active" : ""}
          title={v.hint}
          onClick={() => state.select(v.name)}
        >
          {v.label}
        </button>
      ))}
    </>
  );
}

/** Elbow pose: a flexion slider with presets (the same texture bends with the skin). */
export function PoseControl({ bendDeg, onChange }: { bendDeg: number; onChange: (deg: number) => void }) {
  return (
    <span className="pose-control" role="group" aria-label="Elbow pose">
      <span className="segmented">
        <button type="button" className={bendDeg === 0 ? "active" : ""} onClick={() => onChange(0)}>
          Straight
        </button>
        <button type="button" className={bendDeg === 90 ? "active" : ""} onClick={() => onChange(90)}>
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
        title="Elbow flexion"
      />
      <span className="muted small pose-value">{bendDeg}°</span>
    </span>
  );
}

function CameraRig(props: {
  profile: ArmProfile;
  bounds?: Bounds;
  state: ViewState;
  sync?: { bus: CameraSync; id: string };
}) {
  const { profile, bounds, state, sync } = props;
  const { view, request, free, setFree } = state;
  // What the last framing was for: a new pose re-frames a fixed view, but not a hand-rotated camera.
  const framedFor = useRef<{ key: string; profile: ArmProfile | null }>({ key: "", profile: null });
  const controls = useRef<OrbitControlsImpl>(null);
  // Set while a camera from another viewer is applied, so it is not sent back.
  const applying = useRef(false);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  // Re-frame on a view request and whenever the arm or the canvas changes size.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const key = `${view}:${request}:${size.width}x${size.height}`;
    if (free && framedFor.current.key === key && framedFor.current.profile === profile) return;
    framedFor.current = { key, profile };
    const { position, target } = viewCamera(
      profile,
      view,
      size.width / Math.max(size.height, 1),
      1.25,
      bounds,
    );
    camera.position.set(...position);
    c.target.set(...target);
    c.update();
  }, [profile, bounds, view, request, free, camera, size.width, size.height]);

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
    });
  }, [sync, camera]);

  const publish = () => {
    const c = controls.current;
    if (!sync || !c || applying.current) return;
    sync.bus.publish(sync.id, {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [c.target.x, c.target.y, c.target.z],
    });
  };

  return (
    <OrbitControls ref={controls} makeDefault enableDamping={false} onStart={setFree} onChange={publish} />
  );
}
