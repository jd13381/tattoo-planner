// Settings → Projection (docs/adr/0014-guided-projection.md): the existing tattoos brought onto the body
// from photos. A list with each tattoo's photo, body part and state; "Add existing tattoo" and "Edit"
// open the guided wizard, "Advanced" the full calibration page (ProjectionPage.tsx), "Delete" asks
// first (DeleteProjection.tsx).
import { useEffect, useMemo, useState } from "react";
import { fileKey } from "../assets/manifestDoc.ts";
import type { AssetInfo } from "../assets/types.ts";
import { assetImageUrl } from "../assets/types.ts";
import { useAssetListing } from "../assets/useAssets.ts";
import { REGIONS } from "../body/regions.ts";
import { useLayouts, type WorkingLayout } from "../layout/useLayouts.ts";
import { projectStatus } from "../project/projectData.ts";
import { ToastRegion, useToast } from "../ui/Toast.tsx";
import type { ArmState, Pose } from "../viewer/useArm.ts";
import { DeleteProjectionDialog, SAMPLE_PROJECTION_HINT } from "./DeleteProjection.tsx";
import { layoutsShowing } from "./layoutLink.ts";
import { ProjectionPage } from "./ProjectionPage.tsx";
import { ProjectionWizard } from "./ProjectionWizard.tsx";
import { projectionRegion, type ProjectionCalibration } from "./schema.ts";
import { clearParkedWizard, parkedWizard, type ParkedWizard } from "./studioLink.ts";
import { useProjections } from "./useProjections.ts";

type View =
  | { kind: "list" }
  | { kind: "wizard"; name: string | null; parked?: ParkedWizard }
  | { kind: "advanced"; name: string };

type Props = {
  arm: ArmState;
  pose: Pose;
  onDirty?: (dirty: boolean) => void;
  openLayout?: WorkingLayout | null;
};

