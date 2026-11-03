import { useEffect, useMemo } from "react";
import type { ArmProfile } from "../arm/profile.ts";
import { armGeometry, CAP_COLOR, CAP_ROUGHNESS, SKIN_ROUGHNESS, skinTexture } from "./scene.ts";

type Props = {
  profile: ArmProfile;
  /** The unwrap texture (outer-centred, shoulder at the top), see src/render/unwrapCanvas.ts. */
  canvas: HTMLCanvasElement;
  /** Bumped whenever the canvas content changes. */
  version: number;
};

export function ArmModel({ profile, canvas, version }: Props) {
  const geometry = useMemo(() => armGeometry(profile), [profile]);

  const texture = useMemo(
    () => skinTexture(canvas),
    // A new texture per content version: the canvas may have changed size, which needsUpdate cannot handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas, version],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial attach="material-0" map={texture} roughness={SKIN_ROUGHNESS} />
      <meshStandardMaterial attach="material-1" color={CAP_COLOR} roughness={CAP_ROUGHNESS} />
    </mesh>
  );
}
