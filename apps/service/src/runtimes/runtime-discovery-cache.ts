import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuntimeSummary } from "@vraxis/code-contracts";
import { discoverRuntimes, type RuntimeDiscoveryOptions } from "./runtime-discovery.js";

interface RuntimeDiscoveryData {
  schemaVersion: 1;
  refreshedAt: string;
  runtimes: RuntimeSummary[];
}

const emptyData: RuntimeDiscoveryData = { schemaVersion: 1, refreshedAt: "", runtimes: [] };

export const bootstrapDiscoveryTimeoutMs = 2_000;
export const backgroundDiscoveryTimeoutMs = 8_000;
const refreshTtlMs = 5 * 60_000;

export class RuntimeDiscoveryCache {
  readonly file: string;
  private memory: RuntimeSummary[] = [];
  private refreshedAt: string | null = null;
  private mutations: Promise<void> = Promise.resolve();
  private refreshPromise: Promise<RuntimeSummary[]> | null = null;

  constructor(
    dataDirectory: string,
    private readonly discover: (options?: RuntimeDiscoveryOptions) => Promise<RuntimeSummary[]> = discoverRuntimes,
  ) {
    this.file = join(dataDirectory, "runtime-discovery.json");
  }

  async start(): Promise<void> {
    await this.loadFromDisk();
  }

  async get(): Promise<RuntimeSummary[]> {
    if (this.memory.length) {
      this.refreshInBackground();
      return [...this.memory];
    }
    return this.refresh({ timeoutMs: bootstrapDiscoveryTimeoutMs });
  }

  async refresh(options: { timeoutMs?: number; force?: boolean } = {}): Promise<RuntimeSummary[]> {
    if (!options.force && this.refreshPromise) return this.refreshPromise;
    const timeoutMs = options.timeoutMs ?? backgroundDiscoveryTimeoutMs;
    const operation = this.runRefresh(timeoutMs);
    this.refreshPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = null;
    }
  }

  refreshInBackground(): void {
    if (!this.shouldRefresh()) return;
    void this.refresh({ timeoutMs: backgroundDiscoveryTimeoutMs }).catch(() => undefined);
  }

  get refreshedAtIso(): string | null {
    return this.refreshedAt;
  }

  private shouldRefresh(): boolean {
    if (!this.refreshedAt || !this.memory.length) return true;
    return Date.now() - Date.parse(this.refreshedAt) > refreshTtlMs;
  }

  private async runRefresh(timeoutMs: number): Promise<RuntimeSummary[]> {
    const runtimes = await this.discover({ timeoutMs });
    await this.persist(runtimes);
    return [...this.memory];
  }

  private async loadFromDisk(): Promise<void> {
    await this.mutations;
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as RuntimeDiscoveryData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.runtimes)) throw new Error("Unsupported runtime discovery cache.");
      this.memory = parsed.runtimes;
      this.refreshedAt = parsed.refreshedAt || null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async persist(runtimes: RuntimeSummary[]): Promise<void> {
    await this.mutate((data) => {
      data.refreshedAt = new Date().toISOString();
      data.runtimes = runtimes;
      this.memory = runtimes;
      this.refreshedAt = data.refreshedAt;
    });
  }

  private async mutate<T>(operation: (data: RuntimeDiscoveryData) => T | Promise<T>): Promise<T> {
    let output!: T;
    const mutation = this.mutations.then(async () => {
      const data = await this.readSnapshot();
      output = await operation(data);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.mutations = mutation.then(() => undefined, () => undefined);
    await mutation;
    return output;
  }

  private async readSnapshot(): Promise<RuntimeDiscoveryData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as RuntimeDiscoveryData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.runtimes)) throw new Error("Unsupported runtime discovery cache.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }
}
