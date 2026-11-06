// Hash routes of the app shell (#layout, #settings/projection, …), as a pure mapping so the
// rules for old links and unknown hashes are testable without a DOM.

/** The main tabs, in the order of the top bar. */
export const TABS = [
  { id: "home", label: "Home" },
  { id: "layout", label: "Layout" },
  { id: "images", label: "Image studio" },
  { id: "compare", label: "Compare" },
  { id: "assets", label: "Assets" },
  { id: "settings", label: "Settings" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** The sections of the Settings tab, in the order of its side navigation. */
export const SETTINGS_SECTIONS = [
  { id: "project", label: "Project" },
  { id: "body", label: "Body & measurements" },
  { id: "projection", label: "Projection" },
  { id: "image-generation", label: "Image generation" },
  { id: "appearance", label: "Appearance" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export type Route = { tab: Exclude<TabId, "settings"> } | { tab: "settings"; section: SettingsSection };

/** The app opens on Home (docs/adr/0018-home.md): the whole body of the current person. */
export const DEFAULT_ROUTE: Route = { tab: "home" };
export const DEFAULT_SECTION: SettingsSection = "project";

/** Tabs that became Settings sections: old bookmarks (#arm, #projection, #data) still work. */
const LEGACY: Record<string, SettingsSection> = {
  arm: "body",
  projection: "projection",
  data: "project",
};

/** The route for a location hash ("#settings/body", "compare", ""); unknown hashes open Home. */
export function parseRoute(hash: string): Route {
  const [head = "", sub = ""] = hash.replace(/^#/, "").split("/");
  if (head === "settings") {
    const section = SETTINGS_SECTIONS.find((s) => s.id === sub)?.id ?? DEFAULT_SECTION;
    return { tab: "settings", section };
  }
  if (Object.hasOwn(LEGACY, head)) return { tab: "settings", section: LEGACY[head]! };
  const tab = TABS.find((t) => t.id === head)?.id;
  return tab && tab !== "settings" ? { tab } : DEFAULT_ROUTE;
}

/** The hash (without "#") for a route. */
export function routeHash(r: Route): string {
  return r.tab === "settings" ? `settings/${r.section}` : r.tab;
}
