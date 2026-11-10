// A small tooltip for any control: put `data-tip="Undo"` on the element (or spread `tip("Undo",
// "Mod+Z")`), and the one <TooltipLayer /> in the app shows it after a short delay on hover and at
// once on keyboard focus. The layer is a single element moved by hand, so a tooltip costs no React
// state and is never clipped by a scrolling parent.
//
// The tooltip is decoration: keep an accessible name on the control (its text, or aria-label), and
// do not also set `title`, or the browser shows its own tooltip on top.
//
//   <button type="button" className="icon-button" aria-label="Undo" {...tip("Undo", "Mod+Z")}>
//
// Optional: data-tip-side="top" | "bottom" (default) | "right" | "left".
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatKeys } from "../editor/shortcuts.ts";
import { currentPlatform } from "../editor/useLayoutShortcuts.ts";

export type TipSide = "top" | "bottom" | "left" | "right";

/** The data attributes for a tooltip; `keys` in the notation of src/editor/shortcuts.ts ("Mod+K"). */
export function tip(label: string, keys?: string, side?: TipSide) {
  return {
    "data-tip": label,
    ...(keys ? { "data-tip-keys": keys } : {}),
    ...(side ? { "data-tip-side": side } : {}),
  };
}

/** A key label for this computer ("⌘K", "Ctrl+K"). */
export function keyLabel(keys: string): string {
  return formatKeys(keys, currentPlatform());
}

const SHOW_DELAY_MS = 450;
/** Moving on to the next control within this time shows its tooltip without the delay. */
const WARM_MS = 400;
const GAP = 7;
const EDGE = 6;

function place(layer: HTMLElement, anchor: Element) {
  const a = anchor.getBoundingClientRect();
  const w = layer.offsetWidth;
  const h = layer.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let side = (anchor.getAttribute("data-tip-side") as TipSide | null) ?? "bottom";
  if (side === "bottom" && a.bottom + GAP + h > vh - EDGE) side = "top";
  else if (side === "top" && a.top - GAP - h < EDGE) side = "bottom";
  else if (side === "right" && a.right + GAP + w > vw - EDGE) side = "left";
  else if (side === "left" && a.left - GAP - w < EDGE) side = "right";
  let x: number;
  let y: number;
  if (side === "top" || side === "bottom") {
    x = a.left + a.width / 2 - w / 2;
    y = side === "bottom" ? a.bottom + GAP : a.top - GAP - h;
  } else {
    x = side === "right" ? a.right + GAP : a.left - GAP - w;
    y = a.top + a.height / 2 - h / 2;
  }
  x = Math.max(EDGE, Math.min(x, vw - w - EDGE));
  y = Math.max(EDGE, Math.min(y, vh - h - EDGE));
  layer.style.left = `${Math.round(x)}px`;
  layer.style.top = `${Math.round(y)}px`;
  layer.dataset.side = side;
}

/** Mount once (App does). Shows the tooltip of whatever [data-tip] element is hovered or focused. */
export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    let anchor: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hiddenAt = 0;

    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (anchor && layer.classList.contains("open")) hiddenAt = Date.now();
      anchor = null;
      layer.classList.remove("open");
    };
    const show = (el: Element) => {
      const label = el.getAttribute("data-tip");
      if (!label || !el.isConnected) return;
      layer.replaceChildren(label);
      const keys = el.getAttribute("data-tip-keys");
      if (keys) {
        const kbd = document.createElement("kbd");
        kbd.className = "kbd";
        kbd.textContent = keyLabel(keys);
        layer.append(kbd);
      }
      place(layer, el);
      layer.classList.add("open");
    };
    const aim = (el: Element | null, now: boolean) => {
      if (el === anchor) return;
      hide();
      if (!el) return;
      anchor = el;
      const wait = now || Date.now() - hiddenAt < WARM_MS ? 0 : SHOW_DELAY_MS;
      timer = setTimeout(() => anchor === el && show(el), wait);
    };
    const tipOf = (t: EventTarget | null) => (t instanceof Element ? t.closest("[data-tip]") : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      aim(tipOf(e.target), false);
    };
    const onFocus = (e: FocusEvent) => {
      const el = tipOf(e.target);
      // Only for keyboard focus: a click has just shown (and dismissed) the hover tooltip.
      if (el && e.target instanceof Element && e.target.matches(":focus-visible")) aim(el, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onLeave = () => hide();

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", hide, true);
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", hide, true);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  return createPortal(<div ref={ref} className="tip-layer" aria-hidden="true" />, document.body);
}
