// Home's full-body view (docs/adr/0018-home.md): the person's whole body with every region's active
// layout, on a slow turntable that stops as soon as the user takes the camera. View only: a click on
// a region asks the page to open it in the Layout tab. Reuses the full-body meshes of BodyViewer.
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { BufferGeometry } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ResolvedBody } from "../body/body.ts";
import { REGION_IDS, type RegionId } from "../body/regions.ts";
import { RegionMesh, type RegionTexture } from "../viewer/BodyViewer.tsx";
import { NeutralBody } from "../viewer/NeutralBody.tsx";
import { armGeometry } from "../viewer/scene.ts";
import { BODY_VIEWS, CAMERA_FOV, fitCamera, type BodyViewName } from "../viewer/views.ts";

/** Studio lights: a warm key, a soft fill and two cool rim lights that draw the silhouette. */
const STUDIO = {
  hemisphere: { sky: "#fff7f0", ground: "#3d3733", intensity: 0.7 },
  key: { position: [70, 150, 120] as const, intensity: 1.8, color: "#fff1e4" },
  fill: { position: [-110, 60, 80] as const, intensity: 0.45, color: "#f3f1ff" },
  rimLeft: { position: [-120, 120, -140] as const, intensity: 1.1, color: "#dfe4ff" },
  rimRight: { position: [130, 90, -120] as const, intensity: 0.8, color: "#ffe6d6" },
};
/** Emissive tint of the region under the pointer: a cool lift that reads on skin and ink. */
const HIGHLIGHT = "#3a3478";
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
  const floor = body.layout.bounds.min[1];
  const width = body.layout.bounds.max[0] - body.layout.bounds.min[0];

  return (
    <Canvas
      className="home-canvas"
      camera={{ fov: CAMERA_FOV, near: 1, far: 5000 }}
      gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
      dpr={[1, 2]}
      onPointerMissed={() => onLeave(null)}
    >
      <hemisphereLight
        args={[STUDIO.hemisphere.sky, STUDIO.hemisphere.ground, STUDIO.hemisphere.intensity]}
      />
      {(["key", "fill", "rimLeft", "rimRight"] as const).map((k) => (
        <directionalLight
          key={k}
          position={[...STUDIO[k].position]}
          intensity={STUDIO[k].intensity}
          color={STUDIO[k].color}
        />
      ))}
      {REGION_IDS.map((id) => (
        <RegionMesh
          key={id}
          geometry={geometries[id]}
          placement={body.layout.placements[id]}
          texture={textures[id]}
          highlight={hover === id}
          highlightColor={HIGHLIGHT}
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
      <ContactShadows
        position={[0, floor + 0.2, 0]}
        scale={Math.max(width * 2.2, 120)}
        far={60}
        blur={2.6}
        opacity={0.5}
        resolution={512}
      />
      <TurntableRig body={body} view={view} spin={spin} onInteract={onInteract} />
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
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const bounds = body.layout.bounds;
  const height = bounds.max[1] - bounds.min[1];
  // The first framing after a return to Home takes the camera it left with.
  const restore = useRef(lastCamera);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const dir = BODY_VIEWS.find((v) => v.name === view.name)!.dir;
    const fit = fitCamera(bounds, dir, size.width, size.height, STAGE_INSETS, MARGIN);
    if ("setViewOffset" in camera)
      camera.setViewOffset(size.width, size.height, fit.offset[0], fit.offset[1], size.width, size.height);
    const saved = restore.current;
    restore.current = null;
    if (saved) {
      camera.position.set(...saved.position);
      c.target.set(...saved.target);
    } else {
      // Look a little above the middle and from a touch higher, as a photographer would.
      camera.position.set(fit.position[0], fit.position[1] + height * 0.04, fit.position[2]);
      c.target.set(fit.target[0], fit.target[1] + height * 0.02, fit.target[2]);
    }
    c.update();
  }, [bounds, height, view, camera, size.width, size.height]);
  useEffect(() => {
    const c = controls.current;
    return () => {
      if (c) lastCamera = { position: camera.position.toArray(), target: c.target.toArray() };
    };
  }, [camera]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
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
