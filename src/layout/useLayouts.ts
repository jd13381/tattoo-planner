import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout } from "./schema.ts";

export type StoredLayout = { name: string; text: string };
/** The Layout tab's open variant; the Compare tab offers it while it has unsaved edits. */
export type WorkingLayout = { name: string; layout: Layout; dirty: boolean };
const ENDPOINT = "/api/layouts";

/**
 * Fired on window when another part of the page saved a layout (the projection wizard links a tattoo
 * into one); `detail` is the StoredLayout. Every useLayouts list takes it in.
 */
export const LAYOUT_SAVED_EVENT = "tattoo-planner:layout-saved";

function announceLayoutSaved(saved: StoredLayout): void {
  window.dispatchEvent(new CustomEvent<StoredLayout>(LAYOUT_SAVED_EVENT, { detail: saved }));
}

const withFile = (list: StoredLayout[] | null, f: StoredLayout) =>
  [...(list ?? []).filter((x) => x.name !== f.name), f].sort((a, b) => a.name.localeCompare(b.name));

/** Layout files of the open project via the planner's server; `onLoad` runs once with the first list. */
export function useLayouts(onLoad?: (list: StoredLayout[]) => void) {
  const onLoadRef = useRef(onLoad);
  const [files, setFiles] = useState<StoredLayout[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(ENDPOINT);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFiles((await r.json()) as StoredLayout[]);
      setError(null);
    } catch (e) {
      setError(
        `Cannot load layouts (${String(e)}). The planner's local server did not answer; restart the planner.`,
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(ENDPOINT)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<StoredLayout[]>;
      })
      .then(
        (list) => {
          if (cancelled) return;
          setFiles(list);
          onLoadRef.current?.(list);
        },
        (e: unknown) =>
          !cancelled &&
          setError(
            `Cannot load layouts (${String(e)}). The planner's local server did not answer; restart the planner.`,
          ),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const f = (e as CustomEvent<StoredLayout>).detail;
      setFiles((list) =>
        list?.some((x) => x.name === f.name && x.text === f.text) ? list : withFile(list, f),
      );
    };
    window.addEventListener(LAYOUT_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(LAYOUT_SAVED_EVENT, onSaved);
  }, []);

  /** Saves a layout; `from` (for a new variant) copies that variant's comments into the new file. */
  const save = useCallback(async (layout: Layout, from?: string): Promise<StoredLayout> => {
    const r = await fetch(`${ENDPOINT}/${encodeURIComponent(layout.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(from === undefined ? { layout } : { layout, from }),
    });
    const body = (await r.json()) as StoredLayout & { error?: string };
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    const saved = { name: body.name, text: body.text };
    setFiles((list) => withFile(list, saved));
    announceLayoutSaved(saved);
    return body;
  }, []);

  return { files, error, reload, save };
}
