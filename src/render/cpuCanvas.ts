// Canvases kept in main memory instead of on the GPU. Browsers (Safari and Chrome) back a 2D canvas
// with a GPU surface unless it is created with `willReadFrequently`. The reference renderer copies
// images one pixel row at a time, often with "multiply": thousands of tiny draws per canvas, plus
// read-backs for PNG/JPEG encoding. On a GPU surface at export resolution that queued enough work to
// stall the whole Mac for up to a minute (the window server shares the GPU) and then fail with
// Safari's "The object is in an invalid state". In main memory the same draws are cheap and local.

/** The 2D context of a canvas, kept in main memory. Must be the first getContext call on it. */
export function cpu2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error(`Cannot create a ${canvas.width}×${canvas.height} px canvas (out of memory?)`);
  return ctx;
}

/** A new main-memory canvas of at least 1×1 px (a 0-px canvas cannot be drawn: InvalidStateError). */
export function cpuCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  cpu2d(c);
  return c;
}

/** Frees a canvas' pixel memory right away instead of at the next garbage collection (Safari keeps it long). */
export function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}
