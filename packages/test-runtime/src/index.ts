import { FakeToolAgentEngine } from "@vraxis/agent-v/testing";
import {
  eventTimestamp,
  localExecutionScope,
  type CodingRuntimeEngine,
  type CodingRuntimeRequest,
  type CodingRuntimeResult,
  type EngineDescriptor,
  type EventSink,
  type ExecutionScope,
  type RuntimeReadiness,
} from "@vraxis/agent-v";

export interface DeterministicRun {
  scope: ExecutionScope;
  runtime: FakeToolAgentEngine;
  messages: readonly string[];
}

export function createDeterministicRun(projectId: string): DeterministicRun {
  return {
    scope: localExecutionScope(projectId, "local-user"),
    runtime: new FakeToolAgentEngine(),
    messages: [
      "I inspected the project boundary and found the relevant files.",
      "No consequential action ran without an approval decision.",
    ],
  };
}

export class DeterministicCodingRuntimeEngine implements CodingRuntimeEngine {
  readonly requests: CodingRuntimeRequest<unknown>[] = [];
  readonly descriptor: EngineDescriptor = {
    id: "deterministic-local-cli",
    name: "Deterministic local CLI",
    kind: "coding-runtime",
    capabilities: ["structured-output", "local-workspace", "read-only-workspace"],
  };

  constructor(
    private readonly response: unknown = {
      answer: "The entry point is `src/index.ts`.",
      evidence: ["src/index.ts"],
    },
  ) {}

  async inspect(runtimeId: string): Promise<RuntimeReadiness> {
    return {
      runtimeId,
      availability: "installed",
      verification: "ready",
      version: "test-1.0.0",
      detail: "The deterministic runtime is ready.",
    };
  }

  async probe(runtimeId: string): Promise<RuntimeReadiness> {
    return this.inspect(runtimeId);
  }

  async run<T>(request: CodingRuntimeRequest<T>, sink?: EventSink): Promise<CodingRuntimeResult<T>> {
    this.requests.push(request as CodingRuntimeRequest<unknown>);
    const runId = request.runId ?? crypto.randomUUID();
    const base = { runId, scope: request.scope };
    const provenance = {
      engineId: this.descriptor.id,
      adapterStrategy: "deterministic-test",
      runtime: request.runtimeId,
      ...(request.runtimeModel ? { model: request.runtimeModel } : {}),
      runtimeVersion: "test-1.0.0",
    };
    await sink?.emit({ ...base, timestamp: eventTimestamp(), type: "run.started", provenance });
    await sink?.emit({ ...base, timestamp: eventTimestamp(), type: "model.started", step: 1 });
    const output = request.output.parse(this.response);
    await sink?.emit({ ...base, timestamp: eventTimestamp(), type: "model.completed", step: 1, durationMs: 1 });
    await sink?.emit({ ...base, timestamp: eventTimestamp(), type: "run.completed", durationMs: 1 });
    return {
      runId,
      output,
      provenance,
      durationMs: 1,
      runtimeId: request.runtimeId,
      activityCount: 1,
      attempts: 1,
    };
  }
}

export class InterruptibleCodingRuntimeEngine extends DeterministicCodingRuntimeEngine {
  override async run<T>(request: CodingRuntimeRequest<T>, sink?: EventSink): Promise<CodingRuntimeResult<T>> {
    const runId = request.runId ?? crypto.randomUUID();
    await sink?.emit({
      runId,
      scope: request.scope,
      timestamp: eventTimestamp(),
      type: "run.started",
      provenance: {
        engineId: this.descriptor.id,
        adapterStrategy: "deterministic-test",
        runtime: request.runtimeId,
        runtimeVersion: "test-1.0.0",
      },
    });
    await sink?.emit({ runId, scope: request.scope, timestamp: eventTimestamp(), type: "model.started", step: 1 });
    await new Promise<void>((_resolve, reject) => {
      if (request.abortSignal?.aborted) {
        reject(new DOMException("The task was stopped.", "AbortError"));
        return;
      }
      request.abortSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("The task was stopped.", "AbortError")),
        { once: true },
      );
    });
    throw new Error("The interruptible runtime should only finish when stopped.");
  }
}
