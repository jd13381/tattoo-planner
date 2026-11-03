// Offscreen renders of the four fixed views for the export (PROJECT_BRIEF.md §10.1 F2, F10): the
// same mesh, materials and lights as the live viewer (src/viewer/scene.ts), on a white background,
// at print resolution. Browser only (WebGL); the maths it relies on is tested elsewhere.
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type { ArmProfile } from "../arm/profile.ts";
import {
  armGeometry,
  CAP_COLOR,
  CAP_ROUGHNESS,
  LIGHTS,
  SKIN_ROUGHNESS,
  skinTexture,
} from "../viewer/scene.ts";
import { CAMERA_FOV, viewCamera, type ViewName } from "../viewer/views.ts";
import { contentBounds, padRect, unionRect, type Rect } from "./pdfLayout.ts";

export const EXPORT_BACKGROUND: [number, number, number] = [255, 255, 255];

export type ViewRenderOptions = { width: number; height: number };

/**
 * Renders the views of one or more textures (e.g. blockout and reference) with a single WebGL
 * context, which is released afterwards. Results are 2D canvases, keyed by texture name and view.
 */
export function renderArmViews<K extends string>(
  profile: ArmProfile,
  textures: Record<K, HTMLCanvasElement>,
  views: ViewName[],
  opts: ViewRenderOptions,
): Record<K, Record<ViewName, HTMLCanvasElement>> {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(opts.width, opts.height, false);
  // As React Three Fiber sets up the live viewer.
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  scene.background = new Color(`rgb(${EXPORT_BACKGROUND.join(",")})`);
  scene.add(
    new HemisphereLight(LIGHTS.hemisphere.sky, LIGHTS.hemisphere.ground, LIGHTS.hemisphere.intensity),
  );
  const key = new DirectionalLight("#ffffff", LIGHTS.key.intensity);
  key.position.set(...LIGHTS.key.position);
  const fill = new DirectionalLight("#ffffff", LIGHTS.fill.intensity);
  fill.position.set(...LIGHTS.fill.position);
  scene.add(key, fill);

  const geometry = armGeometry(profile);
  const skin = new MeshStandardMaterial({ roughness: SKIN_ROUGHNESS });
  const cap = new MeshStandardMaterial({ color: CAP_COLOR, roughness: CAP_ROUGHNESS });
  scene.add(new Mesh(geometry, [skin, cap]));
  const camera = new PerspectiveCamera(CAMERA_FOV, opts.width / opts.height, 1, 2000);

  const out = {} as Record<K, Record<ViewName, HTMLCanvasElement>>;
  try {
    for (const name of Object.keys(textures) as K[]) {
      const texture = skinTexture(textures[name]);
      skin.map = texture;
      skin.needsUpdate = true;
      out[name] = {} as Record<ViewName, HTMLCanvasElement>;
      for (const view of views) {
        // A tight frame: the result is cropped to the arm afterwards anyway.
        const { position, target } = viewCamera(profile, view, opts.width / opts.height, 1.16);
        camera.position.set(...position);
        camera.lookAt(...target);
        renderer.render(scene, camera);
        const c = document.createElement("canvas");
        c.width = opts.width;
        c.height = opts.height;
        c.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
        out[name][view] = c;
      }
      texture.dispose();
    }
  } finally {
    geometry.dispose();
    skin.dispose();
    cap.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}

/** The common bounding box of the arm over all renders, with a small margin (same scale everywhere). */
export function commonCrop(canvases: HTMLCanvasElement[]): Rect | null {
  if (canvases.length === 0) return null;
  const { width, height } = canvases[0]!;
  const rects = canvases.map((c) =>
    contentBounds(
      c.getContext("2d")!.getImageData(0, 0, width, height).data,
      width,
      height,
      EXPORT_BACKGROUND,
    ),
  );
  const u = unionRect(rects);
  return u && padRect(u, Math.round(height * 0.012), width, height);
}

export function cropCanvas(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = r.w;
  c.height = r.h;
  c.getContext("2d")!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}
