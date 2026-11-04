// The 3D arm scene shared by the live viewer (ArmViewer.tsx) and the offscreen export renderer
// (src/export/renderViews.ts), so exported views look exactly like the screen.
import { BufferAttribute, BufferGeometry, CanvasTexture, SRGBColorSpace } from "three";
import { bendArmMesh } from "../arm/bend.ts";
import { buildArmMesh } from "../arm/geometry.ts";
import type { ArmProfile } from "../arm/profile.ts";

/**
 * The live viewer's canvas is transparent so the workspace gradient (CSS, .canvas-wrap) shows
 * through; screenshots are flattened onto this colour. The PDF export uses EXPORT_BACKGROUND.
 */
export const VIEWER_BACKGROUND = "#111116";
export const LIGHTS = {
  hemisphere: { sky: "#ffffff", ground: "#4a4440", intensity: 1.2 },
  key: { position: [60, 120, 90] as [number, number, number], intensity: 1.6 },
  fill: { position: [-80, 40, -60] as [number, number, number], intensity: 0.5 },
};
export const SKIN_ROUGHNESS = 0.85;
export const CAP_COLOR = "#d9cfc4";
export const CAP_ROUGHNESS = 0.9;

/**
 * Arm mesh with two material groups: 0 = textured skin, 1 = the rounded end caps. `bendDeg` flexes
 * the elbow (src/arm/bend.ts); the UVs stay the same, so the texture bends with the skin.
 */
export function armGeometry(profile: ArmProfile, bendDeg = 0): BufferGeometry {
  const mesh = bendArmMesh(buildArmMesh(profile), profile, bendDeg);
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
