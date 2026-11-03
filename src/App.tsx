import { useState } from "react";
import { DataFolderPage } from "./data/DataFolderPage.tsx";
import { ArmPage } from "./viewer/ArmPage.tsx";

const TABS = [
  { id: "arm", label: "Arm" },
  { id: "data", label: "Data folder" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<TabId>("arm");
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
      {tab === "arm" ? <ArmPage /> : <DataFolderPage />}
    </main>
  );
}
