// "Used in" links of the Assets tab: open a layout with one element selected. The Layout tab stays
// mounted and listens for this window event; the hash switches the tab.

export const SHOW_ELEMENT_EVENT = "tattoo-planner:show-element";

export type ShowElement = { layout: string; element: string };

export function showElement(target: ShowElement): void {
  window.dispatchEvent(new CustomEvent<ShowElement>(SHOW_ELEMENT_EVENT, { detail: target }));
  window.location.hash = "#layout";
}
