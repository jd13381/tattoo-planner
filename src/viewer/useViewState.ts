import { useMemo, useState } from "react";
import type { ViewName } from "./views.ts";

export type ViewState = {
  view: ViewName;
  /** True once the user rotates by hand; `view` stays the fixed view to return to. */
  free: boolean;
  /** Bumped on every view button press, so pressing the current view again resets the camera. */
  request: number;
  select: (name: ViewName) => void;
  setFree: () => void;
};

/** Fixed-view state of a viewer; the Compare tab shares one between both arms. */
export function useViewState(): ViewState {
  const [view, setView] = useState<ViewName>("front");
  const [free, setFreeState] = useState(false);
  const [request, setRequest] = useState(0);
  return useMemo(
    () => ({
      view,
      free,
      request,
      select: (name: ViewName) => {
        setView(name);
        setFreeState(false);
        setRequest((n) => n + 1);
      },
      setFree: () => setFreeState(true),
    }),
    [view, free, request],
  );
}
