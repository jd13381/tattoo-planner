// "Change image": a large panel with the asset grid and a search field (sized to the window,
// src/assets/pickerPlacement.ts), opened next to the button that asked for it (the element panel or
// the floating button on the 2D editor). Click an image to
// assign it; Esc, a click outside or the close button closes the panel. Rendered into <body> so
// the scrolling inspector and the clipped editor do not cut it off.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { filterAssets, NO_FILTER, type AssetFilter } from "./filter.ts";
import { pickerBox } from "./pickerPlacement.ts";
import { assetImageUrl, type AssetInfo, type AssetListing } from "./types.ts";
import { PickerScopeControls, usePickerScope } from "./usePickerScope.tsx";
import { CloseIcon } from "../ui/icons.tsx";

type Props = {
  listing: AssetListing | null;
  /** The element's current asset, highlighted and kept even when hidden. */
  current?: string;
  /** Shown in the title ("Image for medusa"). */
  elementId: string;
  /** The button that opened the picker; the panel opens next to it and focus returns to it. */
  anchor: HTMLElement;
  onPick: (asset: AssetInfo) => void;
  onClose: () => void;
  /** Offer photos from the start (an existing tattoo shows a photo). */
  photos?: boolean;
};

function placement(r: DOMRect) {
  return pickerBox(r, window.innerWidth, window.innerHeight);
}

export function ImagePicker({ listing, current, elementId, anchor, onPick, onClose, photos }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const [pos, setPos] = useState(() => placement(anchor.getBoundingClientRect()));
  useLayoutEffect(() => {
    const update = () => setPos(placement(anchor.getBoundingClientRect()));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchor]);

  // The library by default; photos on request. Hidden images only when in use.
  const scope = usePickerScope(listing, current, photos);
  const assets = scope.assets;
  const [filter, setFilter] = useState<AssetFilter>(NO_FILTER);
  const shown = useMemo(() => filterAssets(assets, filter), [assets, filter]);

  useEffect(() => {
    searchRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc closes the picker only; it does not also deselect in the editor.
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchor]);

  let body: React.ReactNode;
  if (!listing) body = <p className="muted small">Loading…</p>;
  else if (listing.status === "unset")
    body = (
      <p className="muted small">
        No project folder, so no images yet. <a href="#settings/project">Set it up in Settings → Project</a>.
      </p>
    );
  else if (listing.status === "error") body = <p className="small error-text">{listing.message}</p>;
  else if (listing.assets.length === 0)
    body = (
      <p className="muted small">
        No images catalogued yet. Add some in the <a href="#assets">Assets</a> tab.
      </p>
    );
  else
    body = (
      <>
        <div className="picker-filters">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search images"
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault();
                onPick(shown[0]);
              }
            }}
            aria-label="Search images"
          />
          <PickerScopeControls scope={scope} />
        </div>
        {shown.length === 0 ? (
          <p className="muted small picker-none">
            Nothing matches.{" "}
            <button type="button" className="link" onClick={() => setFilter(NO_FILTER)}>
              Clear the search
            </button>
          </p>
        ) : (
          <ul className="asset-grid picker-grid">
            {shown.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`asset-card${a.id === current ? " current" : ""}${a.exists ? "" : " missing"}`}
                  aria-pressed={a.id === current}
                  title={[a.id, a.source, a.notes].filter(Boolean).join("\n")}
                  disabled={!a.exists}
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
        )}
      </>
    );

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Image for ${elementId}`}
      className="image-picker popover"
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.height }}
    >
      <div className="image-picker-head">
        <p className="popover-title">
          Image for <span className="mono">{elementId}</span>
        </p>
        <span className="spacer" />
        <span className="faint xs">
          <kbd className="kbd">Esc</kbd> closes
        </span>
        <button type="button" className="ghost icon-button small-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {body}
    </div>,
    document.body,
  );
}
