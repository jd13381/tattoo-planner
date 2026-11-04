// Data folder tab: what TATTOO_DATA_DIR holds, how to set it up and which features need it.
// The expected structure is shown in every state, so Jan sees what the planner will look for.
import { useEffect, useState } from "react";
import { countFiles, EXPECTED_ENTRIES, formatSize, groupByFolder, isPresent } from "./expected.ts";
import { DATA_DIR_VAR, DATA_FILES_ENDPOINT, type DataFile, type DataListing } from "./types.ts";

type State =
  { kind: "loading" } | { kind: "failed"; message: string } | { kind: "loaded"; listing: DataListing };

/** Which parts of the planner read or write the data folder. */
const NEEDS: { feature: string; uses: string }[] = [
  { feature: "Reference mode", uses: "Layout and Compare show the images assigned to figures" },
  { feature: "Assets panel", uses: "manifest.yaml and the images in ideas/, refs/, cards/" },
  { feature: "Projection photos", uses: "the photos of the existing tattoo in existing/" },
  { feature: "Export", uses: "writes the artist handout and PNGs into exports/" },
  { feature: "Edit images", uses: "edits reference images and keeps results in edits/" },
];

function useDataListing(): { state: State; checking: boolean; check: () => void } {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
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
  return { state, checking, check: () => setTick((n) => n + 1) };
}

export function DataFolderPage() {
  const { state, checking, check } = useDataListing();
  const listing = state.kind === "loaded" ? state.listing : null;
  const files = listing?.status === "ok" ? listing.files : null;

  const checkButton = (
    <button type="button" onClick={check} disabled={checking}>
      {checking ? "Checking…" : "Check again"}
    </button>
  );

  return (
    <div className="data-page">
      <div className="toolbar data-head">
        <h2>Data folder</h2>
        <StatusChip state={state} />
        <span className="spacer" />
        {checkButton}
      </div>

      {state.kind === "loading" && <p className="muted">Reading the data folder…</p>}
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
      {listing?.status === "ok" && (
        <p className="data-path">
          <code>{listing.dir}</code>
          <span className="muted small">
            {listing.files.length} file{listing.files.length === 1 ? "" : "s"}
            {listing.truncated ? " (listing truncated)" : ""}
          </span>
        </p>
      )}

      {(listing?.status === "unset" || listing?.status === "error") && (
        <Setup unset={listing.status === "unset"} />
      )}

      <div className="data-grid">
        <section className="panel" aria-label="Expected structure">
          <h2>{files ? "Structure" : "Expected structure"}</h2>
          <p className="muted small">
            {files
              ? "Empty folders count as missing; they do not show up in the listing."
              : `What the planner looks for in ${DATA_DIR_VAR} (PROJECT_BRIEF.md §12.3).`}
          </p>
          <ExpectedList files={files} />
        </section>
        <section className="panel" aria-label="What needs the data folder">
          <h2>What needs it</h2>
          <p className="muted small">
            {files
              ? "These read the folder or write into it."
              : "Without the folder these stay off; everything else (layouts, the arm, coverage) works."}
          </p>
          <ul className="needs">
            {NEEDS.map((n) => (
              <li key={n.feature}>
                <strong>{n.feature}</strong>
                <span className="muted">{n.uses}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {files && <FileTables files={files} />}
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

/** The setup steps from README.md, with copy buttons. */
function Setup({ unset }: { unset: boolean }) {
  return (
    <section className="empty data-setup" aria-label="Setup">
      <h2>{unset ? `Set ${DATA_DIR_VAR} to use your images` : "Fix the data folder path"}</h2>
      <p>
        Images, the ideas PDF and exports never go into git. They live in a Seafile folder that the planner
        finds through <code>{DATA_DIR_VAR}</code>.
      </p>
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
        className="ghost"
        onClick={() =>
          navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
        aria-label={`Copy ${text}`}
      >
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
            <span className="count num">
              {count !== null && count > 0 ? `${count} file${count === 1 ? "" : "s"}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FileTables({ files }: { files: DataFile[] }) {
  const groups = groupByFolder(files);
  if (groups.size === 0) return <p className="empty small muted">The data folder is empty.</p>;
  return (
    <>
      <h2 className="section-label data-files-head">Files</h2>
      {[...groups].map(([folder, list]) => (
        <details className="panel data-folder" key={folder || "(root)"} open={list.length <= 30}>
          <summary>
            <code>{folder ? `${folder}/` : "Top level"}</code>
            <span className="muted small">
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
            <td>{new Date(f.modified).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
