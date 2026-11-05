// Folder picking for New / Open project. The desktop app will offer a native dialog through its
// preload bridge (window.tattooDesktop.pickFolder); in a browser a page cannot learn a real path, so a
// small dialog walks the folders the planner's server lists (inside the home folder only).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { browseFolders } from "./api.ts";
import { breadcrumb } from "./folders.ts";
import type { BrowseListing, FolderKind } from "./schema.ts";

export type PickPurpose = "open" | "create";
export type PickOptions = { title: string; purpose: PickPurpose };

declare global {
  interface Window {
    /** Set by the desktop shell's preload script; absent in a browser. */
    tattooDesktop?: { pickFolder?: (opts: PickOptions) => Promise<string | null> };
  }
}

type Pending = { opts: PickOptions; resolve: (path: string | null) => void };

/**
 * `pickFolder()` resolves with an absolute folder path, or null when cancelled. Render `dialog`
 * somewhere in the page; it is empty unless the in-browser picker is open.
 */
export function useFolderPicker(): {
  pickFolder: (opts: PickOptions) => Promise<string | null>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const pickFolder = useCallback((opts: PickOptions) => {
    const native = window.tattooDesktop?.pickFolder;
    if (native) return native(opts);
    return new Promise<string | null>((resolve) => setPending({ opts, resolve }));
  }, []);
  const finish = (path: string | null) => {
    pending?.resolve(path);
    setPending(null);
  };
  const dialog = pending ? <FolderDialog opts={pending.opts} onDone={finish} /> : null;
  return { pickFolder, dialog };
}

const KIND_LABEL: Record<FolderKind, string | null> = {
  project: "Project",
  legacy: "Old data folder",
  folder: null,
};

function FolderDialog({ opts, onDone }: { opts: PickOptions; onDone: (path: string | null) => void }) {
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

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
    show(browseFolders(path));
  };

  useEffect(() => {
    show(browseFolders());
    ref.current?.focus();
  }, [show]);

  const crumbs = listing ? breadcrumb(listing) : [];
  const canChoose =
    !!listing && (opts.purpose === "create" ? true : listing.kind === "project" || listing.kind === "legacy");
  const hint = !listing
    ? ""
    : opts.purpose === "open"
      ? canChoose
        ? "This folder is a project."
        : "Open a folder marked Project."
      : "The new project folder is created inside this folder.";

  return (
    <div className="picker-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <div
        ref={ref}
        className="picker"
        role="dialog"
        aria-modal="true"
        aria-label={opts.title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone(null);
          }
        }}
      >
        <div className="picker-head">
          <h2>{opts.title}</h2>
          <nav className="picker-crumbs" aria-label="Folder path">
            {crumbs.map((c, i) => (
              <span key={c.path}>
                {i > 0 && <span className="faint"> / </span>}
                <button
                  type="button"
                  className="link"
                  onClick={() => go(c.path)}
                  aria-current={i === crumbs.length - 1 ? "location" : undefined}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <div className="picker-list" aria-busy={loading}>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {listing?.parent && (
            <button type="button" className="picker-row" onClick={() => go(listing.parent!)}>
              <span className="picker-glyph" aria-hidden="true">
                ↑
              </span>
              <span>Up one folder</span>
            </button>
          )}
          {listing?.folders.map((f) => (
            <button key={f.path} type="button" className="picker-row" onClick={() => go(f.path)}>
              <span className="picker-glyph" aria-hidden="true">
                ▸
              </span>
              <span className="picker-name">{f.name}</span>
              {KIND_LABEL[f.kind] && <span className="chip plain">{KIND_LABEL[f.kind]}</span>}
            </button>
          ))}
          {listing && listing.folders.length === 0 && <p className="muted picker-empty">No sub-folders.</p>}
          {listing?.truncated && <p className="faint picker-empty">Only the first folders are shown.</p>}
        </div>
        <div className="picker-foot">
          <span className="faint picker-hint">{hint}</span>
          <span className="spacer" />
          <button type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canChoose || loading}
            onClick={() => listing && onDone(listing.path)}
          >
            Choose this folder
          </button>
        </div>
      </div>
    </div>
  );
}
