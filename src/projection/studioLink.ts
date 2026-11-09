// Hand-over between the projection workspace and the Image studio (docs/adr/0023, docs/adr/0024): the
// workspace parks its unsaved draft here (the Settings tab unmounts when another tab opens), asks the
// studio to open a photo with a prompt preset and gets its draft back when Settings → Projection opens
// again. In memory only: a reload ends it, as it ends the unsaved draft.
import type { ProjectionDraft } from "./draft.ts";

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

export type ParkedWorkspace = {
  /** The projection being edited (null = a new one). */
  editName: string | null;
  draft: ProjectionDraft;
  savedJson: string;
  /** The photo sent to the studio, and the ids of its edits at that moment. */
  photo: number;
  knownEdits: string[];
};

let request: StudioRequest | null = null;
let parked: ParkedWorkspace | null = null;

/** Parks the workspace and opens the Image studio on the photo. */
export function openInStudio(req: StudioRequest, workspace: ParkedWorkspace): void {
  parked = workspace;
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

/** The parked workspace, if any (read during render; `clearParkedWorkspace` once it is restored). */
export function parkedWorkspace(): ParkedWorkspace | null {
  return parked;
}

export function clearParkedWorkspace(): void {
  parked = null;
}
