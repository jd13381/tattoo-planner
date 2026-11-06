// The parts of the full body nobody edits, in neutral skin: ellipsoids (head, hands, feet, shoulder
// joints) and the lofts that continue the torso into the pelvis and the neck (docs/adr/0022).
import { useEffect, useMemo } from "react";
import type { BodyLayout } from "../body/placement.ts";
import { CAP_COLOR, CAP_ROUGHNESS, neutralGeometry } from "./scene.ts";

export function NeutralBody({ layout }: { layout: BodyLayout }) {
  const lofts = useMemo(
    () => layout.lofts.map((l) => ({ ...l, geometry: neutralGeometry(l.shape) })),
    [layout.lofts],
  );
  useEffect(() => () => lofts.forEach((l) => l.geometry.dispose()), [lofts]);
  return (
    <>
      {layout.parts.map((p) => (
        <mesh key={p.name} position={p.centre} rotation={[0, 0, p.rotZ]} scale={p.radii}>
          <sphereGeometry args={[1, 40, 24]} />
          <meshStandardMaterial color={CAP_COLOR} roughness={CAP_ROUGHNESS} />
        </mesh>
      ))}
      {lofts.map((l) => (
        <mesh
          key={l.name}
          geometry={l.geometry}
          position={l.placement.origin}
          rotation={[0, 0, l.placement.rotZ]}
        >
          <meshStandardMaterial color={CAP_COLOR} roughness={CAP_ROUGHNESS} />
        </mesh>
      ))}
    </>
  );
}
