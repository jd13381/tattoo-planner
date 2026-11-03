import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, CanvasTexture, SRGBColorSpace } from "three";
import { buildArmMesh } from "../arm/geometry.ts";
import type { ArmProfile } from "../arm/profile.ts";

type Props = {
  profile: ArmProfile;
  /** The unwrap texture (outer-centred, shoulder at the top), see src/render/unwrapCanvas.ts. */
  canvas: HTMLCanvasElement;
  /** Bumped whenever the canvas content changes. */
  version: number;
};

export function ArmModel({ profile, canvas, version }: Props) {
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
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
    // A new texture per content version: the canvas may have changed size, which needsUpdate cannot handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, version]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial attach="material-0" map={texture} roughness={0.85} />
      <meshStandardMaterial attach="material-1" color="#d9cfc4" roughness={0.9} />
    </mesh>
  );
}
