import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AssetsPage } from "./assets/AssetsPage.tsx";
import { ComparePage } from "./compare/ComparePage.tsx";
import { ImageEditPage } from "./edits/ImageEditPage.tsx";
import { REGION_IDS, REGIONS } from "./body/regions.ts";
import { LayoutPage, type HeaderSlots, type LayoutRequest } from "./editor/LayoutPage.tsx";
import { currentPlatform } from "./editor/useLayoutShortcuts.ts";
import { HomePage } from "./home/HomePage.tsx";
import type { WorkingLayout } from "./layout/useLayouts.ts";
import { closeProject, discardingChanges, reloadDiscardingChanges, reloadForProject } from "./project/api.ts";
import { usePersons } from "./project/personsStore.ts";
import { PersonAvatar, PersonMenu, switchPerson } from "./project/PersonSwitcher.tsx";
import type { ProjectStatus } from "./project/schema.ts";
import {
  DEFAULT_SECTION,
  FROM_HOME_STATE,
  isFromHome,
  parseRoute,
  routeHash,
  SETTINGS_SECTIONS,
  TABS,
  type Route,
  type SettingsSection,
  type TabId,
} from "./settings/routes.ts";
import { KeyCheckNotice } from "./settings/KeyCheckNotice.tsx";
import { SettingsPage } from "./settings/SettingsPage.tsx";
import { CommandPalette, type PaletteCommand } from "./ui/CommandPalette.tsx";
import { isPaletteChord } from "./ui/commands.ts";
import {
  AssetsIcon,
  BodyRegionIcon,
  CompareIcon,
  FolderIcon,
  HomeIcon,
  LayoutTabIcon,
  LeaveIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  StudioIcon,
  SunIcon,
  UserIcon,
} from "./ui/icons.tsx";
import type { Theme } from "./ui/theme.ts";
import { ToastRegion, useToast } from "./ui/Toast.tsx";
import { keyLabel, tip, TooltipLayer } from "./ui/Tooltip.tsx";
import { useTheme } from "./ui/useTheme.ts";
import { useArm } from "./viewer/useArm.ts";

const TAB_ICONS: Record<TabId, ReactNode> = {
  home: <HomeIcon />,
  layout: <LayoutTabIcon />,
  images: <StudioIcon />,
  compare: <CompareIcon />,
  assets: <AssetsIcon />,
  settings: <SettingsIcon />,
};

/** Words that also find a tab in the command palette. */
const TAB_KEYWORDS: Record<TabId, string> = {
  home: "overview body start people",
  layout: "editor unwrap sleeve motifs place",
  images: "edit generate create picture",
  compare: "variants side by side difference",
  assets: "library images motifs references files",
  settings: "preferences options",
};

