import { useEffect, useState, type ReactNode } from "react";
import { EXPECTED_ENTRIES, formatSize, groupByFolder, isPresent } from "./expected.ts";
import { DATA_DIR_VAR, DATA_FILES_ENDPOINT, type DataListing } from "./types.ts";

type State =
  { kind: "loading" } | { kind: "failed"; message: string } | { kind: "loaded"; listing: DataListing };

export function DataFolderPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

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
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p className="muted">Reading the data folder…</p>;
  if (state.kind === "failed")
    return (
      <Notice tone="error" title="The dev server did not answer">
        {state.message}. The listing only works under <code>npm run dev</code>.
      </Notice>
    );

  const { listing } = state;
  if (listing.status === "unset")
    return (
      <Notice tone="warn" title={`${DATA_DIR_VAR} is not set`}>
        Copy <code>.env.example</code> to <code>.env</code>, set <code>{DATA_DIR_VAR}</code> to your Seafile
        folder and restart <code>npm run dev</code>.
      </Notice>
    );
  if (listing.status === "error")
    return (
      <Notice tone="error" title="The data folder cannot be read">
        <code>{listing.dir}</code>: {listing.message}.
      </Notice>
    );

  const groups = groupByFolder(listing.files);
  return (
    <>
      <section className="card">
        <h2>Data folder</h2>
        <p>
          <code>{listing.dir}</code>
        </p>
        <p className="muted">
          {listing.files.length} file{listing.files.length === 1 ? "" : "s"}
          {listing.truncated ? " (listing truncated)" : ""}
        </p>
        <ul className="expected">
          {EXPECTED_ENTRIES.map((entry) => {
            const present = isPresent(entry, listing.files);
            return (
              <li key={entry.name} className={present ? "present" : "absent"}>
                <span className="mark" aria-label={present ? "present" : "missing"}>
                  {present ? "✓" : "–"}
                </span>
                <code>
                  {entry.name}
                  {entry.kind === "folder" ? "/" : ""}
                </code>
                <span className="muted">{entry.purpose}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {[...groups].map(([folder, files]) => (
        <section className="card" key={folder || "(root)"}>
          <h2>{folder ? `${folder}/` : "Top level"}</h2>
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
        </section>
      ))}
    </>
  );
}

function Notice(props: { tone: "warn" | "error"; title: string; children: ReactNode }) {
  return (
    <section className={`card notice ${props.tone}`} role="status">
      <h2>{props.title}</h2>
      <p>{props.children}</p>
    </section>
  );
}
