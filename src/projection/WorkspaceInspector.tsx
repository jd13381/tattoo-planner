// The projection workspace's inspector (docs/adr/0024-projection-workspace.md): the current photo's
// checklist (checks.ts), the options of the tool in use, the edited version of the photo and the
// covered area. Every change goes through the workspace's undo history.
import type { AssetInfo } from "../assets/types.ts";
import { REGIONS } from "../body/regions.ts";
import type { SkinArea } from "./area.ts";
import { limbWord, type PhotoCheck } from "./checks.ts";
import { farLabel, startLabel, type DraftPhoto, type ProjectionDraft } from "./draft.ts";
import { chipAt, type LandmarkChip } from "./landmarks.ts";
import { DEFAULT_CLEANUP, type EditFit } from "./schema.ts";
import { SidePicker } from "./SidePicker.tsx";

export type Tool = "outline" | "distances" | "camera" | "cleanup";

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "outline", label: "Outline", key: "1", hint: "Drag the four orange dots onto the edges" },
  { id: "distances", label: "Distances", key: "2", hint: "Two points at known distances" },
  { id: "camera", label: "Camera", key: "3", hint: "Which side faces the camera" },
  { id: "cleanup", label: "Clean up", key: "4", hint: "Ink only, specks and the eraser" },
];

const CHECK_TOOL: Record<PhotoCheck["id"], Tool> = {
  outline: "outline",
  distances: "distances",
  facing: "camera",
  cleaned: "cleanup",
};

/** Nudge of an edited version per click, photo 0..1 (Shift: five times). */
const NUDGE = 0.002;

