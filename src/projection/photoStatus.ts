// Why a calibration photo cannot be shown yet, in words for the placeholder frame on the Projection tab.

/** The asset listing as far as the photo editor cares. */
export type ListingState = "loading" | "unset" | "error" | "ok";

export type PhotoStatus =
  | { kind: "ready" }
  /** Waiting for the listing or the image; the frame says so and the photo fields stay disabled. */
  | { kind: "loading"; title: string }
  /** Cannot be shown until Jan changes something; `detail` says what. */
  | { kind: "blocked"; title: string; detail: string };

export function photoStatus(args: {
  file: string;
  listing: ListingState;
  /** The photo's manifest entry; null when the manifest has none. */
  info: { exists: boolean } | null;
  image: { status: "loading" | "ready" | "error"; message?: string } | undefined;
}): PhotoStatus {
  const { file, listing, info, image } = args;
  const name = file.split("/").pop() ?? file;
  if (listing === "loading") return { kind: "loading", title: "Reading the data folder…" };
  if (listing === "unset")
    return {
      kind: "blocked",
      title: "No data folder",
      detail:
        "The photos live in TATTOO_DATA_DIR, which is not set. The Data folder tab shows how to set it.",
    };
  if (listing === "error")
    return {
      kind: "blocked",
      title: "The data folder cannot be read",
      detail: "Check TATTOO_DATA_DIR in the Data folder tab.",
    };
  if (!info)
    return {
      kind: "blocked",
      title: `${name} is not in manifest.yaml`,
      detail: `Add ${file} to the data folder and run npm run assets:scan.`,
    };
  if (!info.exists)
    return {
      kind: "blocked",
      title: `${name} is missing`,
      detail: `manifest.yaml lists ${file}, but the file is not in the data folder.`,
    };
  if (image?.status === "error")
    return { kind: "blocked", title: `${name} cannot be loaded`, detail: image.message ?? "Unknown error." };
  if (image?.status !== "ready") return { kind: "loading", title: `Loading ${name}…` };
  return { kind: "ready" };
}
