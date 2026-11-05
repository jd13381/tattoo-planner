// The Assets tab: every catalogued image as a thumbnail grid (search, kind, tag), where each one is
// used in the saved layouts, and its tags, notes and hidden flag, edited in place. A condensed
// folder status sits on top; setup lives in Settings → Project.
import { useEffect, useMemo, useState } from "react";
import { EXPECTED_ENTRIES, isPresent } from "../data/expected.ts";
import { useDataListing } from "../data/DataFolderPage.tsx";
import { useLayouts } from "../layout/useLayouts.ts";
import { facets, filterAssets, NO_FILTER, type AssetFilter } from "./filter.ts";
import { assetEntryUrl, assetImageUrl, type AssetInfo } from "./types.ts";
import { assetUsage, parseTags, type AssetUse } from "./usage.ts";
import { announceManifestChanged, useAssetListing } from "./useAssets.ts";

const SETUP_HREF = "#settings/project";

export function AssetsPage() {
  const { listing, reload, scanNote } = useAssetListing();
  const { files: layouts } = useLayouts();
  const usage = useMemo(() => assetUsage(layouts ?? []), [layouts]);
  const [filter, setFilter] = useState<AssetFilter>(NO_FILTER);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const assets = useMemo(() => (listing?.status === "ok" ? listing.assets : []), [listing]);
  const kinds = useMemo(() => facets(assets.map((a) => a.kind)), [assets]);
  const tags = useMemo(() => facets(assets.flatMap((a) => a.tags)), [assets]);
  const hiddenCount = assets.filter((a) => a.hidden).length;
  const shown = useMemo(
    () => filterAssets(assets, filter).filter((a) => showHidden || !a.hidden),
    [assets, filter, showHidden],
  );
  const selected = assets.find((a) => a.id === selectedId) ?? null;

  let body: React.ReactNode;
  if (!listing) body = <p className="muted assets-loading">Loading…</p>;
  else if (listing.status === "unset")
    body = (
      <div className="empty">
        <h2>No project folder yet</h2>
        <p>
          Your reference images, photos and exports live in a project folder outside the planner. Set one up
          to see your images here.
        </p>
        <a className="button primary" href={SETUP_HREF}>
          Set up in Settings → Project
        </a>
      </div>
    );
  else if (listing.status === "error")
    body = (
      <div className="empty">
        <h2>The images cannot be read</h2>
        <p>{listing.message}</p>
        <a className="button" href={SETUP_HREF}>
          Open Settings → Project
        </a>
      </div>
    );
  else if (assets.length === 0)
    body = (
      <div className="empty">
        <h2>No images catalogued yet</h2>
        <p>
          Copy images into the project folder (references into <code>images/</code>, body photos into{" "}
          <code>photos/</code>), then press <strong>Look for new images</strong>.
        </p>
        <button type="button" className="primary" onClick={reload}>
          Look for new images
        </button>
      </div>
    );
  else
    body = (
      <div className="assets-body">
        <section className="assets-main" aria-label="Images">
          <div className="assets-filters">
            <input
              type="search"
              placeholder="Search id, notes, source, tags"
              value={filter.text}
              onChange={(e) => setFilter({ ...filter, text: e.target.value })}
              aria-label="Search images"
            />
            <select
              value={filter.kind}
              onChange={(e) => setFilter({ ...filter, kind: e.target.value })}
              aria-label="Kind"
            >
              <option value="">All kinds</option>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.value} ({k.count})
                </option>
              ))}
            </select>
            <select
              value={filter.tag}
              onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
              aria-label="Tag"
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value} ({t.count})
                </option>
              ))}
            </select>
            <label className="inline switch-label">
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                disabled={hiddenCount === 0}
              />
              Show hidden {hiddenCount > 0 && <span className="faint mono">({hiddenCount})</span>}
            </label>
            <span className="faint small">
              {shown.length} of {assets.length}
            </span>
          </div>
          {shown.length === 0 ? (
            <p className="muted small">Nothing matches the filter.</p>
          ) : (
            <ul className="asset-grid large">
              {shown.map((a) => {
                const uses = usage.get(a.id)?.length ?? 0;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`asset-card${a.id === selectedId ? " current" : ""}${a.exists ? "" : " missing"}${a.hidden ? " hidden-asset" : ""}`}
                      aria-pressed={a.id === selectedId}
                      title={[a.id, a.source, a.notes].filter(Boolean).join("\n")}
                      onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                    >
                      {a.exists ? (
                        <img src={assetImageUrl(a.id)} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className="asset-missing">file missing</span>
                      )}
                      <span className="asset-id">{a.id}</span>
                      <span className="asset-badges">
                        <span className="faint">{a.kind}</span>
                        {uses > 0 && <span className="asset-badge used">used {uses}×</span>}
                        {a.hidden && <span className="asset-badge">hidden</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {listing.warnings.length > 0 && (
            <details className="small warn">
              <summary>
                {listing.warnings.length} catalogue warning{listing.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul>
                {listing.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <aside className="assets-detail" aria-label="Image details">
          {selected ? (
            <AssetDetail key={selected.id} asset={selected} uses={usage.get(selected.id) ?? []} />
          ) : (
            <p className="muted small assets-detail-empty">
              Click an image to see where it is used and to edit its tags and notes.
            </p>
          )}
        </aside>
      </div>
    );

  return (
    <div className="assets-page">
      <FolderStatus
        count={assets.length}
        onReload={listing?.status === "ok" ? reload : undefined}
        note={scanNote}
      />
      {body}
    </div>
  );
}

/** The data folder in one line: state, path, files and structure; setup is in Settings → Project. */
function FolderStatus(props: { count: number; onReload?: () => void; note: string | null }) {
  const { state, checking, check } = useDataListing();
  const listing = state.kind === "loaded" ? state.listing : null;
  const files = listing?.status === "ok" ? listing.files : null;
  const expected = EXPECTED_ENTRIES.filter((e) => !e.older);
  const present = files ? expected.filter((e) => isPresent(e, files)).length : null;
  const [chip, text] =
    state.kind === "loading"
      ? ["muted", "Checking…"]
      : state.kind === "failed"
        ? ["error", "No answer"]
        : listing?.status === "ok"
          ? ["ok", "Connected"]
          : listing?.status === "unset"
            ? ["warn", "No project folder"]
            : ["error", "Unreadable"];
  return (
    <header className="assets-head">
      <h2>Assets</h2>
      {files && <span className="faint mono">{props.count} images</span>}
      <span className={`chip ${chip}`}>{text}</span>
      {listing && listing.status !== "unset" && (
        <code className="assets-path" title={listing.dir}>
          {listing.dir}
        </code>
      )}
      {files && (
        <span className="faint small">
          {files.length} files · structure {present}/{expected.length}
        </span>
      )}
      <span className="spacer" />
      {props.note && <span className="faint small assets-note">{props.note}</span>}
      {props.onReload && (
        <button type="button" onClick={props.onReload} title="Catalogue images newly copied into the folder">
          Look for new images
        </button>
      )}
      <button type="button" className="ghost" onClick={check} disabled={checking}>
        {checking ? "Checking…" : "Check folder"}
      </button>
      <a className="button ghost" href={SETUP_HREF}>
        Project settings
      </a>
    </header>
  );
}

function AssetDetail({ asset, uses }: { asset: AssetInfo; uses: AssetUse[] }) {
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [state, setState] = useState<
    { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 1600);
    return () => clearTimeout(t);
  }, [state.kind]);
  const dirty = tags !== asset.tags.join(", ") || notes !== (asset.notes ?? "");

  const patch = async (body: { tags?: string[]; notes?: string | null; hidden?: boolean }) => {
    setState({ kind: "saving" });
    try {
      const r = await fetch(assetEntryUrl(asset.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error;
        throw new Error(msg ?? `HTTP ${r.status}`);
      }
      setState({ kind: "saved" });
      announceManifestChanged();
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section className="asset-detail">
      <div className="asset-detail-image">
        {asset.exists ? (
          <img src={assetImageUrl(asset.id)} alt={asset.id} />
        ) : (
          <span className="asset-missing">file missing</span>
        )}
      </div>
      <h3 className="asset-detail-id">{asset.id}</h3>
      <dl className="asset-facts">
        <dt>Kind</dt>
        <dd>{asset.kind}</dd>
        <dt>File</dt>
        <dd className="mono">{asset.file}</dd>
        {asset.source && (
          <>
            <dt>Source</dt>
            <dd>{asset.source}</dd>
          </>
        )}
        {asset.derived_from && (
          <>
            <dt>Edited from</dt>
            <dd className="mono">{asset.derived_from}</dd>
          </>
        )}
      </dl>
      <h4 className="props-head">Used in</h4>
      {uses.length === 0 ? (
        <p className="muted small">Not used in any saved layout.</p>
      ) : (
        <ul className="asset-uses">
          {uses.map((u) => (
            <li key={`${u.layout}/${u.element}`}>
              <span className="mono">{u.element}</span> <span className="faint">in {u.layout}</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="props"
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ tags: parseTags(tags), notes: notes.trim() ? notes : null });
        }}
      >
        <label>
          Tags <span className="faint">(comma-separated)</span>
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="toolbar">
          <button
            type="submit"
            className={dirty ? "primary" : ""}
            disabled={!dirty || state.kind === "saving"}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void patch({ hidden: !asset.hidden })}
            disabled={state.kind === "saving"}
            title={
              asset.hidden
                ? "Offer this image in the pickers again"
                : "Leave this image out of the pickers; the file and its entry stay"
            }
          >
            {asset.hidden ? "Unhide" : "Hide"}
          </button>
          <span className="spacer" />
          {state.kind === "saved" && <span className="small ok-text">Saved</span>}
        </div>
        {state.kind === "error" && <p className="small error-text">Not saved: {state.message}</p>}
      </form>
    </section>
  );
}
