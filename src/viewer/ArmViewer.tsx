import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ArmProfile } from "../arm/profile.ts";
import { ArmModel } from "./ArmModel.tsx";
import { CAMERA_FOV, VIEWS, viewCamera, type ViewName } from "./views.ts";

type Props = { profile: ArmProfile; canvas: HTMLCanvasElement; version: number; hint?: string };

export function ArmViewer({ profile, canvas, version, hint }: Props) {
  const [view, setView] = useState<ViewName>("front");
  // True once the user rotates by hand; the last fixed view stays the one to return to.
  const [free, setFree] = useState(false);
  // Bumped on every view button press, so pressing the current view again resets the camera.
  const [viewRequest, setViewRequest] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const select = (name: ViewName) => {
    setView(name);
    setFree(false);
    setViewRequest((n) => n + 1);
  };

  const screenshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Downloads go to the browser's download folder, never into the repo.
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tattoo-planner-${free ? "free" : view}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };

  return (
    <div className="viewer">
      <div className="toolbar" role="toolbar" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.name}
            type="button"
            className={!free && view === v.name ? "active" : ""}
            title={v.hint}
            onClick={() => select(v.name)}
          >
            {v.label}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" onClick={screenshot}>
          Screenshot
        </button>
      </div>
      <div className="canvas-wrap">
        <Canvas
          ref={canvasRef}
          camera={{ fov: CAMERA_FOV, near: 1, far: 2000 }}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          dpr={[1, 2]}
        >
          <color attach="background" args={["#2a2725"]} />
          <hemisphereLight args={["#ffffff", "#4a4440", 1.2]} />
          <directionalLight position={[60, 120, 90]} intensity={1.6} />
          <directionalLight position={[-80, 40, -60]} intensity={0.5} />
          <ArmModel profile={profile} canvas={canvas} version={version} />
          <CameraRig profile={profile} view={view} request={viewRequest} onFree={() => setFree(true)} />
        </Canvas>
      </div>
      <p className="muted small">
        Drag to rotate, scroll to zoom, right-drag to pan.{" "}
        {hint ?? "Grid: 1 cm, bold every 5 cm; red lines mark outer, lateral, inner and medial centre lines."}
      </p>
    </div>
  );
}

function CameraRig(props: { profile: ArmProfile; view: ViewName; request: number; onFree: () => void }) {
  const { profile, view, request, onFree } = props;
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  // Re-frame on a view request and whenever the arm changes size.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = viewCamera(profile, view, size.width / Math.max(size.height, 1));
    camera.position.set(...position);
    c.target.set(...target);
    c.update();
  }, [profile, view, request, camera, size.width, size.height]);

  return <OrbitControls ref={controls} makeDefault enableDamping={false} onStart={onFree} />;
}