const THEME_COMMANDS: { theme: Theme; title: string; icon: ReactNode }[] = [
  { theme: "light", title: "Light theme", icon: <SunIcon /> },
  { theme: "dark", title: "Dark theme", icon: <MoonIcon /> },
  { theme: "system", title: "Match the system theme", icon: <MonitorIcon /> },
];

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
  // The Layout tab puts its notices and its picker / save controls into the top bar (the Settings
  // flows keep their controls in their own bar, next to the work).
  const [noticesSlot, setNoticesSlot] = useState<HTMLDivElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const header: HeaderSlots = { notices: noticesSlot, actions: actionsSlot };
  // Home opens a region's layout in the Layout tab.
  const [layoutRequest, setLayoutRequest] = useState<LayoutRequest | null>(null);
  // Whether the Layout tab was opened from Home: it then shows "‹ Home › person ›" in front of its
  // region picker, and Esc (with nothing selected) or the browser's Back return to Home.
  const [fromHome, setFromHome] = useState(() => isFromHome(window.history.state));
  const { persons, current } = usePersons();
  const [theme, setTheme] = useTheme();
  const toast = useToast();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const compactTabs = useCompactTabs(navRef, tabsRef);

  const setRoute = (r: Route) => {
    setRouteState(r);
    if (r.tab === "settings") setLastSection(r.section);
    // The tab bar replaces the history entry; only Home → region adds one (openFromHome).
    if (r.tab !== "layout") setFromHome(false);
    const hash = routeHash(r);
    if (window.location.hash.slice(1) !== hash) window.history.replaceState(null, "", `#${hash}`);
  };
  const openFromHome = (region: LayoutRequest["region"], variant: string | null) => {
    setLayoutRequest((r) => ({ region, variant, nonce: (r?.nonce ?? 0) + 1 }));
    setRouteState({ tab: "layout" });
    setFromHome(true);
    window.history.pushState(FROM_HOME_STATE, "", "#layout");
  };
  // Back to Home: through the history when Home pushed this entry (the browser's Forward then
  // reopens the layout), otherwise as a tab switch.
  const backToHome = () => {
    if (isFromHome(window.history.state)) window.history.back();
    else setRoute({ tab: "home" });
  };
  const setTab = (id: TabId) => {
    // The Home tab from a region Home opened is the same as Back: no duplicate Home entry.
    if (id === "home" && tab === "layout" && isFromHome(window.history.state)) return backToHome();
    setRoute(id === "settings" ? { tab: "settings", section: lastSection } : { tab: id });
  };
  useEffect(() => {
    // An old or unknown hash (#arm, #data) is rewritten to the route it opened.
    const hash = routeHash(routeFromHash());
    if (window.location.hash.slice(1) !== hash) window.history.replaceState(null, "", `#${hash}`);
    // Back / Forward between Home and a region it opened fire popstate (and hashchange), as does a
    // hash typed into the address bar. Applying the same route twice is harmless.
    const onHash = () => {
      const r = routeFromHash();
      setRouteState(r);
      if (r.tab === "settings") setLastSection(r.section);
      setFromHome(r.tab === "layout" && isFromHome(window.history.state));
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  // Unsaved edits: the browser asks before a reload or close throws them away.
  const unsaved: Partial<Record<TabId, boolean>> = {
    layout: !!working?.dirty,
    settings: projectionDirty || arm.dirty > 0,
  };
  const anyUnsaved = Object.values(unsaved).some(Boolean);
  useEffect(() => {
    if (!anyUnsaved) return;
    // Switching person asks in the page first (src/project/PersonSwitcher.tsx), then reloads.
    const warn = (e: BeforeUnloadEvent) => {
      if (!discardingChanges()) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyUnsaved]);

  // Cmd/Ctrl+K opens the command palette from anywhere, also while typing in a field.
  useEffect(() => {
    const platform = currentPlatform();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.repeat || e.isComposing || !isPaletteChord(e, platform)) return;
      e.preventDefault();
      e.stopPropagation();
      setPaletteOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const openProjectSettings = () => setRoute({ tab: "settings", section: "project" });
  const fail = (e: unknown) => toast.show(e instanceof Error ? e.message : String(e), "error");
  // Built only while the palette is open.
  const commands = (): PaletteCommand[] => [
    ...TABS.map((t) => ({
      id: `go:${t.id}`,
      title: t.label,
      group: "Go to",
      keywords: `open tab ${TAB_KEYWORDS[t.id]}`,
      hint: tab === t.id ? "Open now" : undefined,
      icon: TAB_ICONS[t.id],
      run: () => setTab(t.id),
    })),
    ...REGION_IDS.map((id) => {
      const variant = current?.active?.[id] ?? null;
      return {
        id: `region:${id}`,
        title: REGIONS[id].label,
        group: current ? `Open a layout · ${current.name}` : "Open a layout",
        keywords: `body region layout edit ${REGIONS[id].kind === "arm" ? "sleeve" : ""}`,
        hint: variant ?? undefined,
        icon: <BodyRegionIcon />,
        // The same way in as a region card on Home: Back returns there.
        run: () => openFromHome(id, variant),
      };
    }),
    ...persons
      .filter((p) => p.id !== current?.id)
      .map((p) => ({
        id: `person:${p.id}`,
        title: `Switch to ${p.name}`,
        group: "People",
        keywords: "person body show",
        confirm: anyUnsaved ? `Discard unsaved changes and switch to ${p.name}` : undefined,
        icon: <PersonAvatar person={p} size="sm" />,
        run: () => void switchPerson(p.id).catch(fail),
      })),
    {
      id: "people:menu",
      title: "People and project…",
      group: "People",
      keywords: "switch person add manage menu",
      icon: <UserIcon />,
      run: () => setContextOpen(true),
    },
    ...THEME_COMMANDS.map((t) => ({
      id: `theme:${t.theme}`,
      title: t.title,
      group: "Theme",
      keywords: "appearance colour color mode",
      hint: theme === t.theme ? "On" : undefined,
      icon: t.icon,
      run: () => setTheme(t.theme),
    })),
    {
      id: "project:settings",
      title: project.sample ? "Save the sample as my project…" : "Project settings",
      group: "Project",
      keywords: "project folder name save copy",
      icon: <FolderIcon />,
      run: openProjectSettings,
    },
    ...(project.sample
      ? [
          {
            id: "project:leave-sample",
            title: "Leave the sample",
            group: "Project",
            keywords: "close exit start screen",
            confirm: anyUnsaved ? "Discard unsaved changes and leave the sample" : undefined,
            icon: <LeaveIcon />,
            run: () =>
              void closeProject()
                .then(anyUnsaved ? reloadDiscardingChanges : reloadForProject)
                .catch(fail),
          },
        ]
      : []),
    ...SETTINGS_SECTIONS.map((s) => ({
      id: `settings:${s.id}`,
      title: s.label,
      group: "Settings",
      keywords: "open preferences",
      icon: <SettingsIcon />,
      run: () => setRoute({ tab: "settings", section: s.id }),
    })),
  ];

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
        <h1 className="sr-only">Tattoo Planner</h1>
        <nav ref={navRef} aria-label="Sections" className={compactTabs ? "compact" : undefined}>
          <div className="tabs" role="tablist" ref={tabsRef}>
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
                // Icon-only tabs (a crowded bar) say their name in a tooltip.
                {...(compactTabs && tab !== t.id ? tip(t.label) : {})}
              >
                {TAB_ICONS[t.id]}
                <span className="tab-label">{t.label}</span>
                {unsaved[t.id] && (
                  <span
                    className="tab-dot"
                    role="img"
                    aria-label="unsaved changes"
                    {...tip("Unsaved changes")}
                  />
                )}
              </button>
            ))}
          </div>
        </nav>
        <div className="header-slot" ref={setNoticesSlot} />
        <div className="header-slot" ref={setActionsSlot} />
        <div className="header-global">
          <button
            type="button"
            className="cmdk-trigger"
            aria-label="Search and commands"
            aria-haspopup="dialog"
            aria-expanded={paletteOpen}
            aria-keyshortcuts={currentPlatform() === "mac" ? "Meta+K" : "Control+K"}
            onClick={() => setPaletteOpen(true)}
            {...tip("Search and commands", "Mod+K")}
          >
            <SearchIcon />
            <span className="cmdk-trigger-label">Search</span>
            <kbd className="kbd">{keyLabel("Mod+K")}</kbd>
          </button>
          <PersonMenu
            project={project}
            unsaved={anyUnsaved}
            open={contextOpen}
            onOpenChange={setContextOpen}
            onManage={openProjectSettings}
            onOpenProject={openProjectSettings}
          />
        </div>
      </header>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteOpen ? commands() : []}
      />
      <TooltipLayer />
      <ToastRegion toast={toast} />
      <KeyCheckNotice onOpenSettings={() => setRoute({ tab: "settings", section: "image-generation" })} />
      <main className="page">
        <TabPanel id="home" open={tab === "home"}>
          <HomePage
            project={project}
            arm={arm}
            unsaved={anyUnsaved}
            onOpenProject={() => setRoute({ tab: "settings", section: "project" })}
            onOpenRegion={openFromHome}
          />
        </TabPanel>
        {/* The Layout tab stays mounted (hidden), so unsaved edits survive a look at another tab. */}
        <TabPanel id="layout" open={tab === "layout"} keepMounted>
          <LayoutPage
            arm={arm}
            pose={pose}
            onWorking={setWorking}
            active={tab === "layout"}
            header={header}
            openRequest={layoutRequest}
            onBackToHome={fromHome ? backToHome : undefined}
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
              unsaved={{ projection: projectionDirty, body: arm.dirty > 0 }}
            />
          )}
        </TabPanel>
      </main>
    </>
  );
}

