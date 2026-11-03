import { useState } from "react";
import { DataFolderPage } from "./data/DataFolderPage.tsx";
import { LayoutPage } from "./editor/LayoutPage.tsx";
import { ArmPage } from "./viewer/ArmPage.tsx";
import { useArm } from "./viewer/useArm.ts";

const TABS = [
  { id: "layout", label: "Layout" },
  { id: "arm", label: "Arm & measurements" },
  { id: "data", label: "Data folder" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<TabId>("layout");
  const arm = useArm();
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
      {tab === "layout" && <LayoutPage arm={arm} />}
      {tab === "arm" && <ArmPage arm={arm} />}
      {tab === "data" && <DataFolderPage />}
    </main>
  );
}
