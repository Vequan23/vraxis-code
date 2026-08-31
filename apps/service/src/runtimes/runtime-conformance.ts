import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CodingRuntimeEngine, RuntimeReadiness } from "@vraxis/agent-v";
import { builtInRuntimes } from "@vraxis/agent-v/local-cli";
import type { RuntimeConformanceSummary, RuntimeSummary } from "@vraxis/code-contracts";

interface RuntimeConformanceData {
  schemaVersion: 1;
  results: Record<string, RuntimeConformanceSummary>;
}

const emptyData: RuntimeConformanceData = { schemaVersion: 1, results: {} };

function staticChecks(runtime: RuntimeSummary): RuntimeConformanceSummary["checks"] {
  const definition = builtInRuntimes.find((item) => item.id === runtime.id);
  const adapterReady = Boolean(definition && runtime.version);
  const transportReady = Boolean(definition
    && (definition.configureMcp || definition.hostToolTransport === "acp")
    && definition.capabilities.includes("mcp-tools"));
  const isolationReady = Boolean(transportReady && runtime.version
    && (!definition?.supportsHostToolIsolation || definition.supportsHostToolIsolation(runtime.version)));
  return [
    {
      id: "adapter-contract",
      label: "Adapter contract",
      state: adapterReady ? "passed" : "failed",
      detail: adapterReady
        ? `${definition!.strategyId} is registered for ${runtime.version}.`
        : "The installed version does not map to a registered Vraxis adapter contract.",
    },
    {
      id: "host-tool-isolation",
      label: "Host-tool isolation",
      state: isolationReady ? "passed" : "failed",
      detail: isolationReady
        ? "Ephemeral Vraxis tools are supported with native mutation paths constrained by this adapter."
        : "This version has not passed the Vraxis host-tool isolation policy.",
    },
  ];
}

function unverified(runtime: RuntimeSummary): RuntimeConformanceSummary {
  const checks = staticChecks(runtime);
  const staticReady = checks.every((check) => check.state === "passed");
  return {
    state: staticReady ? "unverified" : "limited",
    ...(runtime.version ? { runtimeVersion: runtime.version } : {}),
    detail: staticReady
      ? "The adapter contract is available. Run one bounded live probe to verify authentication and structured output."
      : "This harness is installed, but its current adapter cannot safely expose the complete Vraxis tool surface.",
    checks: [
      ...checks,
      { id: "live-output", label: "Live model response", state: "not-checked", detail: "No provider request has been made for this version." },
    ],
  };
}

function probed(runtime: RuntimeSummary, readiness: RuntimeReadiness): RuntimeConformanceSummary {
  const checks = staticChecks(runtime);
  const liveReady = readiness.verification === "ready";
  checks.push({
    id: "live-output",
    label: "Live model response",
    state: liveReady ? "passed" : "failed",
    detail: liveReady ? readiness.detail : readiness.failure?.message ?? readiness.detail,
  });
  const staticReady = checks.slice(0, 2).every((check) => check.state === "passed");
  return {
    state: !liveReady ? "failed" : staticReady ? "ready" : "limited",
    ...(runtime.version ? { runtimeVersion: runtime.version } : {}),
    ...(readiness.checkedAt ? { checkedAt: readiness.checkedAt } : {}),
    ...(readiness.durationMs === undefined ? {} : { durationMs: readiness.durationMs }),
    detail: !liveReady
      ? "The bounded live request failed. Review authentication or model access, then retry."
      : staticReady
        ? "This runtime passed its registered adapter checks and the bounded live output probe."
        : "The model responded, but this runtime version cannot safely expose every Vraxis capability.",
    checks,
  };
}

export class RuntimeConformanceRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string, private readonly engine: Pick<CodingRuntimeEngine, "probe">) {
    this.file = join(dataDirectory, "runtime-conformance.json");
  }

  async decorate(runtimes: RuntimeSummary[]): Promise<RuntimeSummary[]> {
    const data = await this.read();
    return runtimes.map((runtime) => {
      if (runtime.kind !== "local-cli" || runtime.availability !== "installed") return runtime;
      const stored = data.results[runtime.id];
      if (!stored) return { ...runtime, conformance: unverified(runtime) };
      if (stored.runtimeVersion !== runtime.version) {
        return {
          ...runtime,
          conformance: {
            ...unverified(runtime),
            state: "stale",
            ...(stored.checkedAt ? { checkedAt: stored.checkedAt } : {}),
            detail: `The previous probe covered ${stored.runtimeVersion ?? "another version"}. Verify ${runtime.version ?? "the current version"} before relying on it.`,
          },
        };
      }
      return { ...runtime, conformance: stored };
    });
  }

  async probe(runtime: RuntimeSummary, runtimeModel?: string): Promise<RuntimeConformanceSummary> {
    if (runtime.kind !== "local-cli" || runtime.availability !== "installed") {
      throw new TypeError("Install the coding harness before running its live conformance probe.");
    }
    const readiness = await this.engine.probe(runtime.id, runtimeModel);
    const result = probed(runtime, readiness);
    await this.mutate((data) => { data.results[runtime.id] = result; });
    return result;
  }

  private async read(): Promise<RuntimeConformanceData> {
    await this.mutations;
    return this.readSnapshot();
  }

  private async readSnapshot(): Promise<RuntimeConformanceData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as RuntimeConformanceData;
      if (parsed.schemaVersion !== 1 || !parsed.results || typeof parsed.results !== "object") throw new Error("Unsupported runtime conformance registry.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private async mutate<T>(operation: (data: RuntimeConformanceData) => T | Promise<T>): Promise<T> {
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
