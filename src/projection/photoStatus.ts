// Why a calibration photo cannot be shown yet, in words for the placeholder frame on the Projection tab.

/** The asset listing as far as the photo editor cares. */
export type ListingState = "loading" | "unset" | "error" | "ok";

export type PhotoStatus =
  | { kind: "ready" }
  /** Waiting for the listing or the image; the frame says so and the photo fields stay disabled. */
  | { kind: "loading"; title: string }
  /** Cannot be shown until the user changes something; `detail` says what. */
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
  if (listing === "loading") return { kind: "loading", title: "Reading the project folder…" };
  if (listing === "unset")
    return {
      kind: "blocked",
      title: "No project folder",
      detail: "The photos live in the project folder. Open or create a project in Settings → Project.",
    };
  if (listing === "error")
    return {
      kind: "blocked",
      title: "The project folder cannot be read",
      detail: "Check the project folder in Settings → Project.",
    };
  if (!info)
    return {
      kind: "blocked",
      title: `${name} is not in the image catalogue`,
      detail: `Copy ${file} into the project folder, then press Look for new images in the Assets tab.`,
    };
  if (!info.exists)
    return {
      kind: "blocked",
      title: `${name} is missing`,
      detail: `The image catalogue lists ${file}, but the file is not in the project folder.`,
    };
  if (image?.status === "error")
    return { kind: "blocked", title: `${name} cannot be loaded`, detail: image.message ?? "Unknown error." };
  if (image?.status !== "ready") return { kind: "loading", title: `Loading ${name}…` };
  return { kind: "ready" };
}
