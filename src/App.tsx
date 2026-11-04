import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ComparePage } from "./compare/ComparePage.tsx";
import { DataFolderPage } from "./data/DataFolderPage.tsx";
import { DATA_DIR_VAR } from "./data/types.ts";
import { useDataFolderStatus, type DataFolderStatus } from "./data/useDataFolderStatus.ts";
import { LayoutPage } from "./editor/LayoutPage.tsx";
import type { WorkingLayout } from "./layout/useLayouts.ts";
import { ProjectionPage } from "./projection/ProjectionPage.tsx";
import { ArmPage } from "./viewer/ArmPage.tsx";
import { useArm } from "./viewer/useArm.ts";

const TABS = [
  { id: "layout", label: "Layout" },
  { id: "compare", label: "Compare" },
  { id: "projection", label: "Projection" },
  { id: "arm", label: "Arm & measurements" },
  { id: "data", label: "Data folder" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** The open tab lives in the URL hash (#compare), so a reload keeps it. */
function tabFromHash(): TabId {
  const id = window.location.hash.slice(1);
  return TABS.find((t) => t.id === id)?.id ?? "layout";
}

export function App() {
  const [tab, setTabState] = useState<TabId>(tabFromHash);
  const arm = useArm();
  const [working, setWorking] = useState<WorkingLayout | null>(null);
  const [projectionDirty, setProjectionDirty] = useState(false);
  // Elbow flexion in degrees, shared by every 3D view (Arm, Layout, Compare).
  const [bendDeg, setBendDeg] = useState(0);
  const pose = { bendDeg, setBendDeg };
  const dataFolder = useDataFolderStatus();

  const setTab = (id: TabId) => {
    setTabState(id);
    if (window.location.hash.slice(1) !== id) window.history.replaceState(null, "", `#${id}`);
  };
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Unsaved edits: the browser asks before a reload or close throws them away.
  const unsaved: Partial<Record<TabId, boolean>> = {
    layout: !!working?.dirty,
    projection: projectionDirty,
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
        <DataFolderChip status={dataFolder} onOpen={() => setTab("data")} />
      </header>
      <main className="page">
        {/* The Layout tab stays mounted (hidden), so unsaved edits survive a look at another tab. */}
        <TabPanel id="layout" open={tab === "layout"} keepMounted>
          <LayoutPage arm={arm} pose={pose} onWorking={setWorking} />
        </TabPanel>
        <TabPanel id="compare" open={tab === "compare"}>
          <ComparePage arm={arm} pose={pose} working={working} />
        </TabPanel>
        <TabPanel id="projection" open={tab === "projection"}>
          <ProjectionPage arm={arm} pose={pose} onDirty={setProjectionDirty} />
        </TabPanel>
        <TabPanel id="arm" open={tab === "arm"}>
          <ArmPage arm={arm} pose={pose} />
        </TabPanel>
        <TabPanel id="data" open={tab === "data"}>
          <DataFolderPage />
        </TabPanel>
      </main>
    </>
  );
}

function TabPanel(props: { id: TabId; open: boolean; keepMounted?: boolean; children: ReactNode }) {
  const { id, open, keepMounted, children } = props;
  if (!open && !keepMounted) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={!open}>
      {children}
    </div>
  );
}

/** One place that says whether TATTOO_DATA_DIR is usable; opens the Data folder tab. */
function DataFolderChip({ status, onOpen }: { status: DataFolderStatus; onOpen: () => void }) {
  if (status.kind === "loading") return null;
  const [tone, text, title] =
    status.kind === "ok"
      ? ["ok", "Data folder", `${DATA_DIR_VAR}: ${status.dir}`]
      : status.kind === "unset"
        ? [
            "warn",
            "No data folder",
            `${DATA_DIR_VAR} is not set: no reference images, photos or export. Click for setup.`,
          ]
        : ["error", "Data folder unreadable", status.message];
  return (
    <button type="button" className={`chip ${tone}`} onClick={onOpen} title={title}>
      {text}
    </button>
  );
}
