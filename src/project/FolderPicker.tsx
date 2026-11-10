// Folder picking for New / Open project. The desktop app offers a native dialog through its
// preload bridge (window.tattooDesktop.pickFolder); in a browser a page cannot learn a real path, so a
// small dialog walks the folders the planner's server lists (inside the home folder only).
// Also home of `Modal`, the dialog frame the start screen and Settings → Project share.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { desktopBridge, type PickOptions } from "../desktop/bridge.ts";
import { browseFolders } from "./api.ts";
import { baseName, breadcrumb } from "./folders.ts";
import type { BrowseListing, FolderKind } from "./schema.ts";

export type { PickOptions, PickPurpose } from "../desktop/bridge.ts";

type Pending = { opts: PickOptions; start?: string | null; resolve: (path: string | null) => void };

/**
 * `pickFolder()` resolves with an absolute folder path, or null when cancelled. Render `dialog`
 * somewhere in the page; it is empty unless the in-browser picker is open. `start` is the folder the
 * in-browser picker shows first (the home folder when it is missing or cannot be listed).
 */
export function useFolderPicker(): {
  pickFolder: (opts: PickOptions, start?: string | null) => Promise<string | null>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const pickFolder = useCallback((opts: PickOptions, start?: string | null) => {
    const desktop = desktopBridge();
    if (desktop) return desktop.pickFolder(opts);
    return new Promise<string | null>((resolve) => setPending({ opts, start, resolve }));
  }, []);
  const finish = (path: string | null) => {
    pending?.resolve(path);
    setPending(null);
  };
  const dialog = pending ? <FolderDialog opts={pending.opts} start={pending.start} onDone={finish} /> : null;
  return { pickFolder, dialog };
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog over a scrim, rendered into <body>: focus moves in (to `[data-autofocus]`, else the
 * dialog), Tab stays inside, Esc and a click on the scrim close it, and focus returns to the opener.
 */
export function Modal(props: {
  title: ReactNode;
  /** A line under the title. */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra class on the dialog (its width). */
  className?: string;
  /** Escape and the scrim do nothing, e.g. while a request runs. */
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { onClose, busy } = props;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="md-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        ref={ref}
        className={`md-dialog${props.className ? ` ${props.className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="md-head">
          <div className="md-titles">
            <h2 id={titleId}>{props.title}</h2>
            {props.subtitle && <p className="md-subtitle">{props.subtitle}</p>}
          </div>
          <button
            type="button"
            className="ghost icon-button md-close"
            aria-label="Close"
            title="Close (Esc)"
            disabled={busy}
            onClick={onClose}
          >
            <CloseGlyph />
          </button>
        </div>
        {props.children}
        {props.footer && <div className="md-foot">{props.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const KIND_LABEL: Record<FolderKind, string | null> = {
  project: "Project",
  legacy: "Older planner folder",
  folder: null,
};

function FolderDialog(props: {
  opts: PickOptions;
  start?: string | null;
  onDone: (path: string | null) => void;
}) {
  const { opts, start, onDone } = props;
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  /** Focus the first row once the next listing is shown (keyboard and click navigation). */
  const focusAfterLoad = useRef(true);

  const show = useCallback((request: Promise<BrowseListing>) => {
    request.then(
      (l) => {
        setListing(l);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
  }, []);
  const go = (path: string) => {
    setLoading(true);
    focusAfterLoad.current = true;
    show(browseFolders(path));
  };

  useEffect(() => {
    // The start folder, else home (a start folder that went away should not end in an error).
    show(start ? browseFolders(start).catch(() => browseFolders()) : browseFolders());
  }, [show, start]);

  useEffect(() => {
    if (!listing || !focusAfterLoad.current) return;
    focusAfterLoad.current = false;
    const first = listRef.current?.querySelector<HTMLElement>(".fp-row");
    (first ?? listRef.current)?.focus();
    listRef.current?.scrollTo({ top: 0 });
  }, [listing]);

  const crumbs = listing ? breadcrumb(listing) : [];
  const here = crumbs[crumbs.length - 1]?.label ?? "";
  const open = opts.purpose === "open";
  const canChoose = !!listing && (!open || listing.kind === "project" || listing.kind === "legacy");
  const hint = !listing
    ? ""
    : open
      ? canChoose
        ? listing.kind === "project"
          ? "This folder is a project."
          : "An older planner folder: it opens as it is."
        : "Go into a folder marked Project to open it."
      : "The project gets its own new folder inside the one you choose.";
  const chooseLabel = !listing ? (open ? "Open" : "Use this folder") : open ? "Open" : "Use";

  /** Arrow keys move between rows; Backspace or Left goes up one folder. */
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".fp-row") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, n))]?.focus();
    };
    if (e.key === "ArrowDown") move(i < 0 ? 0 : i + 1);
    else if (e.key === "ArrowUp") move(i < 0 ? 0 : i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === "ArrowRight" && rows[i]) {
      e.preventDefault();
      rows[i]?.click();
    } else if ((e.key === "Backspace" || e.key === "ArrowLeft") && listing?.parent) {
      e.preventDefault();
      go(listing.parent);
    }
  };

  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(null)}
      className="fp-dialog"
      footer={
        <>
          <span className="fp-hint">{hint}</span>
          <button type="button" className="ghost" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="primary fp-choose"
            disabled={!canChoose || loading}
            onClick={() => listing && onDone(listing.path)}
          >
            {chooseLabel}
            {listing && (
              <>
                {" "}
                <span className="fp-choose-name">“{here}”</span>
              </>
            )}
          </button>
        </>
      }
    >
      <div className="fp-bar">
        <button
          type="button"
          className="icon-button ghost"
          aria-label="Up one folder"
          title="Up one folder (Backspace)"
          disabled={!listing?.parent || loading}
          onClick={() => listing?.parent && go(listing.parent)}
        >
          <UpGlyph />
        </button>
        <nav className="fp-crumbs" aria-label="Folder path">
          <ol>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={c.path}>
                  {i > 0 && (
                    <span className="fp-sep" aria-hidden="true">
                      <ChevronGlyph />
                    </span>
                  )}
                  {last ? (
                    <span className="fp-crumb current" aria-current="location">
                      {i === 0 && <HomeGlyph />}
                      {c.label}
                    </span>
                  ) : (
                    <button type="button" className="fp-crumb" onClick={() => go(c.path)}>
                      {i === 0 && <HomeGlyph />}
                      {c.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        {listing && KIND_LABEL[listing.kind] && <span className="chip ok">{KIND_LABEL[listing.kind]}</span>}
      </div>
      <div
        ref={listRef}
        className={`fp-list${loading ? " loading" : ""}`}
        aria-busy={loading}
        aria-label={here ? `Folders in ${here}` : "Folders"}
        role="group"
        tabIndex={-1}
        data-autofocus
        onKeyDown={onListKey}
      >
        {error && (
          <p className="notice error fp-error" role="alert">
            {error}
          </p>
        )}
        {!listing && !error && <p className="fp-empty">Loading folders…</p>}
        {listing?.folders.map((f) => (
          <button
            key={f.path}
            type="button"
            className={`fp-row kind-${f.kind}`}
            onClick={() => go(f.path)}
            title={f.name}
          >
            <span className="fp-glyph" aria-hidden="true">
              <FolderGlyph />
            </span>
            <span className="fp-name">{f.name}</span>
            {KIND_LABEL[f.kind] && <span className="chip plain">{KIND_LABEL[f.kind]}</span>}
            <span className="fp-go" aria-hidden="true">
              <ChevronGlyph />
            </span>
          </button>
        ))}
        {listing && listing.folders.length === 0 && (
          <div className="fp-empty">
            <span className="fp-empty-icon" aria-hidden="true">
              <FolderGlyph />
            </span>
            <p>
              <strong>“{here || baseName(listing.path)}” has no folders inside.</strong>
            </p>
            <p className="faint">
              {open
                ? "Go back and pick another folder."
                : "You can use it as it is: the project folder is created inside."}
            </p>
          </div>
        )}
        {listing?.truncated && <p className="fp-more faint">Only the first folders are shown.</p>}
      </div>
      <p className="fp-keys faint" aria-hidden="true">
        <kbd>↑</kbd>
        <kbd>↓</kbd> move · <kbd>Enter</kbd> open folder · <kbd>⌫</kbd> up · <kbd>Esc</kbd> cancel
      </p>
    </Modal>
  );
}

const glyph = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function FolderGlyph() {
  return (
    <svg {...glyph}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg {...glyph} width={12} height={12}>
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  );
}

function UpGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

function HomeGlyph() {
  return (
    <svg {...glyph} width={13} height={13}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10.5h4.5V14h3v5.5H18V9" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg {...glyph} width={14} height={14}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
