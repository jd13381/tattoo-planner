// The full-body view (docs/adr/0011): every region placed in the body, textured with its layout where
// one exists, the parts nobody edits (head, neck, hands, feet, hips, shoulders) in neutral skin.
// Clicking a region picks it for the editor. Straight A-pose: the elbow bend stays in the region view.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BufferGeometry } from "three";
import type { ResolvedBody } from "../body/body.ts";
import type { Placement } from "../body/placement.ts";
import { REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import { NeutralBody } from "./NeutralBody.tsx";
import { armGeometry, CAP_COLOR, CAP_ROUGHNESS, SKIN_ROUGHNESS, skinTexture } from "./scene.ts";
import {
  applyAccent,
  STAGE_DPR,
  STAGE_GL,
  StageLights,
  StageShadow,
  useCameraFlight,
  useOutlineMaterial,
} from "./Stage.tsx";
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
          gl={STAGE_GL}
          dpr={STAGE_DPR}
          frameloop="demand"
          onPointerMissed={(e) => {
            setHover(null);
            // Double-click beside the body resets the camera to the current preset.
            if (e.type === "dblclick") setView((s) => ({ name: s.name, request: s.request + 1 }));
          }}
        >
          <StageLights />
          <StageShadow bounds={body.layout.bounds} />
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
          <NeutralBody layout={body.layout} />
          <BodyCameraRig body={body} view={view.name} request={view.request} frameAround={frameAround} />
        </Canvas>
      </div>
    </div>
  );
}

export function RegionMesh(props: {
  geometry: BufferGeometry;
  placement: Placement;
  texture?: RegionTexture;
  highlight: boolean;
  /** Emissive tint of a highlighted region (Home uses a cooler one). */
  highlightColor?: string;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onOver: (e: ThreeEvent<PointerEvent>) => void;
  onOut: () => void;
}) {
  const { geometry, placement, texture, highlight } = props;
  const outline = useOutlineMaterial(OUTLINE_WIDTH);
  useEffect(() => {
    if (highlight) applyAccent(outline);
  }, [highlight, outline]);
  const map = useMemo(
    () => (texture ? skinTexture(texture.canvas) : null),
    // A new texture per content version, as in ArmModel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture?.canvas, texture?.version],
  );
  useEffect(() => () => map?.dispose(), [map]);
  // A gentle neutral lift on top of the outline (a coloured glow would tint the artwork).
  const emissive = highlight ? (props.highlightColor ?? HIGHLIGHT_LIFT) : "#000000";
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
        emissiveIntensity={0.12}
      />
      <meshStandardMaterial
        attach="material-1"
        color={CAP_COLOR}
        roughness={CAP_ROUGHNESS}
        emissive={emissive}
        emissiveIntensity={0.12}
      />
      {highlight && <mesh geometry={geometry} material={outline} raycast={noRaycast} />}
    </mesh>
  );
}

const BODY_MARGIN = 1.1;
/** Width of the hover outline, in cm on the body. */
const OUTLINE_WIDTH = 0.45;
const HIGHLIGHT_LIFT = "#ffffff";
const noRaycast = () => null;

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
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const { controls, fly } = useCameraFlight();
  const lastRequest = useRef<{ view: string; request: number } | null>(null);
  const bounds = body.layout.bounds;
  const height = bounds.max[1] - bounds.min[1];
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
    const distance = Math.hypot(...fit.position.map((v, i) => v - fit.target[i]!));
    const prev = lastRequest.current;
    lastRequest.current = { view, request };
    fly(
      { position: fit.position, target: fit.target },
      prev !== null && (prev.view !== view || prev.request !== request),
      Math.max(height * 5, distance * 1.5),
    );
    invalidate();
    // `dir` follows `view`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, view, request, camera, size.width, size.height, insets, fly, controls, height]);
  // Zoom from the whole body down to a single motif.
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.14}
      minDistance={height * 0.18}
    />
  );
}
