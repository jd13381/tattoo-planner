import { useMemo, useState } from "react";
import { facets, filterAssets, NO_FILTER, type AssetFilter } from "./filter.ts";
import { assetImageUrl, type AssetInfo, type AssetListing } from "./types.ts";

type Props = {
  listing: AssetListing | null;
  onReload: () => void;
  /** Asset of the selected figure, highlighted in the grid. */
  current?: string;
  /** Why clicking does not assign, or null when it does. */
  assignBlocked: string | null;
  onPick: (asset: AssetInfo) => void;
  /** false leaves out the heading (a tabbed panel names the browser and offers Reload). */
  heading?: boolean;
};

/** Thumbnails of the manifest assets; clicking one assigns it to the selected figure. */
export function AssetBrowser(props: Props) {
  const { listing, onReload, current, assignBlocked, onPick, heading = true } = props;
  const [filter, setFilter] = useState<AssetFilter>(NO_FILTER);
  const assets = useMemo(() => (listing?.status === "ok" ? listing.assets : []), [listing]);
  const kinds = useMemo(() => facets(assets.map((a) => a.kind)), [assets]);
  const tags = useMemo(() => facets(assets.flatMap((a) => a.tags)), [assets]);
  const shown = useMemo(() => filterAssets(assets, filter), [assets, filter]);

  let body: React.ReactNode;
  if (!listing) body = <p className="muted small">Loading…</p>;
  else if (listing.status === "unset")
    body = (
      <p className="muted small">
        No data folder, so no reference images. The <strong>Data folder</strong> tab explains the setup.
      </p>
    );
  else if (listing.status === "error") body = <p className="small error-text">{listing.message}</p>;
  else if (!listing.manifestFound)
    body = (
      <p className="small">
        No <code>manifest.yaml</code> in the data folder yet. Run <code>npm run ingest</code> to catalogue the
        images, or write the file by hand (README, “Asset manifest”).
      </p>
    );
  else if (assets.length === 0) body = <p className="small muted">The manifest lists no assets.</p>;
  else
    body = (
      <>
        <div className="asset-filters">
          <input
            type="search"
            placeholder="Search id, notes, source"
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            aria-label="Search assets"
          />
          <select
            value={filter.kind}
            onChange={(e) => setFilter({ ...filter, kind: e.target.value })}
            aria-label="Kind"
          >
            <option value="">all kinds</option>
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
            <option value="">all tags</option>
            {tags.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value} ({t.count})
              </option>
            ))}
          </select>
        </div>
        <p className="muted small">
          {shown.length} of {assets.length}.{" "}
          {assignBlocked ?? "Click an image to assign it to the selected figure."}
        </p>
        <ul className="asset-grid">
          {shown.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={`asset-card${a.id === current ? " current" : ""}${a.exists ? "" : " missing"}`}
                title={[a.id, a.file, a.source, a.notes].filter(Boolean).join("\n")}
                disabled={!!assignBlocked}
                onClick={() => onPick(a)}
              >
                {a.exists ? (
                  <img src={assetImageUrl(a.id)} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="asset-missing">file missing</span>
                )}
                <span className="asset-id">{a.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    );

  const warnings = listing?.status === "ok" ? listing.warnings : [];
  return (
    <section className={heading ? "panel asset-browser" : "asset-browser"} aria-label="Assets">
      {heading && (
        <div className="panel-head">
          <h2>Assets</h2>
          <button
            type="button"
            className="ghost"
            onClick={onReload}
            title="Re-read manifest.yaml and the images"
          >
            Reload
          </button>
        </div>
      )}
      {body}
      {warnings.length > 0 && (
        <details className="small warn">
          <summary>
            {warnings.length} manifest warning{warnings.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The asset image with the element's cut-out drawn on top (the stored image, before any turn). */
export function AssetThumb({
  asset,
  crop,
}: {
  asset: AssetInfo;
  crop?: { x: number; y: number; w: number; h: number };
}) {
  if (!asset.exists) return <p className="warn small">{asset.file}: file missing</p>;
  return (
    <div className="asset-thumb">
      <img src={assetImageUrl(asset.id)} alt={asset.id} />
      {crop && (
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <path
            d={`M0 0H1V1H0Z M${crop.x} ${crop.y}v${crop.h}h${crop.w}v${-crop.h}Z`}
            fillRule="evenodd"
            className="crop-shade"
          />
          <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} className="crop-rect" />
        </svg>
      )}
    </div>
  );
}
