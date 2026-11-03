import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout } from "./schema.ts";

export type StoredLayout = { name: string; text: string };
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

  const save = useCallback(async (layout: Layout): Promise<StoredLayout> => {
    const r = await fetch(`${ENDPOINT}/${encodeURIComponent(layout.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
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
