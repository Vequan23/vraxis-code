import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CredentialStore } from "@vraxis/agent-v";
import type { BrowserContextOptions } from "playwright";

export type BrowserStorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

interface EncryptedBrowserStorageState {
  schemaVersion: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authenticationTag: string;
  ciphertext: string;
}

const keyReference = "keychain://vraxis-code/browser-state/encryption-key-v1";
const additionalDataVersion = "vraxis.browser-state@1";

function assertSessionId(sessionId: string): void {
  if (!/^[a-z0-9_-]{1,128}$/i.test(sessionId)) throw new TypeError("Browser session identifier is invalid.");
}

function isStorageState(value: unknown): value is BrowserStorageState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BrowserStorageState>;
  return Array.isArray(state.cookies) && Array.isArray(state.origins);
}

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new Error("The browser state encryption key is invalid.");
  return key;
}

/** Encrypts browser authentication state with a key owned by the operating-system credential store. */
export class BrowserStateVault {
  readonly directory: string;
  private keyPromise: Promise<Buffer> | undefined;

  constructor(dataDirectory: string, private readonly credentials: CredentialStore) {
    this.directory = join(dataDirectory, "browser-state");
  }

  path(sessionId: string): string {
    assertSessionId(sessionId);
    return join(this.directory, `${sessionId}.json`);
  }

  async load(sessionId: string): Promise<BrowserStorageState | undefined> {
    assertSessionId(sessionId);
    let envelope: EncryptedBrowserStorageState;
    try {
      envelope = JSON.parse(await readFile(this.path(sessionId), "utf8")) as EncryptedBrowserStorageState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("The encrypted browser state could not be read.", { cause: error });
    }
    if (
      envelope.schemaVersion !== 1
      || envelope.algorithm !== "aes-256-gcm"
      || typeof envelope.iv !== "string"
      || typeof envelope.authenticationTag !== "string"
      || typeof envelope.ciphertext !== "string"
    ) throw new Error("The encrypted browser state format is unsupported.");

    const storedKey = await this.credentials.resolve(keyReference);
    if (!storedKey) throw new Error("The browser state encryption key is unavailable. Reset this isolated browser session to continue.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", decodeKey(storedKey), Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(this.additionalData(sessionId));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
      const state = JSON.parse(plaintext.toString("utf8")) as unknown;
      if (!isStorageState(state)) throw new Error("The decrypted browser state is invalid.");
      return state;
    } catch (error) {
      throw new Error("The encrypted browser state failed integrity verification. Reset this isolated browser session to continue.", { cause: error });
    }
  }

  async save(sessionId: string, state: BrowserStorageState): Promise<void> {
    assertSessionId(sessionId);
    if (!isStorageState(state)) throw new TypeError("Browser storage state is invalid.");
    const key = await this.encryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(this.additionalData(sessionId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(state), "utf8"),
      cipher.final(),
    ]);
    const envelope: EncryptedBrowserStorageState = {
      schemaVersion: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.directory, 0o700);
    const temporary = `${this.path(sessionId)}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path(sessionId));
    if (process.platform !== "win32") await chmod(this.path(sessionId), 0o600);
  }

  async has(sessionId: string): Promise<boolean> {
    try { return (await stat(this.path(sessionId))).isFile(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private additionalData(sessionId: string): Buffer {
    return Buffer.from(`${additionalDataVersion}\0${sessionId}`, "utf8");
  }

  private async encryptionKey(): Promise<Buffer> {
    if (this.keyPromise) return this.keyPromise;
    this.keyPromise = this.loadOrCreateKey().catch((error: unknown) => {
      this.keyPromise = undefined;
      throw error;
    });
    return this.keyPromise;
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    const existing = await this.credentials.resolve(keyReference);
    if (existing) return decodeKey(existing);
    const key = randomBytes(32);
    await this.credentials.set(keyReference, key.toString("base64"));
    return key;
  }
}
