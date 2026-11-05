import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { AssetsPage } from "./assets/AssetsPage.tsx";
import { ComparePage } from "./compare/ComparePage.tsx";
import { ImageEditPage } from "./edits/ImageEditPage.tsx";
import { LayoutPage, type HeaderSlots } from "./editor/LayoutPage.tsx";
import type { WorkingLayout } from "./layout/useLayouts.ts";
import type { ProjectStatus } from "./project/schema.ts";
import {
  DEFAULT_SECTION,
  parseRoute,
  routeHash,
  TABS,
  type Route,
  type SettingsSection,
  type TabId,
} from "./settings/routes.ts";
import { SettingsPage } from "./settings/SettingsPage.tsx";
import { useArm } from "./viewer/useArm.ts";

/** The open tab (and Settings section) lives in the URL hash (#settings/projection), so a reload keeps it. */
function routeFromHash(): Route {
  return parseRoute(window.location.hash);
}

export function App({ project }: { project: ProjectStatus }) {
  const [route, setRouteState] = useState<Route>(routeFromHash);
  const tab: TabId = route.tab;
  // The Settings tab reopens the section seen last.
  const [lastSection, setLastSection] = useState<SettingsSection>(
    route.tab === "settings" ? route.section : DEFAULT_SECTION,
  );
  const arm = useArm();
  const [working, setWorking] = useState<WorkingLayout | null>(null);
  const [projectionDirty, setProjectionDirty] = useState(false);
  // Elbow flexion in degrees, shared by every 3D view (Arm, Layout, Compare).
  const [bendDeg, setBendDeg] = useState(0);
  const pose = { bendDeg, setBendDeg };
  // The Layout and Projection tabs put their notices and their picker / save controls into the top bar.
  const [noticesSlot, setNoticesSlot] = useState<HTMLDivElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const header: HeaderSlots = { notices: noticesSlot, actions: actionsSlot };

  const setRoute = (r: Route) => {
    setRouteState(r);
    if (r.tab === "settings") setLastSection(r.section);
    const hash = routeHash(r);
    if (window.location.hash.slice(1) !== hash) window.history.replaceState(null, "", `#${hash}`);
  };
  const setTab = (id: TabId) =>
    setRoute(id === "settings" ? { tab: "settings", section: lastSection } : { tab: id });
  useEffect(() => {
    // An old or unknown hash (#arm, #data) is rewritten to the route it opened.
    const hash = routeHash(routeFromHash());
    if (window.location.hash.slice(1) !== hash) window.history.replaceState(null, "", `#${hash}`);
    const onHash = () => {
      const r = routeFromHash();
      setRouteState(r);
      if (r.tab === "settings") setLastSection(r.section);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Unsaved edits: the browser asks before a reload or close throws them away.
  const unsaved: Partial<Record<TabId, boolean>> = {
    layout: !!working?.dirty,
    settings: projectionDirty,
  };
  const anyUnsaved = Object.values(unsaved).some(Boolean);
  useEffect(() => {
    if (!anyUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyUnsaved]);

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    document.getElementById(`tab-${id}`)?.focus();
  };

  return (
    <>
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true" />
        <h1 className="brand">Tattoo Planner</h1>
        <nav aria-label="Sections">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={onTabKey}
              >
                {t.label}
                {unsaved[t.id] && (
                  <span className="tab-dot" role="img" aria-label="unsaved changes" title="Unsaved changes" />
                )}
              </button>
            ))}
          </div>
        </nav>
        <span className="spacer" />
        <div className="header-slot" ref={setNoticesSlot} />
        <ProjectChip project={project} onOpen={() => setRoute({ tab: "settings", section: "project" })} />
        <div className="header-slot" ref={setActionsSlot} />
      </header>
      <main className="page">
        {/* The Layout tab stays mounted (hidden), so unsaved edits survive a look at another tab. */}
        <TabPanel id="layout" open={tab === "layout"} keepMounted>
          <LayoutPage
            arm={arm}
            pose={pose}
            onWorking={setWorking}
            active={tab === "layout"}
            header={header}
          />
        </TabPanel>
        {/* The Image studio stays mounted too: the picked image, the prompt and the version on view
            survive a look at the Layout tab (the session itself lives in the dev server). */}
        <TabPanel id="images" open={tab === "images"} keepMounted>
          <ImageEditPage active={tab === "images"} />
        </TabPanel>
        <TabPanel id="compare" open={tab === "compare"}>
          <ComparePage arm={arm} pose={pose} working={working} onOpenLayout={() => setTab("layout")} />
        </TabPanel>
        <TabPanel id="assets" open={tab === "assets"}>
          <AssetsPage />
        </TabPanel>
        <TabPanel id="settings" open={tab === "settings"}>
          {route.tab === "settings" && (
            <SettingsPage
              section={route.section}
              onSection={(section) => setRoute({ tab: "settings", section })}
              arm={arm}
              pose={pose}
              onProjectionDirty={setProjectionDirty}
              openLayout={working}
              unsaved={{ projection: projectionDirty }}
              header={header}
            />
          )}
        </TabPanel>
      </main>
    </>
  );
}

/** Tabs whose page is a full-bleed workspace (no page padding, fills the viewport under the top bar). */
const FULL_BLEED: ReadonlySet<TabId> = new Set(["layout", "compare", "images", "settings"]);

function TabPanel(props: { id: TabId; open: boolean; keepMounted?: boolean; children: ReactNode }) {
  const { id, open, keepMounted, children } = props;
  if (!open && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={!open}
      className={FULL_BLEED.has(id) ? "tab-panel full-bleed" : "tab-panel"}
    >
      {children}
    </div>
  );
}

/** The open project's name; opens Settings → Project. */
function ProjectChip({ project, onOpen }: { project: ProjectStatus; onOpen: () => void }) {
  const legacy = project.status === "legacy";
  const tone = project.problem ? "error" : legacy ? "warn" : "ok";
  const title =
    project.problem ??
    (legacy ? `${project.path} · older data folder: open to move it into a project` : (project.path ?? ""));
  return (
    <button type="button" className={`chip ${tone}`} onClick={onOpen} title={title}>
      {project.name ?? "Project"}
    </button>
  );
}
