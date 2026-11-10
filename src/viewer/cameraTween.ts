// Short, eased camera moves between the fixed views (Front, Back, Medial, Lateral) instead of a hard
// cut. Framework-free: the viewers step it from a frame loop and always finish on the exact target.
export type Vec3 = [number, number, number];
export type CameraPose = { position: Vec3; target: Vec3 };

/** Duration of a view change; long enough to read the turn, short enough not to wait for it. */
export const CAMERA_TWEEN_MS = 420;

/** Fast start, soft landing (cubic ease-out); t is clamped to [0, 1]. */
export function easeOutCubic(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - c) ** 3;
}

/** Offset of the camera from its target as radius, azimuth (about +Y, from +Z) and polar angle. */
function toSpherical(p: CameraPose) {
  const x = p.position[0] - p.target[0];
  const y = p.position[1] - p.target[1];
  const z = p.position[2] - p.target[2];
  const radius = Math.hypot(x, y, z);
  return {
    radius,
    theta: Math.atan2(x, z),
    phi: radius > 0 ? Math.acos(Math.min(Math.max(y / radius, -1), 1)) : Math.PI / 2,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The camera at `t` (0..1, already eased) on the way from `from` to `to`. The camera swings around
 * the target (the shorter way round; a half turn goes counter-clockwise seen from above) instead
 * of cutting through the model, while the target and the distance glide. t = 1 returns `to` exactly.
 */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  if (t >= 1) return { position: [...to.position], target: [...to.target] };
  if (t <= 0) return { position: [...from.position], target: [...from.target] };
  const a = toSpherical(from);
  const b = toSpherical(to);
  let dTheta = b.theta - a.theta;
  while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
  while (dTheta <= -Math.PI) dTheta += 2 * Math.PI;
  const radius = lerp(a.radius, b.radius, t);
  const theta = a.theta + dTheta * t;
  const phi = lerp(a.phi, b.phi, t);
  const target: Vec3 = [
    lerp(from.target[0], to.target[0], t),
    lerp(from.target[1], to.target[1], t),
    lerp(from.target[2], to.target[2], t),
  ];
  const s = Math.sin(phi) * radius;
  return {
    position: [
      target[0] + s * Math.sin(theta),
      target[1] + Math.cos(phi) * radius,
      target[2] + s * Math.cos(theta),
    ],
    target,
  };
}

/** A running camera move: `at(now)` gives the pose and whether the move has finished. */
export function cameraTween(from: CameraPose, to: CameraPose, start: number, duration = CAMERA_TWEEN_MS) {
  return {
    to,
    at(now: number): { pose: CameraPose; done: boolean } {
      const t = duration <= 0 ? 1 : (now - start) / duration;
      if (t >= 1) return { pose: interpolatePose(from, to, 1), done: true };
      return { pose: interpolatePose(from, to, easeOutCubic(t)), done: false };
    },
  };
}
export type CameraTween = ReturnType<typeof cameraTween>;