export function ProjectionSettings({ arm, pose, onDirty, openLayout }: Props) {
  // Back from the Image studio (docs/adr/0023): the wizard opens again with its answers.
  const [view, setView] = useState<View>(() => {
    const p = parkedWizard();
    return p ? { kind: "wizard", name: p.editName, parked: p } : { kind: "list" };
  });
  useEffect(() => clearParkedWizard(), []);
  const toList = () => {
    onDirty?.(false);
    setView({ kind: "list" });
  };
  const { calibrations } = useProjections();
  const { files: layoutFiles } = useLayouts();
  const { listing } = useAssetListing();
  const toast = useToast(4000);
  const readOnly = projectStatus?.sample === true || (listing?.status === "ok" && listing.readOnly === true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deleteCal = deleting ? calibrations.get(deleting) : undefined;
  const deleteDialog = deleting && (
    <DeleteProjectionDialog
      key={deleting}
      name={deleting}
      label={deleteCal?.description ?? deleting}
      photos={deleteCal?.photos.length ?? 0}
      layouts={layoutFiles}
      openLayout={openLayout ?? null}
      trash={listing?.status === "ok" ? listing.trash : undefined}
      onCancel={() => setDeleting(null)}
      onDeleted={(message) => {
        setDeleting(null);
        toList();
        toast.show(message);
      }}
    />
  );
  /** Delete from the wizard and the Advanced page too (unsaved changes there are dropped with it). */
  const onDelete = readOnly ? undefined : (name: string) => setDeleting(name);
  let page;
  if (view.kind === "advanced")
    page = (
      <ProjectionPage
        arm={arm}
        pose={pose}
        onDirty={onDirty}
        initialName={view.name}
        onBack={toList}
        onDelete={onDelete}
      />
    );
  else if (view.kind === "wizard")
    page = (
      <ProjectionWizard
        key={view.name ?? "new"}
        arm={arm}
        pose={pose}
        editName={view.name}
        openLayout={openLayout ?? null}
        onDirty={onDirty}
        onClose={toList}
        onAdvanced={(name) => setView({ kind: "advanced", name })}
        onAnother={() => setView({ kind: "wizard", name: null })}
        onDelete={onDelete}
        parked={view.parked ?? null}
      />
    );
  else
    page = (
      <ProjectionList
        onAdd={() => setView({ kind: "wizard", name: null })}
        onEdit={(name) => setView({ kind: "wizard", name })}
        onAdvanced={(name) => setView({ kind: "advanced", name })}
        onDelete={(name) => setDeleting(name)}
        readOnly={readOnly}
      />
    );
  return (
    <>
      {page}
      {deleteDialog}
      <ToastRegion toast={toast} />
    </>
  );
}

type Status = { tone: "ok" | "warn" | "error" | "muted"; text: string; detail?: string };

/** One line on a tattoo's state: can its photos be read, is it in a layout. */
function statusOf(
  cal: ProjectionCalibration,
  assets: ReadonlyMap<string, AssetInfo> | null,
  listing: "loading" | "unset" | "error" | "ok",
): Status {
  const n = cal.photos.length;
  const photos = `${n} photo${n === 1 ? "" : "s"}`;
  if (listing === "loading") return { tone: "muted", text: photos };
  if (listing !== "ok") return { tone: "muted", text: `${photos} · no project folder to read them from` };
  const byFile = new Map([...(assets?.values() ?? [])].map((a) => [fileKey(a.file), a]));
  const missing = cal.photos.filter((p) => !byFile.get(fileKey(p.file))?.exists);
  if (missing.length === n)
    return { tone: "error", text: `None of the ${photos} found`, detail: list(missing) };
  if (missing.length > 0)
    return { tone: "warn", text: `${missing.length} of ${photos} missing`, detail: list(missing) };
  return { tone: "ok", text: `Ready · ${photos}` };
}

const list = (photos: { file: string }[]) => photos.map((p) => p.file).join("\n");

function ProjectionList(props: {
  onAdd: () => void;
  onEdit: (name: string) => void;
  onAdvanced: (name: string) => void;
  onDelete: (name: string) => void;
  readOnly: boolean;
}) {
  const { files, calibrations, errors, loadError } = useProjections();
  const { listing } = useAssetListing();
  const { files: layoutFiles } = useLayouts();
  const assetMap = useMemo(
    () => (listing?.status === "ok" ? new Map(listing.assets.map((a) => [a.id, a])) : null),
    [listing],
  );
  const byFile = useMemo(
    () => new Map([...(assetMap?.values() ?? [])].map((a) => [fileKey(a.file), a])),
    [assetMap],
  );
  const listingState = listing === null ? "loading" : listing.status;

  return (
    <div className="projection-list-page">
      <div className="projection-list">
        <header className="projection-list-head">
          <div>
            <h1>Existing tattoos</h1>
            <p className="muted">
              Bring a tattoo you already have onto the body from one or more photos of it. A short guided
              setup asks a few questions per photo; the planner then wraps the tattoo round the body part
              where the photos show it.
            </p>
          </div>
          <button type="button" className="primary" onClick={props.onAdd}>
            Add existing tattoo
          </button>
        </header>
        {loadError && (
          <p className="notice error" role="alert">
            {loadError}
          </p>
        )}
        {files === null && !loadError && <p className="muted">Loading…</p>}
        {files !== null && files.length === 0 && !loadError && (
          <section className="empty">
            <h2>No existing tattoos yet</h2>
            <p className="muted">
              Take one to four photos of the tattoo from about a metre away, from different sides, and put
              them into the project folder. Then press Add existing tattoo.
            </p>
          </section>
        )}
        {files !== null && files.length > 0 && (
          <ul className="projection-cards">
            {files.map((f) => {
              const cal = calibrations.get(f.name);
              const error = errors.get(f.name);
              const first = cal?.photos.map((p) => byFile.get(fileKey(p.file))).find((a) => a?.exists);
              const turn = cal?.photos.find((p) => byFile.get(fileKey(p.file))?.exists)?.turn ?? 0;
              const status: Status = cal
                ? statusOf(cal, assetMap, listingState)
                : { tone: "error", text: "The file has errors", detail: error };
              const shownIn = cal && layoutFiles ? layoutsShowing(layoutFiles, f.name) : [];
              return (
                <li key={f.name} className="projection-card card">
                  <div className="projection-thumb">
                    {first ? (
                      <img
                        src={assetImageUrl(first.id)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        style={{ transform: `rotate(${turn}deg)` }}
                      />
                    ) : (
                      <span className="faint xs">no photo</span>
                    )}
                  </div>
                  <div className="projection-card-body">
                    <h2 title={f.name}>{cal?.description ?? f.name}</h2>
                    <p className="faint xs">
                      <span className="mono">{f.name}</span>
                      {cal && <> · {REGIONS[projectionRegion(cal)].label}</>}
                    </p>
                    <p className="projection-card-status">
                      <span className={`chip ${status.tone}`} title={status.detail}>
                        {status.text}
                      </span>
                      {cal && layoutFiles && (
                        <span className="faint xs">
                          {shownIn.length ? `In layout ${shownIn.join(", ")}` : "Not in any layout yet"}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="projection-card-actions">
                    <button
                      type="button"
                      disabled={!cal}
                      onClick={() => props.onEdit(f.name)}
                      title={cal ? "Step through the guided setup with this tattoo's answers" : error}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => props.onAdvanced(f.name)}
                      title="Every number of the calibration, for fine-tuning"
                    >
                      Advanced
                    </button>
                    <button
                      type="button"
                      className="ghost danger-text"
                      disabled={props.readOnly}
                      onClick={() => props.onDelete(f.name)}
                      title={
                        props.readOnly
                          ? SAMPLE_PROJECTION_HINT
                          : "Move this tattoo's projection file to the Trash; the photos stay"
                      }
                    >
                      Delete…
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
