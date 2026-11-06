// Hand-over between the projection wizard and the Image studio (docs/adr/0023): the wizard parks its
// unsaved answers here (the Settings tab unmounts when another tab opens), asks the studio to open a
// photo with a prompt preset and gets its answers back when Settings → Projection opens again. In
// memory only: a reload ends it, as it ends the wizard's answers.
import type { WizardDraft, WizardStep } from "./wizard.ts";

export const STUDIO_REQUEST_EVENT = "tattoo-planner:studio-request";

export type StudioRequest = {
  /** The image to open in the studio. */
  assetId: string;
  /** Prompt preset for a generative edit. */
  instruction: string;
  /** What the edit is for, shown in the studio with a way back. */
  purpose: string;
  /** Hash of the page to go back to. */
  back: string;
};

export type ParkedWizard = {
  /** The projection being edited (null = a new one). */
  editName: string | null;
  draft: WizardDraft;
  savedJson: string;
  step: WizardStep;
  /** The photo sent to the studio, and the ids of its edits at that moment. */
  photo: number;
  knownEdits: string[];
};

let request: StudioRequest | null = null;
let parked: ParkedWizard | null = null;

/** Parks the wizard and opens the Image studio on the photo. */
export function openInStudio(req: StudioRequest, wizard: ParkedWizard): void {
  parked = wizard;
  request = req;
  window.dispatchEvent(new CustomEvent<StudioRequest>(STUDIO_REQUEST_EVENT, { detail: req }));
  window.location.hash = "#images";
}

/** The studio's open request, once (the studio stays mounted and also listens for the event). */
export function takeStudioRequest(): StudioRequest | null {
  const r = request;
  request = null;
  return r;
}

/** The parked wizard, if any (read during render; `clearParkedWizard` once it is restored). */
export function parkedWizard(): ParkedWizard | null {
  return parked;
}

export function clearParkedWizard(): void {
  parked = null;
}
