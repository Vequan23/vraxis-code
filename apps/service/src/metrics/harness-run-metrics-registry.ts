import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HarnessMetricsSummaryV1, HarnessRunMetricsV1 } from "@vraxis/code-contracts";
import { aggregateHarnessMetrics } from "./harness-run-metrics-aggregation.js";

interface HarnessMetricsData {
  schemaVersion: 1;
  runs: HarnessRunMetricsV1[];
}

const emptyData: HarnessMetricsData = { schemaVersion: 1, runs: [] };
const maxRuns = 2_000;
const retentionDays = 90;

function savedRun(value: unknown): HarnessRunMetricsV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<HarnessRunMetricsV1>;
  if (record.kind !== "vraxis.harness-run-metrics" || record.version !== 1) return undefined;
  if (typeof record.id !== "string" || typeof record.sessionId !== "string" || typeof record.projectId !== "string") return undefined;
  if (typeof record.runId !== "string" || typeof record.runtimeId !== "string" || typeof record.mode !== "string") return undefined;
  if (typeof record.startedAt !== "string" || typeof record.completedAt !== "string") return undefined;
  if (typeof record.durationMs !== "number" || typeof record.outcome !== "string") return undefined;
  if (!Array.isArray(record.tools) || !record.approvals || typeof record.compactions !== "number") return undefined;
  return record as HarnessRunMetricsV1;
}

function pruneRuns(runs: HarnessRunMetricsV1[]): HarnessRunMetricsV1[] {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const retained = runs.filter((run) => {
    const completedAt = Date.parse(run.completedAt);
    return !Number.isNaN(completedAt) && completedAt >= cutoff;
  });
  return retained.slice(-maxRuns);
}

export class HarnessRunMetricsRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "harness-run-metrics.json");
  }

  async list(): Promise<HarnessRunMetricsV1[]> {
    const data = await this.read();
    return data.runs;
  }

  async record(metrics: HarnessRunMetricsV1): Promise<void> {
    await this.mutate((data) => {
      data.runs.push(metrics);
      data.runs = pruneRuns(data.runs);
    });
  }

  async clear(): Promise<void> {
    await this.write(emptyData);
  }

  async summary(enabled: boolean, windowDays?: number): Promise<HarnessMetricsSummaryV1> {
    const data = await this.read();
    return aggregateHarnessMetrics(data.runs, {
      enabled,
      ...(windowDays !== undefined ? { windowDays } : {}),
    });
  }

  private async read(): Promise<HarnessMetricsData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<HarnessMetricsData>;
      if (parsed.schemaVersion !== 1) throw new Error("Unsupported harness metrics registry.");
      const runs = (parsed.runs ?? []).map(savedRun).filter((item): item is HarnessRunMetricsV1 => Boolean(item));
      return { schemaVersion: 1, runs: pruneRuns(runs) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private mutate(mutator: (data: HarnessMetricsData) => void): Promise<void> {
    this.mutations = this.mutations.then(async () => {
      const data = await this.read();
      mutator(data);
      await this.write(data);
    });
    return this.mutations;
  }

  private async write(data: HarnessMetricsData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
