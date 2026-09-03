import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuntimeReadiness } from "@vraxis/agent-v";
import type { RuntimeConformanceSummary, RuntimeSummary } from "@vraxis/code-contracts";

interface ProviderConformanceData {
  schemaVersion: 1;
  results: Record<string, RuntimeConformanceSummary>;
}

const emptyData: ProviderConformanceData = { schemaVersion: 1, results: {} };

function unverified(): RuntimeConformanceSummary {
  return {
    state: "unverified",
    detail: "Run one bounded live test to verify credentials and model access.",
    checks: [
      {
        id: "credential-catalog",
        label: "Model catalog",
        state: "not-checked",
        detail: "No model list request has been made for this connection.",
      },
      {
        id: "live-output",
        label: "Live model response",
        state: "not-checked",
        detail: "No bounded generation request has been made for this connection.",
      },
    ],
  };
}

function probed(readiness: RuntimeReadiness, catalogOk: boolean): RuntimeConformanceSummary {
  const liveReady = readiness.verification === "ready";
  const checks: RuntimeConformanceSummary["checks"] = [
    {
      id: "credential-catalog",
      label: "Model catalog",
      state: catalogOk ? "passed" : "failed",
      detail: catalogOk
        ? "Credentials resolved and the provider returned a usable model list."
        : "The provider did not return a usable model catalog.",
    },
    {
      id: "live-output",
      label: "Live model response",
      state: liveReady ? "passed" : "failed",
      detail: liveReady ? readiness.detail : readiness.failure?.message ?? readiness.detail,
    },
  ];
  return {
    state: !catalogOk || !liveReady ? "failed" : "ready",
    ...(readiness.checkedAt ? { checkedAt: readiness.checkedAt } : {}),
    ...(readiness.durationMs === undefined ? {} : { durationMs: readiness.durationMs }),
    detail: !catalogOk || !liveReady
      ? "The bounded live provider test failed. Review credentials, endpoint URL, or model access, then retry."
      : "This provider passed catalog discovery and a bounded structured output test.",
    checks,
  };
}

export class ProviderConformanceRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "provider-conformance.json");
  }

  async decorate(runtimes: RuntimeSummary[]): Promise<RuntimeSummary[]> {
    const data = await this.read();
    return runtimes.map((runtime) => {
      if (runtime.kind !== "hosted-provider") return runtime;
      return { ...runtime, conformance: data.results[runtime.id] ?? unverified() };
    });
  }

  async recordProbe(
    runtimeId: string,
    readiness: RuntimeReadiness,
    catalogOk: boolean,
  ): Promise<RuntimeConformanceSummary> {
    const result = probed(readiness, catalogOk);
    await this.mutate((data) => { data.results[runtimeId] = result; });
    return result;
  }

  private async read(): Promise<ProviderConformanceData> {
    await this.mutations;
    return this.readSnapshot();
  }

  private async readSnapshot(): Promise<ProviderConformanceData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as ProviderConformanceData;
      if (parsed.schemaVersion !== 1 || !parsed.results || typeof parsed.results !== "object") {
        throw new Error("Unsupported provider conformance registry.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private async mutate<T>(operation: (data: ProviderConformanceData) => T | Promise<T>): Promise<T> {
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
}
