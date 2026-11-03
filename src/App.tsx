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
        <LayoutPage arm={arm} onWorking={setWorking} />
      </div>
      {tab === "compare" && <ComparePage arm={arm} working={working} />}
      {tab === "arm" && <ArmPage arm={arm} />}
      {tab === "data" && <DataFolderPage />}
    </main>
  );
}
