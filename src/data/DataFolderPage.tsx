// Data folder tab: what TATTOO_DATA_DIR holds, how to set it up and which features need it.
// The expected structure is shown in every state, so Jan sees what the planner will look for.
// Layout: a status header (path, counts, Check again), then setup steps or the file tables on the
// left and the structure and "what needs it" panels on the right.
import { useEffect, useState } from "react";
import { countFiles, EXPECTED_ENTRIES, formatSize, groupByFolder, isPresent } from "./expected.ts";
import { DATA_DIR_VAR, DATA_FILES_ENDPOINT, type DataFile, type DataListing } from "./types.ts";

export type State =
  { kind: "loading" } | { kind: "failed"; message: string } | { kind: "loaded"; listing: DataListing };

/** Which parts of the planner read or write the data folder. */
const NEEDS: { feature: string; uses: string }[] = [
  { feature: "Reference mode", uses: "Layout and Compare show the images assigned to figures" },
  { feature: "Assets panel", uses: "manifest.yaml and the images in ideas/, refs/, cards/" },
  { feature: "Projection photos", uses: "the Anubis photos in arm-photos/" },
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

function headTone(state: State): string {
  if (state.kind === "loading") return "loading";
  if (state.kind === "failed") return "error";
  return state.listing.status === "ok" ? "ok" : state.listing.status === "unset" ? "warn" : "error";
}

export function DataFolderPage() {
  const { state, checking, check } = useDataListing();
  const listing = state.kind === "loaded" ? state.listing : null;
  const files = listing?.status === "ok" ? listing.files : null;
  const present = files ? EXPECTED_ENTRIES.filter((e) => isPresent(e, files)).length : null;
  const latest = files
    ? files.reduce<string | null>((m, f) => (m === null || f.modified > m ? f.modified : m), null)
    : null;

  return (
    <div className="df-page">
      <header className={`df-head tone-${headTone(state)}`}>
        <span className="df-head-icon" aria-hidden="true">
          <FolderGlyph />
        </span>
        <div className="df-head-text">
          <div className="df-head-title">
            <h2>Data folder</h2>
            <StatusChip state={state} />
          </div>
          <p className="df-head-path">
            {listing?.status === "ok" || listing?.status === "error" ? (
              <code>{listing.dir}</code>
            ) : (
              <span className="faint">
                <code>{DATA_DIR_VAR}</code>{" "}
                {state.kind === "loading"
                  ? "· reading…"
                  : state.kind === "failed"
                    ? "· the dev server did not answer"
                    : "is not set"}
              </span>
            )}
          </p>
        </div>
        {files && (
          <dl className="df-stats">
            <div>
              <dt>Files</dt>
              <dd className="mono">
                {files.length}
                {listing?.status === "ok" && listing.truncated ? "+" : ""}
              </dd>
            </div>
            <div>
              <dt>Structure</dt>
              <dd className="mono">
                {present}/{EXPECTED_ENTRIES.length}
              </dd>
            </div>
            <div>
              <dt>Last change</dt>
              <dd className="mono">{latest ? new Date(latest).toLocaleDateString() : "–"}</dd>
            </div>
          </dl>
        )}
        <button type="button" onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </header>

      {state.kind === "loading" && <p className="muted df-loading">Reading the data folder…</p>}
      {state.kind === "failed" && (
        <p className="notice error" role="alert">
          <strong>The dev server did not answer:</strong> {state.message}. The listing only works under{" "}
          <code>npm run dev</code>.
        </p>
      )}
      {listing?.status === "error" && (
        <p className="notice error" role="alert">
          <strong>The data folder cannot be read:</strong> <code>{listing.dir}</code>: {listing.message}.
          Check the path in <code>.env</code> and restart <code>npm run dev</code>.
        </p>
      )}
      {listing?.status === "ok" && listing.truncated && (
        <p className="notice warn">The listing is truncated: the folder holds more files than shown here.</p>
      )}

      <div className="df-grid">
        <div className="df-main">
          {(listing?.status === "unset" || listing?.status === "error") && (
            <Setup unset={listing.status === "unset"} />
          )}
          {files && <FileTables files={files} />}
        </div>
        <div className="df-side">
          <section className="df-panel" aria-label="Expected structure">
            <div className="df-panel-head">
              <h2 className="float-title">{files ? "Structure" : "Expected structure"}</h2>
              {present !== null && (
                <span className="mono faint">
                  {present}/{EXPECTED_ENTRIES.length} present
                </span>
              )}
            </div>
            <p className="df-panel-note faint">
              {files
                ? "Empty folders count as missing; they do not show up in the listing."
                : `What the planner looks for in ${DATA_DIR_VAR} (PROJECT_BRIEF.md §12.3).`}
            </p>
            <ExpectedList files={files} />
          </section>
          <section className="df-panel" aria-label="What needs the data folder">
            <div className="df-panel-head">
              <h2 className="float-title">What needs it</h2>
            </div>
            <p className="df-panel-note faint">
              {files
                ? "These read the folder or write into it."
                : "Without the folder these stay off; everything else (layouts, the arm, coverage) works."}
            </p>
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
    </div>
  );
}

function StatusChip({ state }: { state: State }) {
  if (state.kind === "loading") return null;
  if (state.kind === "failed") return <span className="chip error">No answer</span>;
  const { listing } = state;
  if (listing.status === "ok") return <span className="chip ok">Connected</span>;
  if (listing.status === "unset") return <span className="chip warn">Not set</span>;
  return <span className="chip error">Unreadable</span>;
}

function FolderGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l2 2h8.6A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
    </svg>
  );
}

/** The setup steps from README.md, with copy buttons. */
function Setup({ unset }: { unset: boolean }) {
  return (
    <section className="df-panel df-setup" aria-label="Setup">
      <div className="df-panel-head">
        <h2 className="float-title">Setup</h2>
        <span className="mono faint">4 steps</span>
      </div>
      <div className="df-setup-intro">
        <h3>{unset ? `Set ${DATA_DIR_VAR} to use your images` : "Fix the data folder path"}</h3>
        <p className="muted">
          Images, the ideas PDF and exports never go into git. They live in a Seafile folder that the planner
          finds through <code>{DATA_DIR_VAR}</code>.
        </p>
      </div>
      <ol className="setup-steps">
        <li>
          <span>In the repo folder, create your local settings file (it is git-ignored):</span>
          <Command text="cp .env.example .env" />
        </li>
        <li>
          <span>
            Set the path of your Seafile folder in <code>.env</code>. Quote it when it contains spaces;{" "}
            <code>~</code> is expanded:
          </span>
          <Command text={`${DATA_DIR_VAR}="~/Your Secure Cloud/<library>/tattoo-planner-data"`} />
        </li>
        <li>
          <span>Stop the dev server (Ctrl+C) and start it again, so it reads the new value:</span>
          <Command text="npm run dev" />
        </li>
        <li>
          <span>
            Press <strong>Check again</strong> above.
          </span>
        </li>
      </ol>
    </section>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <span className="command">
      <code>{text}</code>
      <button
        type="button"
        className={`ghost small-button${copied === true ? " copied" : ""}`}
        onClick={() =>
          navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
        aria-label={`Copy ${text}`}
      >
        <CopyGlyph />
        {copied === true ? "Copied" : copied === false ? "Select and copy" : "Copy"}
      </button>
    </span>
  );
}

function ExpectedList({ files }: { files: DataFile[] | null }) {
  return (
    <ul className="expected">
      {EXPECTED_ENTRIES.map((entry) => {
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
            <span className="purpose">{entry.purpose}</span>
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
        <p className="muted df-panel-note">The data folder is empty.</p>
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
