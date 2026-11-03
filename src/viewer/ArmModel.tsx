import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, CanvasTexture, SRGBColorSpace } from "three";
import { buildArmMesh } from "../arm/geometry.ts";
import type { ArmProfile } from "../arm/profile.ts";
import { paintGrid } from "../render/cmGrid.ts";

/** Texture resolution of the cm grid; 24 px per cm keeps the texture under 2048 px for real arms. */
const PX_PER_CM = 24;

export function ArmModel({ profile }: { profile: ArmProfile }) {
  const geometry = useMemo(() => {
    const mesh = buildArmMesh(profile);
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
    return g;
  }, [profile]);

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(profile.maxCircumference * PX_PER_CM);
    canvas.height = Math.ceil(profile.length * PX_PER_CM);
    const ctx = canvas.getContext("2d");
    if (ctx) paintGrid(ctx, profile, PX_PER_CM);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [profile]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial attach="material-0" map={texture} roughness={0.85} />
      <meshStandardMaterial attach="material-1" color="#d9cfc4" roughness={0.9} />
    </mesh>
  );
}
