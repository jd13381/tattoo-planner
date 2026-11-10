// Home's full-body view (docs/adr/0018-home.md): the person's whole body with every region's active
// layout, on a slow turntable that stops as soon as the user takes the camera. View only: a click on
// a region asks the page to open it in the Layout tab. Reuses the full-body meshes of BodyViewer.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { BufferGeometry } from "three";
import type { ResolvedBody } from "../body/body.ts";
import { REGION_IDS, type RegionId } from "../body/regions.ts";
import { RegionMesh, type RegionTexture } from "../viewer/BodyViewer.tsx";
import { NeutralBody } from "../viewer/NeutralBody.tsx";
import { armGeometry } from "../viewer/scene.ts";
import {
  STAGE_DPR,
  STAGE_GL,
  StageLights,
  StageShadow,
  useCameraFlight,
  useOnScreen,
} from "../viewer/Stage.tsx";
import { BODY_VIEWS, CAMERA_FOV, fitCamera, type BodyViewName } from "../viewer/views.ts";

/** One turn in about a minute and a quarter (OrbitControls: 2 = one turn in 30 s). */
const TURNTABLE_SPEED = 0.8;
const MARGIN = 1.1;
/** Room for the hero (top) and the view bar (bottom), in canvas pixels. */
const STAGE_INSETS = { top: 40, right: 0, bottom: 84, left: 0 };

export type HomeView = { name: BodyViewName; request: number };

/**
 * The camera when Home last closed (a region opened in the Layout tab): the way back shows the body
 * from the same angle. Per page load; a person switch reloads the page and starts fresh.
 */
let lastCamera: { position: [number, number, number]; target: [number, number, number] } | null = null;

type Props = {
  body: ResolvedBody;
  textures: Partial<Record<RegionId, RegionTexture>>;
  hover: RegionId | null;
  onHover: (id: RegionId) => void;
  /** The pointer left a region (null: left the body). */
  onLeave: (id: RegionId | null) => void;
  onPick: (id: RegionId) => void;
  /** Turntable on. */
  spin: boolean;
  /** The user took the camera (drag, zoom): the page stops the turntable. */
  onInteract: () => void;
  view: HomeView;
};

export function HomeViewer(props: Props) {
  const { body, textures, hover, onHover, onLeave, onPick, spin, onInteract, view } = props;
  const geometries = useMemo(
    () =>
      Object.fromEntries(REGION_IDS.map((id) => [id, armGeometry(body.regions[id].profile)])) as Record<
        RegionId,
        BufferGeometry
      >,
    [body],
  );
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);
  // The turntable is the only animation: it renders continuously only while it turns and is on
  // screen in a visible tab; otherwise frames are on demand. With reduced motion it starts off
  // (HomePage) and turns only when the user presses play.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScreen = useOnScreen(canvasRef);
  const turning = spin && onScreen;

  return (
    <Canvas
      ref={canvasRef}
      className="home-canvas"
      camera={{ fov: CAMERA_FOV, near: 1, far: 5000 }}
      gl={STAGE_GL}
      dpr={STAGE_DPR}
      frameloop={turning ? "always" : "demand"}
      onPointerMissed={() => onLeave(null)}
    >
      <StageLights />
      {REGION_IDS.map((id) => (
        <RegionMesh
          key={id}
          geometry={geometries[id]}
          placement={body.layout.placements[id]}
          texture={textures[id]}
          highlight={hover === id}
          onClick={(e) => {
            // A drag that turned the body is not a pick.
            if (e.delta > 4) return;
            e.stopPropagation();
            onPick(id);
          }}
          onOver={(e) => {
            e.stopPropagation();
            onHover(id);
          }}
          onOut={() => onLeave(id)}
        />
      ))}
      <NeutralBody layout={body.layout} />
      {/* The same soft contact shadow as the other stages: one quad, no extra render pass. */}
      <StageShadow bounds={body.layout.bounds} opacity={0.5} />
      <TurntableRig body={body} view={view} spin={turning} onInteract={onInteract} />
      <HoverCursor hover={hover !== null} />
    </Canvas>
  );
}

function TurntableRig({
  body,
  view,
  spin,
  onInteract,
}: {
  body: ResolvedBody;
  view: HomeView;
  spin: boolean;
  onInteract: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const bounds = body.layout.bounds;
  const height = bounds.max[1] - bounds.min[1];
  // The first framing after a return to Home takes the camera it left with.
  const restore = useRef(lastCamera);
  const { controls, fly } = useCameraFlight();
  const lastRequest = useRef<number | null>(null);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const dir = BODY_VIEWS.find((v) => v.name === view.name)!.dir;
    const fit = fitCamera(bounds, dir, size.width, size.height, STAGE_INSETS, MARGIN);
    if ("setViewOffset" in camera)
      camera.setViewOffset(size.width, size.height, fit.offset[0], fit.offset[1], size.width, size.height);
    const saved = restore.current;
    restore.current = null;
    // A press on a view button swings the camera there; the first framing and resizes jump.
    const pressed = lastRequest.current !== null && lastRequest.current !== view.request;
    lastRequest.current = view.request;
    if (saved) fly({ position: saved.position, target: saved.target }, false);
    else
      // Look a little above the middle and from a touch higher, as a photographer would.
      fly(
        {
          position: [fit.position[0], fit.position[1] + height * 0.04, fit.position[2]],
          target: [fit.target[0], fit.target[1] + height * 0.02, fit.target[2]],
        },
        pressed,
      );
  }, [bounds, height, view, camera, size.width, size.height, fly, controls]);
  useEffect(() => {
    const c = controls.current;
    return () => {
      if (c) lastCamera = { position: camera.position.toArray(), target: c.target.toArray() };
    };
  }, [camera, controls]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.1}
      autoRotate={spin}
      autoRotateSpeed={TURNTABLE_SPEED}
      minDistance={height * 0.6}
      maxDistance={height * 6}
      minPolarAngle={Math.PI * 0.18}
      maxPolarAngle={Math.PI * 0.62}
      onStart={onInteract}
    />
  );
}

/** A pointer cursor over a region (a click opens it), the grab hand elsewhere. */
function HoverCursor({ hover }: { hover: boolean }) {
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    canvas.style.setProperty("cursor", hover ? "pointer" : "");
    return () => {
      canvas.style.removeProperty("cursor");
    };
  }, [canvas, hover]);
  return null;
}
