// Browser side of the Assets tab's actions (server/assetsHandler.ts): batch, undo, commit, import
// and the usage listing. Plain fetch calls; the page reloads the listing from what they return.
import {
  ASSETS_BATCH_ENDPOINT,
  ASSETS_COMMIT_ENDPOINT,
  ASSETS_IMPORT_ENDPOINT,
  ASSETS_UNDO_ENDPOINT,
  ASSETS_USAGE_ENDPOINT,
  type AssetListing,
  type BatchRequest,
  type BatchResult,
  type DeleteRefusal,
  type ImportResult,
  type UsageMap,
} from "./types.ts";

export class ActionError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }

  /** The server refused a delete that needs confirmation (projection photos) or cannot be done. */
  get refusal(): DeleteRefusal | null {
    const b = this.body as Partial<DeleteRefusal> | null;
    return this.status === 409 && b && Array.isArray(b.projections) ? (b as DeleteRefusal) : null;
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new ActionError(r.status, body.error ?? `HTTP ${r.status}`, body);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function runBatch(req: BatchRequest): Promise<BatchResult> {
  return call(ASSETS_BATCH_ENDPOINT, json(req));
}

export function undoAction(token: string): Promise<AssetListing> {
  return call(`${ASSETS_UNDO_ENDPOINT}/${encodeURIComponent(token)}`, json({}));
}

/** Makes a pending delete final. `beacon`: while the page unloads (fetch may not finish then). */
export function commitDelete(token: string, beacon = false): void {
  const url = `${ASSETS_COMMIT_ENDPOINT}/${encodeURIComponent(token)}`;
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon?.(url)) return;
  void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
}

export function importFile(file: File, category: string, person: string | null): Promise<ImportResult> {
  const q = new URLSearchParams({ name: file.name, category, ...(person ? { person } : {}) });
  return call(`${ASSETS_IMPORT_ENDPOINT}?${q}`, {
    method: "POST",
    headers: { "Content-Type": file.type.startsWith("image/") ? file.type : "application/octet-stream" },
    body: file,
  });
}

export async function fetchUsage(): Promise<UsageMap> {
  const r = await fetch(ASSETS_USAGE_ENDPOINT);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { usage: UsageMap }).usage;
}
