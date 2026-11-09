// The projection workspace's setup sheet (docs/adr/0024-projection-workspace.md): name, body part and
// which photos, in one sheet over the workspace. A new tattoo starts here; later it opens again from
// the title or "Add photo". Edits from the Image studio sit on their original photo
// (photoVersions.ts): picking one keeps the original as the frame and uses the edit's pixels.
import { useEffect, useMemo, useState } from "react";
import { fileKey } from "../assets/manifestDoc.ts";
import { useCurrentPerson } from "../assets/person.ts";
import { assetImageUrl, type AssetInfo } from "../assets/types.ts";
import { REGION_IDS, REGIONS, type RegionId } from "../body/regions.ts";
import { limbWord } from "./checks.ts";
import { slugify, type PhotoPick } from "./draft.ts";
import type { ListingState } from "./photoStatus.ts";
import { projectionPhotoGroups } from "../assets/projectionPhotos.ts";
import { pickedVersion, pickIndex, stackOf, togglePick, type PhotoStack } from "./photoVersions.ts";

export type SetupAnswers = { description: string; name: string; region: RegionId; picks: PhotoPick[] };

export function SetupSheet(props: {
  isNew: boolean;
  initial: SetupAnswers;
  /** Name taken for a new tattoo, in words; checked as the user types. */
  nameIssue: (name: string) => string | null;
  assets: AssetInfo[] | null;
  listingState: ListingState;
  scan: { run: () => void; note: string | null };
  onApply: (answers: SetupAnswers) => void;
  onCancel: () => void;
}) {
  const { isNew, initial } = props;
  const [answers, setAnswers] = useState<SetupAnswers>(initial);
  const issue = props.nameIssue(answers.name);
  const canApply = !issue && answers.picks.length > 0;

  // Esc closes the sheet (for a new tattoo: leaves, as Cancel does), before the page's own Esc.
  const cancel = props.onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel]);

  return (
    <div className="pw-sheet-backdrop">
      <div className="pw-sheet panel" role="dialog" aria-modal="true" aria-label="Set up the tattoo">
        <header className="pw-sheet-head">
          <h2>{isNew ? "Add existing tattoo" : "Name, body part and photos"}</h2>
          <p className="muted small">
            Name it, say where it is and pick its photos. Everything else happens in the workspace, with the
            result live in 3D.
          </p>
        </header>
        <div className="pw-sheet-body">
          <div className="pw-sheet-fields">
            <label className="wizard-field">
              <span className="field-label">Name</span>
              <input
                type="text"
                value={answers.description}
                placeholder={isNew ? "e.g. Rose on the calf" : answers.name}
                autoFocus
                onChange={(e) => {
                  const description = e.target.value;
                  setAnswers((a) => ({
                    ...a,
                    description,
                    ...(isNew ? { name: slugify(description) } : {}),
                  }));
                }}
              />
            </label>
            {answers.name && (
              <p className="faint xs">
                Saved as <span className="mono">{answers.name}</span>
                {!isNew && " (the file name stays)"}
              </p>
            )}
            {issue && answers.description && <p className="wizard-issue small">{issue}</p>}
            <fieldset className="wizard-regions">
              <legend className="field-label">Body part</legend>
              {REGION_IDS.map((id) => (
                <label key={id} className={`region-choice${id === answers.region ? " active" : ""}`}>
                  <input
                    type="radio"
                    name="setup-region"
                    value={id}
                    checked={id === answers.region}
                    onChange={() => setAnswers((a) => ({ ...a, region: id }))}
                  />
                  {REGIONS[id].label}
                </label>
              ))}
            </fieldset>
            <p className="faint small">
              Each photo should show the whole width of the {limbWord(answers.region)} with a little
              background on both sides, from about a metre away. Photos from different sides fill in the parts
              that wrap round.
            </p>
            <p className="faint small">
              A photo not in the list? Put it into the project folder&apos;s{" "}
              <span className="mono">photos/</span> folder, then look for new images.
            </p>
            <button type="button" onClick={props.scan.run}>
              Look for new images
            </button>
            {props.scan.note && <p className="faint xs">{props.scan.note}</p>}
          </div>
          <PhotoPicker
            assets={props.assets}
            listingState={props.listingState}
            picks={answers.picks}
            onChange={(picks) => setAnswers((a) => ({ ...a, picks }))}
          />
        </div>
        <footer className="pw-sheet-foot">
          <span className="faint small">
            {answers.picks.length === 0
              ? "No photo picked yet."
              : `${answers.picks.length} photo${answers.picks.length === 1 ? "" : "s"} picked.`}
          </span>
          <span className="spacer" />
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canApply}
            title={issue ?? (answers.picks.length === 0 ? "Pick at least one photo" : undefined)}
            onClick={() => props.onApply(answers)}
          >
            {isNew ? "Start" : "Done"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The current person's body photos, tattoo photos first, each with its edits on it; everything else
 * folded away. A click picks or unpicks a version; the order of picking counts.
 */
function PhotoPicker(props: {
  assets: AssetInfo[] | null;
  listingState: ListingState;
  picks: PhotoPick[];
  onChange: (picks: PhotoPick[]) => void;
}) {
  const { assets, listingState, picks, onChange } = props;
  const person = useCurrentPerson();
  const [text, setText] = useState("");
  const groups = useMemo(() => {
    const g = projectionPhotoGroups(assets ?? [], person.id, text);
    return {
      tattoos: g.tattoos.map(stackOf),
      measuring: g.measuring.map(stackOf),
      others: g.others.map(stackOf),
    };
  }, [assets, person.id, text]);
  if (listingState === "loading") return <p className="wizard-message muted">Reading the project folder…</p>;
  if (listingState !== "ok")
    return (
      <div className="wizard-message">
        <p className="muted">
          There is no project folder to take photos from yet.{" "}
          <a href="#settings/project">Set it up in Settings → Project</a>.
        </p>
      </div>
    );
  const grid = (list: PhotoStack<AssetInfo>[]) => (
    <ul className="asset-grid wizard-grid pw-stacks">
      {list.map((s) => {
        const n = pickIndex(s, picks);
        const chosen = pickedVersion(s, picks);
        const versions = [s.root, ...s.edits];
        return (
          <li key={s.root.id} className={`pw-stack${n >= 0 ? " picked" : ""}`}>
            <button
              type="button"
              className={`asset-card${n >= 0 ? " current" : ""}${s.root.exists ? "" : " missing"}`}
              aria-pressed={n >= 0}
              disabled={!s.root.exists && n < 0}
              title={chosen && chosen.id !== s.root.id ? `${s.root.file}, using ${chosen.file}` : s.root.file}
              onClick={() => onChange(togglePick(s, chosen ?? s.root, picks))}
            >
              {(chosen ?? s.root).exists ? (
                <img src={assetImageUrl((chosen ?? s.root).id)} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="asset-missing">file missing</span>
              )}
              <span className="asset-id">{s.root.id}</span>
              {n >= 0 && <span className="pick-badge mono">{n + 1}</span>}
              {s.edits.length > 0 && (
                <span className="pw-stack-count xs" aria-hidden="true">
                  +{s.edits.length}
                </span>
              )}
            </button>
            {s.edits.length > 0 && (
              <span className="pw-versions" role="group" aria-label={`Versions of ${s.root.id}`}>
                {versions.map((v, k) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`pw-version${chosen?.id === v.id ? " current" : ""}`}
                    aria-pressed={chosen?.id === v.id}
                    title={k === 0 ? "The photo itself" : `Edited version ${v.id} (Image studio)`}
                    onClick={() => onChange(togglePick(s, v, picks))}
                  >
                    <img src={assetImageUrl(v.id)} alt="" loading="lazy" decoding="async" />
                    <span className="xs">{k === 0 ? "Photo" : `Edit ${k}`}</span>
                  </button>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
  const pickedKeys = picks.map((p) => fileKey(p.file));
  return (
    <div className="pw-picker">
      <input
        type="search"
        placeholder="Search images"
        aria-label="Search images"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <h3 className="float-title">Tattoo photos</h3>
      {groups.tattoos.length ? (
        grid(groups.tattoos)
      ) : (
        <p className="faint small">
          No tattoo photos yet. Add them in the <a href="#assets">Assets</a> tab (Tattoo photos).
        </p>
      )}
      {groups.measuring.length > 0 && (
        <>
          <h3 className="float-title">Measuring photos</h3>
          {grid(groups.measuring)}
        </>
      )}
      {groups.others.length > 0 && (
        <details
          className="wizard-others"
          open={text !== "" || groups.others.some((s) => pickedKeys.includes(fileKey(s.root.file)))}
        >
          <summary className="float-title">Other images ({groups.others.length})</summary>
          {grid(groups.others)}
        </details>
      )}
    </div>
  );
}
