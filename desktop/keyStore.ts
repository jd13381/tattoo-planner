// The OpenAI key of the desktop app (docs/adr/0015-desktop-app.md): encrypted with Electron's
// safeStorage (on macOS the encryption key lives in the Keychain) and written to one file in the
// app's settings folder. Only the main process decrypts it; the page learns whether a key is stored,
// never the key. Framework-free: tests pass a fake safeStorage.
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { KeyStatus } from "../src/desktop/bridge.ts";
import { keyProblem } from "../src/edits/keyCheck.ts";

/** The part of Electron's `safeStorage` this module uses (its asynchronous API). */
export type SafeStorageLike = {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
};

export { keyProblem, MAX_KEY_LENGTH } from "../src/edits/keyCheck.ts";

export class KeyStore {
  private readonly file: string;
  private readonly safe: SafeStorageLike;
  private readonly backend: string;
  /** The decrypted key in memory (main process only); null = none stored or not readable. */
  private key: string | null = null;

  constructor(opts: { file: string; safeStorage: SafeStorageLike; backend: string }) {
    this.file = opts.file;
    this.safe = opts.safeStorage;
    this.backend = opts.backend;
  }

  /**
   * Reads and decrypts the stored key once at start. A file that cannot be decrypted (another
   * Keychain, a damaged file) counts as no key; it stays on disk until a new key replaces it.
   */
  async load(): Promise<void> {
    this.key = null;
    if (!existsSync(this.file) || !(await this.safe.isAsyncEncryptionAvailable())) return;
    try {
      const { result, shouldReEncrypt } = await this.safe.decryptStringAsync(await readFile(this.file));
      this.key = result.trim() || null;
      if (this.key && shouldReEncrypt) await this.write(this.key);
    } catch {
      this.key = null;
    }
  }

  /** The key for the server's settings; synchronous, from memory. */
  get(): string | null {
    return this.key;
  }

  async status(): Promise<KeyStatus> {
    return {
      stored: this.key !== null,
      encryptionAvailable: await this.safe.isAsyncEncryptionAvailable(),
      backend: this.backend,
    };
  }

  /** Encrypts and stores `key`; throws an Error with a readable message (never the key) when it cannot. */
  async set(key: unknown): Promise<KeyStatus> {
    const problem = keyProblem(key);
    if (problem) throw new Error(problem);
    if (!(await this.safe.isAsyncEncryptionAvailable()))
      throw new Error(`The key cannot be stored safely: the ${this.backend} is not available.`);
    const k = (key as string).trim();
    await this.write(k);
    this.key = k;
    return this.status();
  }

  async clear(): Promise<KeyStatus> {
    await rm(this.file, { force: true });
    this.key = null;
    return this.status();
  }

  /** Encrypted, owner-only, replaced atomically. */
  private async write(key: string) {
    const encrypted = await this.safe.encryptStringAsync(key);
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, encrypted, { mode: 0o600 });
    await rename(tmp, this.file);
  }
}
