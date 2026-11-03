import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout } from "./schema.ts";

export type StoredLayout = { name: string; text: string };
/** The Layout tab's open variant; the Compare tab offers it while it has unsaved edits. */
export type WorkingLayout = { name: string; layout: Layout; dirty: boolean };
const ENDPOINT = "/api/layouts";

/** Layout files from config/layouts via the dev server; `onLoad` runs once with the first list. */
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
      setError(`Cannot load layouts (${String(e)}). They load only under npm run dev.`);
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
          !cancelled && setError(`Cannot load layouts (${String(e)}). They load only under npm run dev.`),
      );
    return () => {
      cancelled = true;
    };
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
    setFiles((list) => {
      const rest = (list ?? []).filter((f) => f.name !== body.name);
      return [...rest, { name: body.name, text: body.text }].sort((a, b) => a.name.localeCompare(b.name));
    });
    return body;
  }, []);

  return { files, error, reload, save };
}
