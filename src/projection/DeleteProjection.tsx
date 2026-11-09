// "Delete" for an existing tattoo (Settings → Projection): a confirmation that says what happens. The
// projection file goes to the Trash as a deleted image does (server/projectionsApi.ts); its photos stay
// in Assets; the layouts showing it lose the element when the box is ticked, else keep it with
// "projection … not found". Refused for the read-only sample (the server answers 409 as well).
import { useEffect, useRef, useState } from "react";
import { announceManifestChanged } from "../assets/useAssets.ts";
import type { TrashMode } from "../assets/types.ts";
import type { StoredLayout, WorkingLayout } from "../layout/useLayouts.ts";
import { deletePlan } from "./layoutLink.ts";
import { deleteProjection } from "./useProjections.ts";

export const SAMPLE_PROJECTION_HINT =
  "The sample project is read-only. Save it as a new project (Settings → Project) to delete tattoos.";

type Props = {
  name: string;
  /** What the list calls it (its description, else its name). */
  label: string;
  photos: number;
  layouts: readonly StoredLayout[] | null;
  openLayout: WorkingLayout | null;
  trash: TrashMode | undefined;
  onCancel: () => void;
  onDeleted: (message: string) => void;
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function DeleteProjectionDialog(props: Props) {
  const { name, label, trash } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(props.onCancel);
  useEffect(() => {
    onCancelRef.current = props.onCancel;
  });
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal?.();
    cancelRef.current?.focus();
    const onClose = () => onCancelRef.current();
    d.addEventListener("cancel", onClose);
    return () => {
      d.removeEventListener("cancel", onClose);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const plan = deletePlan(props.layouts ?? [], name, props.openLayout);
  const [removeFromLayouts, setRemove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where =
    trash === "project"
      ? "goes to the .trash folder inside the project folder, where you can still find it"
      : "goes to the Trash, where you can put it back until you empty it";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await deleteProjection(name, removeFromLayouts ? plan.removable : []);
      announceManifestChanged(); // the photos' "used by" lists change
      const out = r.layouts.length
        ? ` and taken out of ${r.layouts.map((l) => l.name).join(", ")}`
        : plan.shownIn.length
          ? `; ${plan.shownIn.join(", ")} still ${plan.shownIn.length === 1 ? "has" : "have"} its element`
          : "";
      props.onDeleted(
        `${label} moved to ${r.trash === "project" ? "the project's trash folder" : "the Trash"}${out}.`,
      );
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="projection-delete-title"
      aria-describedby="projection-delete-body"
    >
      <h2 id="projection-delete-title" className="popover-title">
        Delete “{label}”?
      </h2>
      <p id="projection-delete-body" className="small muted">
        The projection file <span className="mono">{name}.yaml</span> (where{" "}
        {props.photos === 1 ? "the photo sits" : `the ${props.photos} photos sit`} on the body, the clean-up
        and the erasing) {where}. The {props.photos === 1 ? "photo stays" : "photos stay"} in Assets.
      </p>
      {plan.shownIn.length > 0 && (
        <>
          <label className="inline projection-delete-layouts">
            <input
              type="checkbox"
              checked={removeFromLayouts}
              disabled={plan.removable.length === 0}
              onChange={(e) => setRemove(e.target.checked)}
            />
            <span>
              Also remove it from{" "}
              {plan.shownIn.length === 1 ? "the layout" : plural(plan.shownIn.length, "layout")} that{" "}
              {plan.shownIn.length === 1 ? "shows" : "show"} it: {plan.shownIn.join(", ")}
            </span>
          </label>
          {(!removeFromLayouts || plan.heldBack) && (
            <p className="small faint">
              {plan.heldBack &&
                `${plan.heldBack} has unsaved edits in the Layout tab, so it is left as it is. `}
              A layout left with the element shows “projection {name} not found” there until you remove it.
            </p>
          )}
        </>
      )}
      {error && <p className="small error-text">{error}</p>}
      <div className="toolbar">
        <button ref={cancelRef} type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <span className="spacer" />
        <button type="button" className="danger" onClick={() => void confirm()} disabled={busy}>
          {busy ? "Moving…" : trash === "project" ? "Move to trash folder" : "Move to Trash"}
        </button>
      </div>
    </dialog>
  );
}
