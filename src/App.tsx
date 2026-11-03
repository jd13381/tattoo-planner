import { useState } from "react";
import { ComparePage } from "./compare/ComparePage.tsx";
import { DataFolderPage } from "./data/DataFolderPage.tsx";
import { LayoutPage } from "./editor/LayoutPage.tsx";
import type { WorkingLayout } from "./layout/useLayouts.ts";
import { ArmPage } from "./viewer/ArmPage.tsx";
import { useArm } from "./viewer/useArm.ts";

const TABS = [
  { id: "layout", label: "Layout" },
  { id: "compare", label: "Compare" },
  { id: "arm", label: "Arm & measurements" },
  { id: "data", label: "Data folder" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<TabId>("layout");
  const arm = useArm();
  const [working, setWorking] = useState<WorkingLayout | null>(null);
  // Elbow flexion in degrees, shared by every 3D view (Arm, Layout, Compare).
  const [bendDeg, setBendDeg] = useState(0);
  const pose = { bendDeg, setBendDeg };
  return (
    <main className="page">
      <header className="page-header">
        <h1>Tattoo Planner</h1>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "active" : ""}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {/* The Layout tab stays mounted (hidden), so unsaved edits survive a look at another tab. */}
      <div hidden={tab !== "layout"}>
        <LayoutPage arm={arm} pose={pose} onWorking={setWorking} />
      </div>
      {tab === "compare" && <ComparePage arm={arm} pose={pose} working={working} />}
      {tab === "arm" && <ArmPage arm={arm} pose={pose} />}
      {tab === "data" && <DataFolderPage />}
    </main>
  );
}