export function WorkspaceInspector(props: {
  draft: ProjectionDraft;
  index: number;
  photo: DraftPhoto;
  checks: PhotoCheck[];
  tool: Tool;
  setTool: (t: Tool) => void;
  setPhoto: (p: DraftPhoto, key?: string) => void;
  change: (f: (d: ProjectionDraft) => ProjectionDraft, key?: string) => void;
  chips: LandmarkChip[];
  activeMark: 0 | 1;
  setActiveMark: (i: 0 | 1) => void;
  area: SkinArea;
  regionLength: number;
  areaNote: string | null;
  /** The photo's edits from the Image studio (existing files), newest first. */
  edits: AssetInfo[];
  onStudio: (() => void) | null;
  shapeWarning: string | null;
  /** Shows the edit over the photo while its fit or shift is changed. */
  onAlign: () => void;
}) {
  const { draft, photo, tool, setPhoto, change, index } = props;
  const region = draft.region;
  const limb = limbWord(region);
  const start = startLabel(region);
  return (
    <aside className="pw-inspector" aria-label="Inspector">
      <section className="pw-section">
        <h2 className="pw-section-title">
          Photo <span className="mono">{index + 1}</span> of{" "}
          <span className="mono">{draft.photos.length}</span>
        </h2>
        <p className="faint xs mono pw-file" title={photo.file}>
          {photo.file.split("/").pop()}
        </p>
        <ul className="pw-checklist" aria-label="Checklist">
          {props.checks.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`pw-check ${c.state}${CHECK_TOOL[c.id] === tool ? " current" : ""}`}
                onClick={() => props.setTool(CHECK_TOOL[c.id])}
                title={c.text}
              >
                <span className={`pw-check-dot ${c.state}`} aria-hidden="true" />
                <span className="pw-check-label">{c.label}</span>
                <span className="pw-check-text xs">{c.text}</span>
                <span className="sr-only">
                  {c.state === "done"
                    ? "done"
                    : c.state === "error"
                      ? "needs fixing"
                      : c.state === "todo"
                        ? "to do"
                        : "optional"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {tool === "outline" && (
        <section className="pw-section">
          <h3 className="pw-section-title">Outline</h3>
          <p className="small">
            Drag the four orange dots onto the outline of the {limb}: one line along its left edge, one along
            its right edge, far apart, above and below the tattoo. Straight lines are enough. Tab moves
            between the dots, the arrow keys move one (Shift: further).
          </p>
        </section>
      )}

      {tool === "distances" && (
        <section className="pw-section">
          <h3 className="pw-section-title">Two known distances</h3>
          <p className="small">
            Drag the two red points onto two spots along the {limb} whose distance from the {start} you know,
            and set the distance: type it or click a landmark below. The ruler on the photo and the
            model&apos;s 2 cm lines should then match the skin.
          </p>
          {photo.marks.map((m, k) => {
            const chip = chipAt(props.chips, m.cm);
            return (
              <label
                key={k}
                className={`wizard-field inline-field pw-mark${props.activeMark === k ? " active" : ""}`}
              >
                <span className="field-label">Point {k + 1}</span>
                <span className="number-field">
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    value={m.cm}
                    aria-label={`Point ${k + 1}, cm from the ${start}`}
                    onFocus={() => props.setActiveMark(k as 0 | 1)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (e.target.value === "" || !Number.isFinite(v)) return;
                      const marks = photo.marks.map((q, i) =>
                        i === k ? { ...q, cm: v } : q,
                      ) as DraftPhoto["marks"];
                      setPhoto({ ...photo, marks }, `cm-${k}`);
                    }}
                  />
                  <span className="faint">cm{chip ? ` · ${chip.label.toLowerCase()}` : ""}</span>
                </span>
              </label>
            );
          })}
          <div className="pw-chips" role="group" aria-label={`Landmarks: set point ${props.activeMark + 1}`}>
            {props.chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`pw-chip${c.measured ? "" : " sample"}`}
                title={
                  c.measured
                    ? `Set point ${props.activeMark + 1} to the ${c.label.toLowerCase()}: ${c.cm} cm from the ${start} (your measurements)`
                    : `Set point ${props.activeMark + 1} to the ${c.label.toLowerCase()}: ${c.cm} cm from the ${start} (sample body; measure it in Settings → Body & measurements)`
                }
                onClick={() => {
                  const marks = photo.marks.map((q, i) =>
                    i === props.activeMark ? { ...q, cm: c.cm } : q,
                  ) as DraftPhoto["marks"];
                  setPhoto({ ...photo, marks });
                }}
              >
                {c.label} <span className="mono">{c.cm}</span>
              </button>
            ))}
          </div>
          <p className="faint xs">
            Point {props.activeMark + 1} is picked: click a point on the photo or its field to pick the other.
            Grey italic values come from the sample body.
          </p>
        </section>
      )}

      {tool === "camera" && (
        <section className="pw-section">
          <h3 className="pw-section-title">Where was the camera?</h3>
          <p className="small">
            Which side of the {limb} does the photo show? Click it, or drag the camera round the{" "}
            {REGIONS[region].label.toLowerCase()}. The coloured lines on the photo should run along the {limb}{" "}
            and the line of the side you picked down its middle; on the unwrap you can also drag the photo
            sideways.
          </p>
          <SidePicker
            region={region}
            value={photo.facing}
            onChange={(facing, key) =>
              setPhoto(
                { ...photo, facing, facingSet: true, ...(photo.twisted ? {} : { facingFar: facing }) },
                key,
              )
            }
          />
          <details className="wizard-advanced" open={photo.twisted}>
            <summary className="small">Advanced</summary>
            <label className="inline switch-label">
              <input
                type="checkbox"
                className="switch"
                checked={photo.twisted}
                onChange={(e) => setPhoto({ ...photo, twisted: e.target.checked, facingFar: photo.facing })}
              />
              Another side faces the camera at the {farLabel(region)} (the {limb} is twisted in the photo)
            </label>
            {photo.twisted && (
              <SidePicker
                region={region}
                value={photo.facingFar}
                onChange={(facingFar, key) => setPhoto({ ...photo, facingFar }, key && `far-${key}`)}
                compact
              />
            )}
          </details>
        </section>
      )}

      {tool === "cleanup" && <CleanupPanel draft={draft} change={change} limb={limb} />}

      <section className="pw-section">
        <h3 className="pw-section-title">Picture used for this photo</h3>
        <p className="faint xs">
          The points stay on the photo; an edited version from the Image studio (ink only, by hand or with
          GPT) can lend its pixels.
        </p>
        <select
          aria-label={`Picture used for photo ${index + 1}`}
          value={photo.cleaned ?? ""}
          onChange={(e) =>
            setPhoto({ ...photo, cleaned: e.target.value || null, cleanedFit: null, cleanedOffset: null })
          }
        >
          <option value="">The photo itself</option>
          {props.edits.map((e, k) => (
            <option key={e.id} value={e.file}>
              Edit {k + 1}: {e.id}
            </option>
          ))}
          {photo.cleaned && !props.edits.some((e) => e.file === photo.cleaned) && (
            <option value={photo.cleaned}>{photo.cleaned} (not found)</option>
          )}
        </select>
        {props.onStudio && (
          <button type="button" onClick={props.onStudio} title="Your changes here are kept">
            Edit in Image studio
          </button>
        )}
        {photo.cleaned && (
          <EditFitControls
            photo={photo}
            setPhoto={setPhoto}
            warning={props.shapeWarning}
            onAlign={props.onAlign}
          />
        )}
      </section>

      <AreaSection
        area={props.area}
        held={draft.area !== null}
        regionLength={props.regionLength}
        note={props.areaNote}
        onHold={() => change((d) => ({ ...d, area: props.area }))}
        onFit={() => change((d) => ({ ...d, area: null }))}
      />
    </aside>
  );
}

