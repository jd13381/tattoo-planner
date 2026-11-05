// Which part of a 3D canvas the floating panels around it leave free (src/viewer/views.ts freeInsets),
// so the fixed views frame a region where it can be seen. Must be used inside a react-three Canvas.
import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { freeInsets, type Insets, type Rect } from "./views.ts";

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function measure(container: HTMLElement, canvas: HTMLCanvasElement, contentAspect: number): Insets | null {
  const c = canvas.getBoundingClientRect();
  if (c.width <= 0 || c.height <= 0) return null;
  const panels: Rect[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(".float")) {
    if (el.contains(canvas)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    panels.push({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height });
  }
  return freeInsets(c.width, c.height, panels, contentAspect);
}

/** Insets of the canvas covered by the `.float` panels inside `container` (none without one). */
export function useFreeInsets(container: HTMLElement | null | undefined, contentAspect: number): Insets {
  const canvas = useThree((s) => s.gl.domElement);
  const [insets, setInsets] = useState<Insets>(NONE);

  // Panels appear, grow and shrink (the coverage table, the inspector), and the canvas resizes:
  // measure again whenever one of them does.
  useEffect(() => {
    if (!container) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure(container, canvas, contentAspect);
        if (next) setInsets((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      });
    };
    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      resize.observe(container);
      resize.observe(canvas);
      for (const el of container.querySelectorAll(".float")) resize.observe(el);
    };
    observe();
    const mutations = new MutationObserver(() => {
      observe();
      update();
    });
    mutations.observe(container, { childList: true, subtree: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [container, canvas, contentAspect]);

  return container ? insets : NONE;
}
