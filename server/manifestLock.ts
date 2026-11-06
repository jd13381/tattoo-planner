// One lock for every write to a project's manifest.yaml in this process: the scan, kept studio
// images, entry edits, batch actions, undo and imports read the file, change it and write it back,
// so two of them must never interleave (docs/adr/0020-asset-structure.md).
import { rename, writeFile } from "node:fs/promises";

let tail: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every earlier manifest change of this process has finished. */
export function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn);
  tail = run.catch(() => undefined);
  return run;
}

/** Writes text atomically (temporary file, then rename), as every manifest write does. */
export async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}
