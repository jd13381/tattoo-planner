// Keeps several 3D viewers on the same camera (side-by-side comparison). Framework-free: each viewer
// publishes its camera after a user interaction and applies what the others publish.
export type Vec3 = [number, number, number];
export type CameraState = { position: Vec3; target: Vec3 };
type Listener = (state: CameraState) => void;

export type CameraSync = {
  /** Sends a camera state to every viewer except `from`. */
  publish(from: string, state: CameraState): void;
  /** Receives the states of the other viewers; returns the unsubscribe function. */
  subscribe(id: string, listener: Listener): () => void;
  /** The last published state, so a viewer that mounts later can join in. */
  last(): CameraState | null;
};

export function createCameraSync(): CameraSync {
  const listeners = new Map<string, Listener>();
  let latest: CameraState | null = null;
  return {
    publish(from, state) {
      latest = { position: [...state.position], target: [...state.target] };
      for (const [id, l] of listeners) if (id !== from) l(latest);
    },
    subscribe(id, listener) {
      listeners.set(id, listener);
      return () => {
        if (listeners.get(id) === listener) listeners.delete(id);
      };
    },
    last: () => latest,
  };
}
