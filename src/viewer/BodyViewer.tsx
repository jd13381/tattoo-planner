// The full-body view (docs/adr/0011): every region placed in the body, textured with its layout where
// one exists, the parts nobody edits (head, neck, hands, feet, hips, shoulders) in neutral skin.
// Clicking a region picks it for the editor. Straight A-pose: the elbow bend stays in the region view.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BufferGeometry } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ResolvedBody } from "../body/body.ts";
import type { Placement } from "../body/placement.ts";
import { REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import { armGeometry, CAP_COLOR, CAP_ROUGHNESS, LIGHTS, SKIN_ROUGHNESS, skinTexture } from "./scene.ts";
import { useFreeInsets } from "./useFreeInsets.ts";
import { BODY_VIEWS, boundsAspect, CAMERA_FOV, fitCamera, type BodyViewName } from "./views.ts";

/** Regions without a layout: plain skin, a shade lighter than the parts nobody edits. */
export const NEUTRAL_SKIN = "#e8ddd2";

export type RegionTexture = { canvas: HTMLCanvasElement; version: number };

type Props = {
  body: ResolvedBody;
  /** The unwrap texture per region; regions without one are drawn in neutral skin. */
  textures: Partial<Record<RegionId, RegionTexture>>;
  /** The region open in the editor. */
  active: RegionId;
  onPick: (id: RegionId) => void;
  /** Renders the camera presets into this element (the page's floating bar). */
  toolbarTarget?: HTMLElement | null;
  /** The camera presets frame the body clear of the `.float` panels inside this element. */
  frameAround?: HTMLElement | null;
};

export function BodyViewer({ body, textures, active, onPick, toolbarTarget, frameAround }: Props) {
  const [view, setView] = useState<{ name: BodyViewName; request: number }>({ name: "front", request: 0 });
  const [hover, setHover] = useState<RegionId | null>(null);
  const geometries = useMemo(
    () =>
      Object.fromEntries(REGION_IDS.map((id) => [id, armGeometry(body.regions[id].profile)])) as Record<
        RegionId,
        BufferGeometry
      >,
    [body],
  );
  useEffect(() => () => Object.values(geometries).forEach((g) => g.dispose()), [geometries]);

  const toolbar = (
    <span className="segmented" role="group" aria-label="Body view">
      {BODY_VIEWS.map((v) => (
        <button
          key={v.name}
          type="button"
          className={view.name === v.name ? "active" : ""}
          aria-pressed={view.name === v.name}
          onClick={() => setView((s) => ({ name: v.name, request: s.request + 1 }))}
        >
          {v.label}
        </button>
      ))}
    </span>
  );

  return (
    <div className="viewer">
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbarTarget === undefined && toolbar}
      <div className={`canvas-wrap${hover ? " picking" : ""}`}>
        <span className="viewer-label">
          {hover
            ? `${REGIONS[hover].label}: click to edit`
            : `Editing ${REGIONS[active].label.toLowerCase()}`}
        </span>
        <Canvas
          camera={{ fov: CAMERA_FOV, near: 1, far: 4000 }}
          gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
          dpr={[1, 2]}
          onPointerMissed={() => setHover(null)}
        >
          <hemisphereLight
            args={[LIGHTS.hemisphere.sky, LIGHTS.hemisphere.ground, LIGHTS.hemisphere.intensity]}
          />
          <directionalLight position={LIGHTS.key.position} intensity={LIGHTS.key.intensity} />
          <directionalLight position={LIGHTS.fill.position} intensity={LIGHTS.fill.intensity} />
          {REGION_IDS.map((id) => (
            <RegionMesh
              key={id}
              geometry={geometries[id]}
              placement={body.layout.placements[id]}
              texture={textures[id]}
              highlight={hover === id}
              onClick={(e) => {
                // A drag that rotated the camera is not a pick.
                if (e.delta > 4) return;
                e.stopPropagation();
                onPick(id);
              }}
              onOver={(e) => {
                e.stopPropagation();
                setHover(id);
              }}
              onOut={() => setHover((h) => (h === id ? null : h))}
            />
          ))}
          {body.layout.parts.map((p) => (
            <mesh key={p.name} position={p.centre} rotation={[0, 0, p.rotZ]} scale={p.radii}>
              <sphereGeometry args={[1, 40, 24]} />
              <meshStandardMaterial color={CAP_COLOR} roughness={CAP_ROUGHNESS} />
            </mesh>
          ))}
          <BodyCameraRig body={body} view={view.name} request={view.request} frameAround={frameAround} />
        </Canvas>
      </div>
    </div>
  );
}

function RegionMesh(props: {
  geometry: BufferGeometry;
  placement: Placement;
  texture?: RegionTexture;
  highlight: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onOver: (e: ThreeEvent<PointerEvent>) => void;
  onOut: () => void;
}) {
  const { geometry, placement, texture, highlight } = props;
  const map = useMemo(
    () => (texture ? skinTexture(texture.canvas) : null),
    // A new texture per content version, as in ArmModel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture?.canvas, texture?.version],
  );
  useEffect(() => () => map?.dispose(), [map]);
  const emissive = highlight ? "#5a2a18" : "#000000";
  return (
    <mesh
      geometry={geometry}
      position={placement.origin}
      rotation={[0, 0, placement.rotZ]}
      onClick={props.onClick}
      onPointerOver={props.onOver}
      onPointerOut={props.onOut}
    >
      <meshStandardMaterial
        attach="material-0"
        key={map ? "map" : "plain"}
        map={map}
        color={map ? "#ffffff" : NEUTRAL_SKIN}
        roughness={SKIN_ROUGHNESS}
        emissive={emissive}
        emissiveIntensity={0.35}
      />
      <meshStandardMaterial
        attach="material-1"
        color={CAP_COLOR}
        roughness={CAP_ROUGHNESS}
        emissive={emissive}
        emissiveIntensity={0.35}
      />
    </mesh>
  );
}

const BODY_MARGIN = 1.1;

function BodyCameraRig({
  body,
  view,
  request,
  frameAround,
}: {
  body: ResolvedBody;
  view: BodyViewName;
  request: number;
  frameAround?: HTMLElement | null;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const bounds = body.layout.bounds;
  const dir = BODY_VIEWS.find((v) => v.name === view)!.dir;
  const insets = useFreeInsets(frameAround, boundsAspect(bounds, dir, BODY_MARGIN));
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const fit = fitCamera(bounds, dir, size.width, size.height, insets, BODY_MARGIN);
    if ("setViewOffset" in camera) {
      if (fit.offset[0] === 0 && fit.offset[1] === 0) camera.clearViewOffset();
      else
        camera.setViewOffset(size.width, size.height, fit.offset[0], fit.offset[1], size.width, size.height);
    }
    camera.position.set(...fit.position);
    c.target.set(...fit.target);
    c.update();
    // `dir` follows `view`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, view, request, camera, size.width, size.height, insets]);
  return <OrbitControls ref={controls} makeDefault enableDamping={false} />;
}