/** Tabs whose page is a full-bleed workspace (no page padding, fills the viewport under the top bar). */
const FULL_BLEED: ReadonlySet<TabId> = new Set(["home", "layout", "compare", "images", "settings"]);

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

/**
 * Whether the tabs must drop their labels (icons only, the open tab keeps its label): true while the
 * full labels do not fit the room the top bar leaves the <nav>. The nav takes all free width, so its
 * width does not depend on the tabs; the tabs' full width is remembered from when they last showed it.
 */
function useCompactTabs(nav: RefObject<HTMLElement | null>, tabs: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  const state = useRef({ compact: false, full: 0 });
  useLayoutEffect(() => {
    const n = nav.current;
    const t = tabs.current;
    if (!n || !t || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const s = state.current;
      if (!s.compact) s.full = t.offsetWidth;
      // A few pixels of slack, so a width right at the edge does not flip back and forth.
      const next = s.compact ? s.full + 8 > n.clientWidth : s.full > n.clientWidth;
      if (next === s.compact) return;
      s.compact = next;
      setCompact(next);
    };
    // Fires once on observe, then whenever the bar or a tab (font load, unsaved dot) changes size.
    const ro = new ResizeObserver(check);
    ro.observe(n);
    ro.observe(t);
    return () => ro.disconnect();
  }, [nav, tabs]);
  return compact;
}