/** Ink only, its sliders and speck removal (the brush itself is on the canvas). */
function CleanupPanel({
  draft,
  change,
  limb,
}: {
  draft: ProjectionDraft;
  change: (f: (d: ProjectionDraft) => ProjectionDraft, key?: string) => void;
  limb: string;
}) {
  const cleanup = draft.cleanup;
  const specks = draft.erase?.specks_mm2 ?? 0;
  const setCleanup = (c: Partial<NonNullable<ProjectionDraft["cleanup"]>>, key?: string) =>
    change((d) => ({ ...d, cleanup: { ...(d.cleanup ?? DEFAULT_CLEANUP), ...c } }), key);
  return (
    <section className="pw-section">
      <h3 className="pw-section-title">Clean up (all photos)</h3>
      <p className="small">
        A photo shows more than the tattoo: the skin, its light and shadow and the shape of the {limb}. Ink
        only keeps the ink. The 3D view follows every change; on the canvas, hold Space to compare with the
        photos.
      </p>
      <label className="inline switch-label">
        <input
          type="checkbox"
          className="switch"
          checked={!!cleanup}
          onChange={(e) =>
            change((d) => ({ ...d, cleanup: e.target.checked ? { ...DEFAULT_CLEANUP } : null }))
          }
        />
        Keep only the ink
      </label>
      {cleanup && (
        <div className="cleanup-controls">
          <label className="wizard-field">
            <span className="field-label">
              Strength <span className="faint mono">{Math.round(cleanup.strength * 100)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(cleanup.strength * 100)}
              onChange={(e) => setCleanup({ strength: Number(e.target.value) / 100 }, "strength")}
            />
            <span className="side-turn-ends faint xs" aria-hidden="true">
              <span>keeps faint lines and grey</span>
              <span>only clear lines, solid</span>
            </span>
          </label>
          <label className="wizard-field">
            <span className="field-label">
              Shadows up to <span className="faint mono">{cleanup.flatten_cm} cm</span>
            </span>
            <input
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={cleanup.flatten_cm}
              onChange={(e) => setCleanup({ flatten_cm: Number(e.target.value) }, "flatten")}
            />
            <span className="faint xs">
              Larger evens out wider shadows; it should stay wider than the tattoo&apos;s thickest lines.
            </span>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={cleanup.keep_color}
              onChange={(e) => setCleanup({ keep_color: e.target.checked })}
            />{" "}
            Keep the ink&apos;s colour
          </label>
        </div>
      )}
      <label className="wizard-field">
        <span className="field-label">
          Remove small specks <span className="faint mono">{specks > 0 ? `up to ${specks} mm²` : "off"}</span>
        </span>
        <input
          type="range"
          min={0}
          max={150}
          step={1}
          value={specks}
          aria-label="Remove specks smaller than, in mm²"
          onChange={(e) =>
            change(
              (d) => ({
                ...d,
                erase: { strokes: d.erase?.strokes ?? [], specks_mm2: Number(e.target.value) },
              }),
              "specks",
            )
          }
        />
        <span className="faint xs">Drops dots and short streaks of grey that touch no other ink.</span>
      </label>
      <p className="small">
        Something left that is not tattoo? Paint over it on the canvas. <kbd className="kbd">E</kbd> eraser,{" "}
        <kbd className="kbd">R</kbd> restore, <kbd className="kbd">[</kbd> <kbd className="kbd">]</kbd> brush
        size, <kbd className="kbd">+</kbd> <kbd className="kbd">−</kbd> zoom, right button + drag moves.
      </p>
    </section>
  );
}

