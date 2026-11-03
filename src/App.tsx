import { DataFolderPage } from "./data/DataFolderPage.tsx";

export function App() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Tattoo Planner</h1>
        <p className="muted">Phase 1 sanity check: what the planner sees in the data folder.</p>
      </header>
      <DataFolderPage />
    </main>
  );
}
