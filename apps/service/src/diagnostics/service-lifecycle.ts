import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StartupRecoverySummary } from "@vraxis/code-contracts";

interface LifecycleRecord {
  schemaVersion: 1;
  active: boolean;
  startedAt: string;
  shutdownAt?: string;
}

export class ServiceLifecycleMarker {
  readonly file: string;

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "service-lifecycle.json");
  }

  async begin(): Promise<StartupRecoverySummary> {
    const previous = await this.read();
    const startedAt = new Date().toISOString();
    await this.write({ schemaVersion: 1, active: true, startedAt });
    return {
      previousUnexpectedExit: Boolean(previous?.active),
      ...(previous?.active ? { previousStartedAt: previous.startedAt } : {}),
      checkedAt: startedAt,
    };
  }

  async finish(): Promise<void> {
    const current = await this.read();
    if (!current?.active) return;
    await this.write({ ...current, active: false, shutdownAt: new Date().toISOString() });
  }

  private async read(): Promise<LifecycleRecord | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<LifecycleRecord>;
      if (parsed.schemaVersion !== 1 || typeof parsed.active !== "boolean" || typeof parsed.startedAt !== "string") return undefined;
      return parsed as LifecycleRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return undefined;
    }
  }

  private async write(record: LifecycleRecord): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
