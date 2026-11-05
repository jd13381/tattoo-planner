// The app when a project is open, else the start screen.
import { App } from "../App.tsx";
import { loadError, projectStatus } from "./projectData.ts";
import { NoServer, StartScreen } from "./StartScreen.tsx";

export function ProjectGate() {
  if (!projectStatus || projectStatus.status === "none")
    return (
      <>
        <header className="app-header">
          <span className="brand-mark" aria-hidden="true" />
          <h1 className="brand">Tattoo Planner</h1>
        </header>
        <main className="page start-main">
          {loadError ? <NoServer message={loadError} /> : <StartScreen status={projectStatus} />}
        </main>
      </>
    );
  return <App project={projectStatus} />;
}
