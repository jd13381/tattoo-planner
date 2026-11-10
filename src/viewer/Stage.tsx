// The look shared by every live 3D view (Layout, Settings → Body, Compare, Home): renderer settings,
// the studio light rig, a soft contact shadow under the model, the hover outline of a region, and
// the eased camera moves between fixed views. The PDF export keeps its own setup (renderViews.ts).
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  BackSide,
  CanvasTexture,
  Color,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  ShaderMaterial,
  SRGBColorSpace,
  type Camera,
  type Group,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { cameraTween, CAMERA_TWEEN_MS, type CameraPose, type CameraTween } from "./cameraTween.ts";
import { STAGE_EXPOSURE, STAGE_LIGHTS } from "./scene.ts";
import type { Bounds } from "./views.ts";

/**
 * Renderer options of the live viewers: transparent (the stage gradient is CSS and follows the
 * theme), antialiased, Khronos PBR Neutral tone mapping (true colours for the artwork). The drawing
 * buffer is kept for the Screenshot button. One object, so the Canvas does not re-apply it per render.
 */
export const STAGE_GL = {
  preserveDrawingBuffer: true,
  antialias: true,
  alpha: true,
  toneMapping: NeutralToneMapping,
  toneMappingExposure: STAGE_EXPOSURE,
} as const;
/** Device pixel ratio: sharp on Retina, never above 2 (a 5K display would quadruple the fill cost). */
export const STAGE_DPR: [number, number] = [1, 2];

/** The studio rig; the directional lights follow the camera (see STAGE_LIGHTS). */
export function StageLights() {
  const rig = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  // Runs on every rendered frame only (the views render on demand), after the controls moved the camera.
  useFrame(() => {
    rig.current?.quaternion.copy(camera.quaternion);
  });
  const L = STAGE_LIGHTS;
  return (
    <>
      <hemisphereLight args={[L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity]} />
      <group ref={rig}>
        {(["key", "fill", "rim", "kicker"] as const).map((k) => (
          <directionalLight
            key={k}
            position={L[k].position.map((v) => v * 100) as [number, number, number]}
            intensity={L[k].intensity}
            color={L[k].color}
          />
        ))}
      </group>
    </>
  );
}

let shadowMap: CanvasTexture | null = null;
/** A soft radial falloff, drawn once and shared by every stage. */
function shadowTexture(): CanvasTexture {
  if (shadowMap) return shadowMap;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(0,0,0,1)");
  r.addColorStop(0.35, "rgba(0,0,0,0.55)");
  r.addColorStop(0.7, "rgba(0,0,0,0.14)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  shadowMap = new CanvasTexture(c);
  shadowMap.colorSpace = SRGBColorSpace;
  return shadowMap;
}

const noRaycast = () => null;

/**
 * A soft contact shadow under the model: one camera-facing sprite with a blurred ellipse, so it reads
 * as a floor from the level fixed views (a floor plane would be seen edge-on) and costs one quad.
 * It never takes pointer events (picking and the brush hit the skin only).
 */
export function StageShadow({ bounds, opacity = 0.42 }: { bounds: Bounds; opacity?: number }) {
  const map = useMemo(() => shadowTexture(), []);
  const width = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
  const height = bounds.max[1] - bounds.min[1];
  const w = Math.max(width * 1.5, height * 0.18);
  return (
    <sprite
      raycast={noRaycast}
      position={[
        (bounds.min[0] + bounds.max[0]) / 2,
        bounds.min[1] - height * 0.012,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]}
      scale={[w, w * 0.2, 1]}
      renderOrder={-1}
    >
      <spriteMaterial map={map} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

/** A CSS colour token of the current theme (e.g. --accent), for materials. */
export function themeColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}

/**
 * The hover outline: the region's own geometry pushed out along its normals and drawn back faces
 * only, in the accent colour, so the region under the pointer gets a crisp rim that reads on skin
 * and ink alike. Drawn only while hovered; one extra draw call.
 */
export function useOutlineMaterial(width: number): ShaderMaterial {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { color: { value: new Color("#7c6cff") }, width: { value: width } },
        vertexShader: `uniform float width;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normalize(normal) * width, 1.0);
}`,
        fragmentShader: `uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`,
        side: BackSide,
        toneMapped: false,
      }),
    [width],
  );
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** Sets an outline material to the theme's accent (read when the hover starts). */
export function applyAccent(material: ShaderMaterial) {
  // Raw sRGB value: the shader writes it straight to the screen, unconverted.
  (material.uniforms.color!.value as Color).setStyle(themeColor("--accent", "#7c6cff"), LinearSRGBColorSpace);
}

/** Whether the user asked the system for less motion (follows changes). */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Whether an element is on screen in a visible tab (pauses the Home turntable otherwise). */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView && tabVisible;
}

/**
 * Puts the camera exactly on a pose and drops any momentum the damped controls still carry, so a
 * fixed view always ends where it should (also after a fling just before the button press).
 */
export function placeCamera(camera: Camera, c: OrbitControlsImpl, pose: CameraPose) {
  const damping = c.enableDamping;
  c.enableDamping = false;
  c.update(); // without damping, update() clears the leftover rotation and pan
  camera.position.set(...pose.position);
  c.target.set(...pose.target);
  c.update();
  c.enableDamping = damping;
}

/**
 * Eased camera moves for the fixed-view buttons, with the OrbitControls ref they drive (pass it to
 * <OrbitControls ref>). `fly(pose, animate, maxDistance?)` swings the camera to the pose in CAMERA_TWEEN_MS, or
 * jumps (reduced motion, first framing, resizes); a running move is replaced by the next one.
 * Frames are requested only while a move runs (the canvases render on demand), and every move ends
 * on the exact pose. The screenshot and export paths never depend on it.
 */
export function useCameraFlight() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const reduced = useReducedMotion();
  const tween = useRef<CameraTween | null>(null);

  useFrame(() => {
    const t = tween.current;
    const c = controls.current;
    if (!t || !c) return;
    const { pose, done } = t.at(performance.now());
    if (done) {
      tween.current = null;
      c.enabled = true;
      placeCamera(camera, c, pose);
    } else {
      camera.position.set(...pose.position);
      c.target.set(...pose.target);
      camera.lookAt(c.target);
      invalidate();
    }
  });

  // Leaving mid-move must not leave the controls switched off.
  useEffect(
    () => () => {
      const c = controls.current;
      if (c) c.enabled = true;
    },
    [],
  );

  const fly = useCallback(
    (to: CameraPose, animate: boolean, maxDistance?: number) => {
      const c = controls.current;
      if (!c) return;
      // The zoom limit must never cut a fixed view short (small canvases back off far).
      if (maxDistance !== undefined) c.maxDistance = maxDistance;
      const from: CameraPose = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [c.target.x, c.target.y, c.target.z],
      };
      const moves =
        Math.hypot(...from.position.map((v, i) => v - to.position[i]!)) > 1e-3 ||
        Math.hypot(...from.target.map((v, i) => v - to.target[i]!)) > 1e-3;
      if (!animate || reduced || !moves) {
        tween.current = null;
        c.enabled = true;
        placeCamera(camera, c, to);
      } else {
        c.enabled = false;
        tween.current = cameraTween(from, to, performance.now(), CAMERA_TWEEN_MS);
      }
      invalidate();
    },
    [camera, invalidate, reduced],
  );

  return { controls, fly };
}
