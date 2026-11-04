import { useEffect, useState } from "react";
import { ExportIcon } from "../ui/icons.tsx";
import type { ExportStatus } from "./names.ts";
import {
  fetchExportStatus,
  runExport,
  type ExportInput,
  type ExportProgress,
  type ExportResult,
} from "./runExport.ts";

type Props = {
  /** The current layout and everything needed to draw it; null while nothing is loaded. */
  input: ExportInput | null;
  /** Why the current state cannot be exported (unsaved changes, images still loading, …). */
  blocked: string | null;
};

type State =
  | { phase: "idle" }
  | { phase: "running"; progress: ExportProgress }
  | { phase: "done"; result: ExportResult }
  | { phase: "error"; message: string };

/** "Export" in the layout toolbar: PDF handout and PNGs into <TATTOO_DATA_DIR>/exports/. */
export function ExportButton({ input, blocked }: Props) {
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchExportStatus().then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, []);

  const disabledReason =
    status === null
      ? "Checking the data folder…"
      : !status.enabled
        ? status.reason
        : !input
          ? "No layout loaded."
          : blocked;
  const running = state.phase === "running";

  const start = async () => {
    if (!input || disabledReason) return;
    setState({ phase: "running", progress: { label: "Starting", done: 0, total: 1 } });
    try {
      const result = await runExport(input, (progress) => setState({ phase: "running", progress }));
      setState({ phase: "done", result });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <button
        type="button"
        className="export-button"
        aria-label={running ? "Exporting" : "Export"}
        onClick={() => void start()}
        disabled={running || !!disabledReason}
        title={
          disabledReason ?? "PDF handout for the artist and PNGs of every view, into <data folder>/exports/"
        }
      >
        <ExportIcon />
        <span className="export-label">{running ? "Exporting…" : "Export"}</span>
      </button>
      {/* Why export is unavailable lives in the button's tooltip and the header's data-folder chip. */}
      {state.phase !== "idle" && (
        <div className="export-status" role="status" aria-live="polite">
          {state.phase === "running" && (
            <>
              <progress max={state.progress.total} value={state.progress.done} />{" "}
              <span>{state.progress.label}…</span>
            </>
          )}
          {state.phase === "done" && (
            <span
              className="export-done chip ok"
              title={`${state.result.pdf.absolute}\n${state.result.pngs.length} PNGs in ${state.result.reservation.folder}`}
            >
              Exported in {(state.result.ms / 1000).toFixed(1)} s: PDF and {state.result.pngs.length} PNGs{" "}
              <button type="button" className="link" onClick={() => setState({ phase: "idle" })}>
                dismiss
              </button>
            </span>
          )}
          {state.phase === "error" && (
            <span className="chip error" title={state.message}>
              Export failed (hover for details){" "}
              <button type="button" className="link" onClick={() => setState({ phase: "idle" })}>
                dismiss
              </button>
            </span>
          )}
        </div>
      )}
    </>
  );
}