/** How the edited version lies on the photo: fit and a small shift (`cleaned_fit`, `cleaned_offset`). */
function EditFitControls({
  photo,
  setPhoto,
  warning,
  onAlign,
}: {
  photo: DraftPhoto;
  setPhoto: (p: DraftPhoto, key?: string) => void;
  warning: string | null;
  onAlign: () => void;
}) {
  const off = photo.cleanedOffset ?? { x: 0, y: 0 };
  const nudge = (dx: number, dy: number, big: boolean) => {
    onAlign();
    const k = big ? NUDGE * 5 : NUDGE;
    const r = (x: number) => Math.max(-0.5, Math.min(0.5, Math.round(x * 10000) / 10000));
    setPhoto({ ...photo, cleanedOffset: { x: r(off.x + dx * k), y: r(off.y + dy * k) } }, "edit-nudge");
  };
  const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;
  return (
    <div className="pw-fit">
      {warning && <p className="notice warn xs">{warning}</p>}
      <label className="wizard-field">
        <span className="field-label">Fit to the photo&apos;s frame</span>
        <select
          value={photo.cleanedFit ?? "stretch"}
          onChange={(e) => {
            onAlign();
            setPhoto({
              ...photo,
              cleanedFit: e.target.value === "stretch" ? null : (e.target.value as EditFit),
            });
          }}
        >
          <option value="stretch">Stretched onto the photo</option>
          <option value="contain">Photo inside the edit, bands on two sides</option>
          <option value="cover">Edit cut to the photo, two sides cropped</option>
        </select>
      </label>
      <div className="pw-nudge">
        <span className="field-label">Shift the edit</span>
        <span className="pw-nudge-pad" role="group" aria-label="Shift the edited version (Shift: further)">
          <button type="button" aria-label="Up" onClick={(e) => nudge(0, -1, e.shiftKey)}>
            ↑
          </button>
          <button type="button" aria-label="Left" onClick={(e) => nudge(-1, 0, e.shiftKey)}>
            ←
          </button>
          <button
            type="button"
            className="ghost xs"
            disabled={off.x === 0 && off.y === 0}
            onClick={() => setPhoto({ ...photo, cleanedOffset: null })}
            title="Back to no shift"
          >
            Reset
          </button>
          <button type="button" aria-label="Right" onClick={(e) => nudge(1, 0, e.shiftKey)}>
            →
          </button>
          <button type="button" aria-label="Down" onClick={(e) => nudge(0, 1, e.shiftKey)}>
            ↓
          </button>
        </span>
        <span className="faint xs mono">
          {pct(off.x)} · {pct(off.y)}
        </span>
      </div>
      <p className="faint xs">
        Pick the fit where photo and edit line up (the canvas shows both), then shift away what is left. If
        none lines up, the edit moved the lines: use the built-in clean-up instead.
      </p>
    </div>
  );
}

/** The covered area: automatic (follows the photos) or held. */
function AreaSection(props: {
  area: SkinArea;
  held: boolean;
  regionLength: number;
  note: string | null;
  onHold: () => void;
  onFit: () => void;
}) {
  const { area, held } = props;
  const cm = (v: number) => Math.round(v * props.regionLength * 10) / 10;
  const turn = Math.round((area.u[1] - area.u[0]) * 100);
  return (
    <section className="pw-section">
      <h3 className="pw-section-title">Covered area</h3>
      <p className="small">
        {held
          ? "Held: it stays as it is while the photos change."
          : "Automatic: it follows what the photos show, from the outline ends and the points."}{" "}
        <span className="faint mono xs">
          {cm(area.v[0])}–{cm(area.v[1])} cm, {turn} % round
        </span>
      </p>
      {props.note && <p className="notice small">{props.note}</p>}
      <span className="segmented" role="group" aria-label="Covered area">
        <button
          type="button"
          className={held ? "" : "active"}
          aria-pressed={!held}
          onClick={held ? props.onFit : undefined}
          title="The area follows the photos (dashed on the unwrap and in 3D)"
        >
          Fit to photos
        </button>
        <button
          type="button"
          className={held ? "active" : ""}
          aria-pressed={held}
          onClick={held ? undefined : props.onHold}
          title="Keep the area as it is now"
        >
          Hold area
        </button>
      </span>
    </section>
  );
}
