// The project folder's contents for Settings → Project (src/project/ProjectPage.tsx), in a closed
// "Project folder details" disclosure: file tables on the left, the expected structure and what uses
// it on the right.
import { useEffect, useState } from "react";
import type { ExpectedEntry } from "./expected.ts";
import { countFiles, EXPECTED_ENTRIES, formatSize, groupByFolder, isPresent } from "./expected.ts";
import { DATA_FILES_ENDPOINT, type DataFile, type DataListing } from "./types.ts";

export type State =
  { kind: "loading" } | { kind: "failed"; message: string } | { kind: "loaded"; listing: DataListing };

/** Which parts of the planner read or write the project folder. */
const NEEDS: { feature: string; uses: string }[] = [
  { feature: "Reference mode", uses: "Layout and Compare show the images assigned to figures" },
  { feature: "Layouts", uses: "the variants in layouts/" },
  { feature: "Assets", uses: "manifest.yaml and the images in images/ (and older folders)" },
  { feature: "Projection", uses: "calibrations in projections/, photos in photos/" },
  { feature: "Export", uses: "writes the artist handout and PNGs into exports/" },
  {
    feature: "Image studio",
    uses: "edits reference images (results in edits/) and creates new ones (results in generated/)",
  },
];

export function useDataListing(): { state: State; checking: boolean; check: () => void } {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch(DATA_FILES_ENDPOINT)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DataListing>;
      })
      .then(
        (listing) => !cancelled && setState({ kind: "loaded", listing }),
        (e: unknown) => !cancelled && setState({ kind: "failed", message: String(e) }),
      )
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const check = () => {
    setChecking(true);
    setTick((n) => n + 1);
  };
  return { state, checking, check };
}

/**
 * Settings → Project, last: the folder's files and expected structure in a disclosure that starts
 * closed (it is for troubleshooting). Problems reading the folder show above it, always visible.
 */
export function ProjectFolderDetails() {
  const data = useDataListing();
  const { state } = data;
  const listing = state.kind === "loaded" ? state.listing : null;
  const files = listing?.status === "ok" ? listing.files : null;
  const shown = files ? visibleEntries(files) : null;
  const present = files && shown ? shown.filter((e) => isPresent(e, files)).length : null;
  const meta =
    files && shown
      ? `${files.length} file${files.length === 1 ? "" : "s"} · ${present} of ${shown.length} expected parts`
      : state.kind === "loading"
        ? "Reading the folder…"
        : null;
  return (
    <>
      <FolderProblems state={state} />
      <details className="prj-disclosure">
        <summary>
          <span className="prj-disclosure-text">
            <span className="prj-disclosure-title">Project folder details</span>
            <span className="prj-disclosure-sub">
              What is in the folder and what the planner expects there. Useful for troubleshooting.
            </span>
          </span>
          {meta && <span className="prj-disclosure-meta">{meta}</span>}
        </summary>
        <div className="prj-disclosure-body">
          <FolderContents data={data} />
        </div>
      </details>
    </>
  );
}

function FolderProblems({ state }: { state: State }) {
  const listing = state.kind === "loaded" ? state.listing : null;
  return (
    <>
      {state.kind === "failed" && (
        <p className="notice error" role="alert">
          <strong>The planner's server did not answer:</strong> {state.message}.
        </p>
      )}
      {listing?.status === "error" && (
        <p className="notice error" role="alert">
          <strong>The project folder cannot be read:</strong> <code>{listing.dir}</code>: {listing.message}.
        </p>
      )}
    </>
  );
}

