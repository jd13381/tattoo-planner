// The 3D arm scene shared by the live viewer (ArmViewer.tsx) and the offscreen export renderer
// (src/export/renderViews.ts), so exported views look exactly like the screen.
import { BufferAttribute, BufferGeometry, CanvasTexture, SRGBColorSpace } from "three";
import { bendArmMesh } from "../body/bend.ts";
import { buildLoftMesh } from "../body/geometry.ts";
import type { LoftShape, RegionProfile } from "../body/profile.ts";

/** A neutral loft (pelvis, neck: src/body/placement.ts) as one untextured mesh. */
export function neutralGeometry(shape: LoftShape): BufferGeometry {
  // Same ring layout as the regions, so the rings where they meet coincide.
  const mesh = buildLoftMesh(shape);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  const index = new Uint32Array(mesh.skinIndices.length + mesh.capIndices.length);
  index.set(mesh.skinIndices, 0);
  index.set(mesh.capIndices, mesh.skinIndices.length);
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * The live viewer's canvas is transparent so the workspace gradient (CSS, .canvas-wrap, which
 * follows the theme) shows through; screenshots are flattened onto this colour, per theme. The PDF
 * export uses EXPORT_BACKGROUND, the same in every theme.
 */
export const VIEWER_BACKGROUND = { dark: "#111116", light: "#dedee5" } as const;
/**
 * The PDF export's lights (src/export/renderViews.ts, with ACES tone mapping on white). Kept as they
 * are so the handout stays the same; the live viewers use the studio rig STAGE_LIGHTS below.
 */
export const LIGHTS = {
  hemisphere: { sky: "#ffffff", ground: "#4a4440", intensity: 1.2 },
  key: { position: [60, 120, 90] as [number, number, number], intensity: 1.6 },
  fill: { position: [-80, 40, -60] as [number, number, number], intensity: 0.5 },
};
/**
 * The live viewers' studio rig (src/viewer/Stage.tsx). Positions are in camera space (x right, y up,
 * z towards the viewer) and the rig turns with the camera, so every view and every turntable angle
 * is lit the same way: a warm key from the upper right, a cool low fill from the left, and two rims
 * behind the model that draw its silhouette against the dark stage. The hemisphere stays in world
 * space (sky above, warm bounce from the floor). Colours are only slightly off white so the artwork
 * keeps its colours; Khronos PBR Neutral tone mapping leaves everything below ~0.8 untouched and
 * rolls the highlights off without a hue shift (ACES greyed the paper and darkened the skin).
 */
export const STAGE_LIGHTS = {
  hemisphere: { sky: "#fdfaf7", ground: "#52483f", intensity: 0.85 },
  key: { position: [0.55, 0.6, 0.8] as [number, number, number], intensity: 3.1, color: "#fff9f3" },
  fill: { position: [-0.9, -0.1, 0.45] as [number, number, number], intensity: 0.35, color: "#eef1ff" },
  rim: { position: [-0.75, 0.4, -0.85] as [number, number, number], intensity: 1.5, color: "#ffffff" },
  kicker: { position: [0.9, 0.15, -0.75] as [number, number, number], intensity: 0.4, color: "#fff1e6" },
};
/** Tone mapping exposure of the live viewers (NeutralToneMapping). */
export const STAGE_EXPOSURE = 1.0;
export const SKIN_ROUGHNESS = 0.85;
export const CAP_COLOR = "#d9cfc4";
export const CAP_ROUGHNESS = 0.9;

/**
 * Arm mesh with two material groups: 0 = textured skin, 1 = the rounded end caps. `bendDeg` flexes
 * the elbow (src/body/bend.ts); the UVs stay the same, so the texture bends with the skin.
 */
export function armGeometry(profile: RegionProfile, bendDeg = 0): BufferGeometry {
  const straight = buildLoftMesh(profile);
  // Only arms bend (docs/adr/0005); legs and the torso stay straight in v1.
  const mesh = profile.kind === "arm" ? bendArmMesh(straight, profile, bendDeg) : straight;
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  g.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  const index = new Uint32Array(mesh.skinIndices.length + mesh.capIndices.length);
  index.set(mesh.skinIndices, 0);
  index.set(mesh.capIndices, mesh.skinIndices.length);
  g.setIndex(new BufferAttribute(index, 1));
  g.addGroup(0, mesh.skinIndices.length, 0);
  g.addGroup(mesh.skinIndices.length, mesh.capIndices.length, 1);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The unwrap canvas as a texture (outer-centred, shoulder at the top). */
export function skinTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
