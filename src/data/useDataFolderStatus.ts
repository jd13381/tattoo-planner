import { useEffect, useState } from "react";
import { DATA_FILES_ENDPOINT, type DataListing } from "./types.ts";

/** What the header chip shows about TATTOO_DATA_DIR. */
export type DataFolderStatus =
  { kind: "loading" } | { kind: "unset" } | { kind: "ok"; dir: string } | { kind: "error"; message: string };

/** Asks the dev server once whether the data folder is set and readable. */
export function useDataFolderStatus(): DataFolderStatus {
  const [status, setStatus] = useState<DataFolderStatus>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(DATA_FILES_ENDPOINT)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DataListing>;
      })
      .then(
        (l) => {
          if (cancelled) return;
          if (l.status === "ok") setStatus({ kind: "ok", dir: l.dir });
          else if (l.status === "unset") setStatus({ kind: "unset" });
          else setStatus({ kind: "error", message: `${l.dir}: ${l.message}` });
        },
        (e: unknown) => !cancelled && setStatus({ kind: "error", message: String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}