/** The project folder's structure and files (inside ProjectFolderDetails). */
export function FolderContents({ data }: { data: ReturnType<typeof useDataListing> }) {
  const { state, checking, check } = data;
  const listing = state.kind === "loaded" ? state.listing : null;
  const files = listing?.status === "ok" ? listing.files : null;
  const shown = files ? visibleEntries(files) : EXPECTED_ENTRIES.filter((e) => !e.older);
  const present = files ? shown.filter((e) => isPresent(e, files)).length : null;

  return (
    <>
      {listing?.status === "ok" && listing.truncated && (
        <p className="notice warn">The listing is truncated: the folder holds more files than shown here.</p>
      )}
      <div className="df-grid">
        <div className="df-main">
          {files && <FileTables files={files} />}
          {state.kind === "loading" && <p className="muted df-loading">Reading the project folder…</p>}
        </div>
        <div className="df-side">
          <section className="df-panel" aria-label="Structure">
            <div className="df-panel-head">
              <h2 className="float-title">Structure</h2>
              {present !== null && (
                <span className="mono faint">
                  {present}/{shown.length} present
                </span>
              )}
              <button type="button" className="ghost" onClick={check} disabled={checking}>
                {checking ? "Checking…" : "Check again"}
              </button>
            </div>
            <p className="df-panel-note faint">
              Empty folders count as missing; they do not show up in the listing.
            </p>
            <ExpectedList entries={shown} files={files} />
          </section>
          <section className="df-panel" aria-label="What uses the folder">
            <div className="df-panel-head">
              <h2 className="float-title">What uses it</h2>
            </div>
            <ul className={`needs${files ? " on" : ""}`}>
              {NEEDS.map((n) => (
                <li key={n.feature}>
                  <span className="needs-dot" aria-hidden="true" />
                  <strong>{n.feature}</strong>
                  <span className="muted">{n.uses}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

/** The project entries, plus the older data-folder locations that hold files. */
function visibleEntries(files: DataFile[]): ExpectedEntry[] {
  return EXPECTED_ENTRIES.filter((e) => !e.older || isPresent(e, files));
}

function ExpectedList({ entries, files }: { entries: ExpectedEntry[]; files: DataFile[] | null }) {
  return (
    <ul className="expected">
      {entries.map((entry) => {
        const present = files ? isPresent(entry, files) : null;
        const count = files && entry.kind === "folder" ? countFiles(entry, files) : null;
        const state = present === null ? "unknown" : present ? "present" : "absent";
        return (
          <li key={entry.name} className={state}>
            <span
              className="mark"
              aria-label={present === null ? "not checked" : present ? "present" : "missing"}
            >
              {present ? "✓" : "–"}
            </span>
            <code>
              {entry.name}
              {entry.kind === "folder" ? "/" : ""}
            </code>
            <span className="purpose">
              {entry.purpose}
              {entry.older ? " (older location)" : ""}
            </span>
            <span className="count mono">{count !== null && count > 0 ? count : ""}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FileTables({ files }: { files: DataFile[] }) {
  const groups = groupByFolder(files);
  if (groups.size === 0)
    return (
      <section className="df-panel">
        <p className="muted df-panel-note">The project folder is empty.</p>
      </section>
    );
  return (
    <>
      <div className="df-files-head">
        <h2 className="float-title">Files</h2>
        <span className="mono faint">
          {groups.size} folder{groups.size === 1 ? "" : "s"}
        </span>
      </div>
      {[...groups].map(([folder, list]) => (
        <details className="df-panel data-folder" key={folder || "(root)"} open={list.length <= 30}>
          <summary>
            <code>{folder ? `${folder}/` : "Top level"}</code>
            <span className="mono faint">
              {list.length} file{list.length === 1 ? "" : "s"}
            </span>
          </summary>
          <FileTable folder={folder} files={list} />
        </details>
      ))}
    </>
  );
}

function FileTable({ folder, files }: { folder: string; files: DataFile[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th className="num">Size</th>
          <th>Modified</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <tr key={f.path}>
            <td>
              <code>{folder ? f.path.slice(folder.length + 1) : f.path}</code>
            </td>
            <td className="num">{formatSize(f.size)}</td>
            <td className="mono faint">
              {new Date(f.modified).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
