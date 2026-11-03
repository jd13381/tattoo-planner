import { useEffect, useMemo } from "react";
import type { BufferGeometry } from "three";
import { CAP_COLOR, CAP_ROUGHNESS, SKIN_ROUGHNESS, skinTexture } from "./scene.ts";

type Props = {
  /** The arm mesh (src/viewer/scene.ts armGeometry), straight or bent; owned by the caller. */
  geometry: BufferGeometry;
  /** The unwrap texture (outer-centred, shoulder at the top), see src/render/unwrapCanvas.ts. */
  canvas: HTMLCanvasElement;
  /** Bumped whenever the canvas content changes. */
  version: number;
};

export function ArmModel({ geometry, canvas, version }: Props) {
  const texture = useMemo(
    () => skinTexture(canvas),
    // A new texture per content version: the canvas may have changed size, which needsUpdate cannot handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas, version],
  );

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial attach="material-0" map={texture} roughness={SKIN_ROUGHNESS} />
      <meshStandardMaterial attach="material-1" color={CAP_COLOR} roughness={CAP_ROUGHNESS} />
    </mesh>
  );
}
