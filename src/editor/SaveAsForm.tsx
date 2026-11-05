import { useState } from "react";
import { checkVariantName } from "./layoutOps.ts";

type Props = {
  /** The free name the field starts with. */
  suggested: string;
  /** Existing variant names. */
  taken: readonly string[];
  /** The open variant. */
  current: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
};

/** Body of the Save as… popover: a name field with live validation. Enter saves, Esc cancels. */
export function SaveAsForm({ suggested, taken, current, onSave, onCancel }: Props) {
  const [value, setValue] = useState(suggested);
  const check = checkVariantName(value, taken, current);
  const blocked = check.status === "invalid";
  const overwrite = check.status === "exists" && check.name !== current;

  return (
    <form
      className="save-as-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) onSave(check.name);
      }}
    >
      <label htmlFor="save-as-name" className="popover-title">
        Save as a new variant
      </label>
      <input
        id="save-as-name"
        type="text"
        data-autofocus
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={blocked}
        aria-describedby="save-as-hint"
        onChange={(e) => setValue(e.target.value)}
      />
      <p
        id="save-as-hint"
        className={`field-hint${check.status === "invalid" ? " error" : check.status === "exists" ? " warn" : ""}`}
        aria-live="polite"
      >
        {check.status === "ok"
          ? `Saves layouts/${check.name}.yaml as a copy of what you see; ${current ?? "the open variant"} stays as saved.`
          : check.message}
      </p>
      <div className="toolbar">
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={overwrite ? "danger" : "primary"} disabled={blocked}>
          {overwrite ? "Overwrite" : "Save"}
        </button>
      </div>
    </form>
  );
}
