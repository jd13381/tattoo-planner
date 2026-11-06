// What the image pickers (the Assets side tab, Change image) offer: the library by default, photos
// on request (docs/adr/0020-asset-structure.md), and a section filter instead of raw kinds.
import { useMemo, useState } from "react";
import type { AssetCategory } from "./category.ts";
import { photoCount, pickerAssets } from "./filter.ts";
import type { AssetInfo, AssetListing } from "./types.ts";

const PICKER_SECTIONS: { id: string; label: string; categories: AssetCategory[] }[] = [
  { id: "ideas", label: "Ideas", categories: ["reference"] },
  { id: "studio", label: "Made in studio", categories: ["generated", "edit"] },
  { id: "backgrounds", label: "Backgrounds", categories: ["background"] },
  { id: "photos", label: "Photos", categories: ["measuring", "existing"] },
];

export function usePickerScope(
  listing: AssetListing | null,
  current: string | undefined,
  photosFirst = false,
) {
  const [showPhotos, setShowPhotos] = useState(photosFirst);
  const [section, setSection] = useState("");
  const all = useMemo(() => (listing?.status === "ok" ? listing.assets : []), [listing]);
  const offered = useMemo(
    () => pickerAssets(all, { photos: showPhotos, backgrounds: true }, current),
    [all, showPhotos, current],
  );
  const sections = PICKER_SECTIONS.map((s) => ({
    ...s,
    count: offered.filter((a) => s.categories.includes(a.effectiveCategory)).length,
  })).filter((s) => s.count > 0);
  const chosen = sections.find((s) => s.id === section);
  const assets: AssetInfo[] = chosen
    ? offered.filter((a) => chosen.categories.includes(a.effectiveCategory) || a.id === current)
    : offered;
  return {
    assets,
    sections,
    section: chosen ? section : "",
    setSection,
    showPhotos,
    setShowPhotos,
    photos: photoCount(all),
  };
}

export type PickerScopeState = ReturnType<typeof usePickerScope>;

/** The section select and the "Show photos" switch of a picker. */
export function PickerScopeControls({ scope }: { scope: PickerScopeState }) {
  return (
    <>
      <select value={scope.section} onChange={(e) => scope.setSection(e.target.value)} aria-label="Section">
        <option value="">All sections</option>
        {scope.sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} ({s.count})
          </option>
        ))}
      </select>
      {scope.photos > 0 && (
        <label className="inline switch-label picker-photos">
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={scope.showPhotos}
            onChange={(e) => scope.setShowPhotos(e.target.checked)}
          />
          Show photos <span className="faint mono">({scope.photos})</span>
        </label>
      )}
    </>
  );
}
