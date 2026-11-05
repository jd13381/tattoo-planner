import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExportIcon } from "../ui/icons.tsx";
import { exportFileUrl, type ExportStatus } from "./names.ts";
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
  /** Why the current state cannot be exported (layout errors, images still loading, …). */
  blocked: string | null;
  /**
   * There are unsaved edits: the button becomes "Save & export" and calls this first (true = saved),
   * so the handout always matches the saved file.
   */
  saveFirst?: (() => Promise<boolean>) | null;
  /** Where progress and the result are shown (next to the toasts); without it, next to the button. */
  statusTarget?: HTMLElement | null;
};

type State =
  | { phase: "idle" }
  | { phase: "running"; progress: ExportProgress }
  | { phase: "done"; result: ExportResult }
  | { phase: "error"; message: string };

/** "Export" in the layout toolbar: PDF handout and PNGs into the project's exports folder. */
export function ExportButton({ input, blocked, saveFirst, statusTarget }: Props) {
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
      ? "Checking the project folder…"
      : !status.enabled
        ? status.reason
        : !input
          ? "No layout loaded."
          : blocked;
  const running = state.phase === "running";
  const label = saveFirst ? "Save & export" : "Export";

  const start = async () => {
    if (!input || disabledReason) return;
    if (saveFirst) {
      setState({ phase: "running", progress: { label: "Saving", done: 0, total: 1 } });
      if (!(await saveFirst())) {
        setState({ phase: "error", message: "The layout could not be saved, so nothing was exported." });
        return;
      }
    }
    setState({ phase: "running", progress: { label: "Starting", done: 0, total: 1 } });
    try {
      const result = await runExport(input, (progress) => setState({ phase: "running", progress }));
      setState({ phase: "done", result });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const dismiss = () => setState({ phase: "idle" });
  const panel = state.phase !== "idle" && (
    <div className={`export-status float ${state.phase}`} role="status" aria-live="polite">
      {state.phase === "running" && (
        <>
          <span className="export-status-title">Exporting…</span>
          <progress max={state.progress.total} value={state.progress.done} />
          <span className="faint">{state.progress.label}</span>
        </>
      )}
      {state.phase === "done" && (
        <>
          <span className="export-status-title ok-text">Exported</span>
          <span>
            Saved in the project’s <strong>exports</strong> folder as{" "}
            <span className="mono">{state.result.reservation.base}.pdf</span>, with {state.result.pngs.length}{" "}
            PNGs beside it ({(state.result.ms / 1000).toFixed(1)} s).
          </span>
          <a
            className="button primary small-button"
            href={exportFileUrl(`${state.result.reservation.base}.pdf`)}
            target="_blank"
            rel="noreferrer"
          >
            Open PDF
          </a>
          <button type="button" className="ghost small-button" onClick={dismiss}>
            Close
          </button>
        </>
      )}
      {state.phase === "error" && (
        <>
          <span className="export-status-title error-text">Export failed</span>
          <span className="export-error">{state.message}</span>
          <button type="button" className="ghost small-button" onClick={dismiss}>
            Close
          </button>
        </>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="export-button"
        aria-label={running ? "Exporting" : label}
        onClick={() => void start()}
        disabled={running || !!disabledReason}
        title={
          disabledReason ??
          (saveFirst
            ? "Save the changes, then write the PDF handout for the artist and PNGs of every view"
            : "PDF handout for the artist and PNGs of every view, into the project's exports folder")
        }
      >
        <ExportIcon />
        <span className="export-label">{running ? "Exporting…" : label}</span>
      </button>
      {panel && (statusTarget ? createPortal(panel, statusTarget) : panel)}
    </>
  );
}
