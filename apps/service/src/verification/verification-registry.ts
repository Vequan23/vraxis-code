import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  TerminalRunSummary,
  VerificationBrowserAssertionDefinition,
  VerificationCheckDefinition,
  VerificationHandoffSummary,
  VerificationRunSummary,
  VerificationServiceDefinition,
  VerificationVisualDefinition,
} from "@vraxis/code-contracts";

interface VerificationData {
  schemaVersion: 1;
  runs: VerificationRunSummary[];
  handoffs?: VerificationHandoffSummary[];
}

const emptyData: VerificationData = { schemaVersion: 1, runs: [], handoffs: [] };

function checkDefinition(check: VerificationCheckDefinition): VerificationCheckDefinition {
  return {
    id: check.id,
    title: check.title,
    category: check.category,
    command: check.command,
    args: [...check.args],
    cwd: check.cwd,
    required: check.required,
    timeoutMs: check.timeoutMs,
    source: check.source,
  };
}

function serviceDefinition(service: VerificationServiceDefinition): VerificationServiceDefinition {
  return {
    id: service.id,
    title: service.title,
    command: service.command,
    args: [...service.args],
    cwd: service.cwd,
    health: { ...service.health },
    source: service.source,
  };
}

function browserAssertionDefinition(assertion: VerificationBrowserAssertionDefinition): VerificationBrowserAssertionDefinition {
  return {
    id: assertion.id,
    title: assertion.title,
    kind: assertion.kind,
    match: assertion.match,
    value: assertion.value,
    caseSensitive: assertion.caseSensitive,
    source: assertion.source,
  };
}

function visualDefinition(visual: VerificationVisualDefinition): VerificationVisualDefinition {
  return { baselinePath: visual.baselinePath, maxDiffRatio: visual.maxDiffRatio, source: visual.source };
}

function recipeFingerprint(
  services: VerificationServiceDefinition[],
  checks: VerificationCheckDefinition[],
  browserAssertions: VerificationBrowserAssertionDefinition[],
  visual: VerificationVisualDefinition | undefined,
  browserRecommended: boolean,
  browserTarget?: string,
): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: 2,
    services: services.map(serviceDefinition),
    checks: checks.map(checkDefinition),
    browserAssertions: browserAssertions.map(browserAssertionDefinition),
    visual: visual ? visualDefinition(visual) : undefined,
    browserRecommended,
    browserTarget,
  })).digest("hex");
}

export class VerificationRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "verification-runs.json");
  }

  async list(sessionId?: string): Promise<VerificationRunSummary[]> {
    const data = await this.read();
    return data.runs.filter((item) => !sessionId || item.sessionId === sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(id: string): Promise<VerificationRunSummary> {
    const data = await this.read();
    return this.find(data, id);
  }

  async listHandoffs(sessionId?: string): Promise<VerificationHandoffSummary[]> {
    const data = await this.read();
    return (data.handoffs ?? []).filter((item) => !sessionId || item.sessionId === sessionId)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }

  async requestHandoff(input: {
    sessionId: string;
    runtimeId: string;
    modelId?: string;
    note?: string;
  }): Promise<VerificationHandoffSummary> {
    const note = input.note?.trim();
    if (note && note.length > 500) throw new TypeError("Verification handoff notes are limited to 500 characters.");
    return this.mutate((data) => {
      data.handoffs ??= [];
      const existing = data.handoffs.find((item) => item.sessionId === input.sessionId && item.state === "requested");
      if (existing) {
        if (note) existing.note = note;
        return existing;
      }
      const handoff: VerificationHandoffSummary = {
        id: randomUUID(),
        sessionId: input.sessionId,
        state: "requested",
        requestedAt: new Date().toISOString(),
        requestedBy: {
          actor: "agent",
          runtimeId: input.runtimeId,
          ...(input.modelId ? { modelId: input.modelId } : {}),
        },
        ...(note ? { note } : {}),
      };
      data.handoffs.unshift(handoff);
      return handoff;
    });
  }

  async resolveHandoff(
    id: string,
    decision: "accepted" | "dismissed",
    verificationRunId?: string,
  ): Promise<VerificationHandoffSummary> {
    return this.mutate((data) => {
      const handoff = (data.handoffs ?? []).find((item) => item.id === id);
      if (!handoff) throw new TypeError("Verification handoff was not found.");
      if (handoff.state !== "requested") throw new TypeError("Verification handoff has already been resolved.");
      if (decision === "accepted" && !verificationRunId) throw new TypeError("Accepted verification requires a retained run.");
      handoff.state = decision;
      handoff.resolvedAt = new Date().toISOString();
      if (verificationRunId) handoff.verificationRunId = verificationRunId;
      return handoff;
    });
  }

  async create(input: {
    sessionId: string;
    projectId: string;
    projectName: string;
    changedPaths: string[];
    services?: VerificationServiceDefinition[];
    checks: VerificationCheckDefinition[];
    browserAssertions?: VerificationBrowserAssertionDefinition[];
    visual?: VerificationVisualDefinition;
    browserRecommended: boolean;
    browserTarget?: string;
  }): Promise<VerificationRunSummary> {
    if (!(input.services ?? []).length && !input.checks.length && !input.browserRecommended) {
      throw new TypeError("No verification services, commands, or browser proof were declared for this project.");
    }
    return this.mutate((data) => {
      const run = this.newRun({ ...input, services: input.services ?? [], browserAssertions: input.browserAssertions ?? [] });
      data.runs.unshift(run);
      return run;
    });
  }

  async rerun(sourceId: string, changedPaths: string[]): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const source = this.find(data, sourceId);
      if (source.state === "ready" || source.state === "running" || source.state === "needs-browser") {
        throw new TypeError("Finish the current verification before rerunning its recipe.");
      }
      const active = data.runs.find((item) => item.sessionId === source.sessionId
        && item.id !== source.id
        && (item.state === "ready" || item.state === "running" || item.state === "needs-browser"));
      if (active) throw new TypeError("This task already has an active verification run.");
      const run = this.newRun({
        sessionId: source.sessionId,
        projectId: source.projectId,
        projectName: source.projectName,
        changedPaths,
        services: source.services.map(serviceDefinition),
        checks: source.checks.map(checkDefinition),
        browserAssertions: source.browserAssertions.map(browserAssertionDefinition),
        ...(source.visual ? { visual: visualDefinition(source.visual) } : {}),
        browserRecommended: source.browserRecommended,
        ...(source.browserTarget ? { browserTarget: source.browserTarget } : {}),
      }, source.id);
      data.runs.unshift(run);
      return run;
    });
  }

  async awaitServiceApproval(id: string, serviceId: string, approvalId: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const service = this.service(run, serviceId);
      if (service.state !== "pending") throw new TypeError("This verification service is not waiting to be scheduled.");
      service.state = "awaiting-approval";
      service.approvalId = approvalId;
      run.state = "running";
      run.startedAt ??= new Date().toISOString();
      return run;
    });
  }

  async startService(id: string, serviceId: string, terminalRunId: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const service = this.service(run, serviceId);
      if (service.state !== "awaiting-approval") throw new TypeError("This verification service is not approved to start.");
      service.state = "starting";
      service.terminalRunId = terminalRunId;
      service.startedAt = new Date().toISOString();
      return run;
    });
  }

  async recordServiceHealth(id: string, serviceId: string, status?: number): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const service = this.service(run, serviceId);
      if (service.state !== "starting") throw new TypeError("This verification service is not starting.");
      service.healthAttempts += 1;
      if (status !== undefined) service.lastHealthStatus = status;
      return run;
    });
  }

  async markServiceHealthy(id: string, serviceId: string, status: number): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const service = this.service(run, serviceId);
      if (service.state !== "starting") throw new TypeError("This verification service is not starting.");
      service.state = "healthy";
      service.healthAttempts += 1;
      service.lastHealthStatus = status;
      service.healthyAt = new Date().toISOString();
      return run;
    });
  }

  async failService(id: string, serviceId: string, failure: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const service = this.service(run, serviceId);
      if (service.state === "stopped") return run;
      service.state = "failed";
      service.failure = failure.slice(0, 500);
      service.stoppedAt = new Date().toISOString();
      run.state = "failed";
      run.completedAt = service.stoppedAt;
      return run;
    });
  }

  async markServicesStopped(id: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const stoppedAt = new Date().toISOString();
      for (const service of run.services) {
        if (service.state === "starting" || service.state === "healthy") {
          service.state = "stopped";
          service.stoppedAt = stoppedAt;
        }
      }
      return run;
    });
  }

  async settleIfReady(id: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const servicesReady = run.services.every((item) => item.state === "healthy" || item.state === "stopped");
      const checksReady = run.checks.every((item) => item.state === "passed" || item.state === "skipped");
      if (!servicesReady || !checksReady || run.state === "failed" || run.state === "interrupted") return run;
      run.state = run.browserRecommended ? "needs-browser" : "passed";
      if (!run.browserRecommended) run.completedAt = new Date().toISOString();
      return run;
    });
  }

  async interrupt(id: string, reason = "Verification was stopped by the user."): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      if (!["ready", "running", "needs-browser"].includes(run.state)) return run;
      run.state = "interrupted";
      run.completedAt = new Date().toISOString();
      for (const check of run.checks) {
        if (check.state === "running" || check.state === "awaiting-approval") {
          check.state = "failed";
          check.completedAt = run.completedAt;
          check.failure = reason;
        }
      }
      return run;
    });
  }

  async awaitApproval(id: string, checkId: string, approvalId: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const check = this.check(run, checkId);
      if (check.state !== "pending") throw new TypeError("This verification check is not waiting to be scheduled.");
      check.state = "awaiting-approval";
      check.approvalId = approvalId;
      run.state = "running";
      run.startedAt ??= new Date().toISOString();
      return run;
    });
  }

  async startCheck(id: string, checkId: string, terminalRunId: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const check = this.check(run, checkId);
      if (check.state !== "awaiting-approval") throw new TypeError("This verification check is not approved to start.");
      check.state = "running";
      check.terminalRunId = terminalRunId;
      check.startedAt = new Date().toISOString();
      run.state = "running";
      return run;
    });
  }

  async finishCheck(id: string, checkId: string, terminal: TerminalRunSummary | undefined, failure?: string): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      const check = this.check(run, checkId);
      if (check.state !== "running" && check.state !== "awaiting-approval") throw new TypeError("This verification check is not active.");
      const passed = terminal?.status === "success" && !failure;
      check.state = passed ? "passed" : "failed";
      check.completedAt = new Date().toISOString();
      if (terminal) check.terminalRunId = terminal.id;
      if (!passed) check.failure = failure ?? terminal?.output.trim().slice(-500) ?? "Verification did not complete.";
      if (!passed) {
        run.state = "failed";
        run.completedAt = check.completedAt;
      } else if (run.checks.every((item) => item.state === "passed" || item.state === "skipped")) {
        run.state = run.browserRecommended ? "needs-browser" : "passed";
        if (!run.browserRecommended) run.completedAt = check.completedAt;
      }
      return run;
    });
  }

  async recordBrowser(
    id: string,
    actionId: string,
    consoleErrors: number,
    networkErrors: number,
    assertionResults: Array<{ id: string; passed: boolean; actual: string; failure?: string }> = [],
    visualResult?: {
      passed: boolean;
      width?: number;
      height?: number;
      diffPixels?: number;
      totalPixels?: number;
      diffRatio?: number;
      diffAvailable?: boolean;
      failure?: string;
    },
  ): Promise<VerificationRunSummary> {
    return this.mutate((data) => {
      const run = this.find(data, id);
      if (run.state !== "needs-browser") throw new TypeError("Command checks must pass before browser proof can be attached.");
      run.browserActionId = actionId;
      for (const assertion of run.browserAssertions) {
        const result = assertionResults.find((item) => item.id === assertion.id);
        assertion.state = result?.passed ? "passed" : "failed";
        assertion.actual = result?.actual.slice(0, 1_000) ?? "No result was recorded.";
        if (!result?.passed) assertion.failure = result?.failure ?? "The assertion was not evaluated.";
      }
      const assertionFailures = run.browserAssertions.filter((item) => item.state === "failed").length;
      if (run.visual) {
        run.visual.state = visualResult?.passed ? "passed" : "failed";
        if (visualResult) Object.assign(run.visual, visualResult);
        if (!visualResult?.passed) run.visual.failure = visualResult?.failure ?? "Visual comparison was not evaluated.";
      }
      const visualFailures = run.visual?.state === "failed" ? 1 : 0;
      const passed = consoleErrors === 0 && networkErrors === 0 && assertionFailures === 0 && visualFailures === 0;
      run.browserState = passed ? "passed" : "failed";
      run.state = passed ? "passed" : "failed";
      run.completedAt = new Date().toISOString();
      if (!passed) run.browserFailure = `${consoleErrors} console ${consoleErrors === 1 ? "error" : "errors"}, ${networkErrors} failed or blocked network ${networkErrors === 1 ? "request" : "requests"}, ${assertionFailures} failed browser ${assertionFailures === 1 ? "assertion" : "assertions"}, and ${visualFailures} failed visual ${visualFailures === 1 ? "comparison" : "comparisons"} were captured.`;
      return run;
    });
  }

  async reconcile(): Promise<void> {
    await this.mutate((data) => {
      for (const run of data.runs) {
        if (run.state !== "running") continue;
        run.state = "interrupted";
        run.completedAt = new Date().toISOString();
        const check = run.checks.find((item) => item.state === "running" || item.state === "awaiting-approval");
        if (check) {
          check.state = "failed";
          check.completedAt = run.completedAt;
          check.failure = "Vraxis Code restarted before this check completed. Run verification again.";
        }
        const service = run.services.find((item) => item.state === "starting" || item.state === "awaiting-approval");
        if (service) {
          service.state = "failed";
          service.stoppedAt = run.completedAt;
          service.failure = "Vraxis Code restarted before this service completed health verification. Run verification again.";
        }
        for (const healthy of run.services.filter((item) => item.state === "healthy")) {
          healthy.state = "stopped";
          healthy.stoppedAt = run.completedAt;
        }
      }
    }, false);
  }

  private find(data: VerificationData, id: string): VerificationRunSummary {
    const run = data.runs.find((item) => item.id === id);
    if (!run) throw new TypeError("Verification run was not found.");
    return run;
  }

  private check(run: VerificationRunSummary, id: string) {
    const check = run.checks.find((item) => item.id === id);
    if (!check) throw new TypeError("Verification check was not found.");
    return check;
  }

  private service(run: VerificationRunSummary, id: string) {
    const service = run.services.find((item) => item.id === id);
    if (!service) throw new TypeError("Verification service was not found.");
    return service;
  }

  private newRun(
    input: {
      sessionId: string;
      projectId: string;
      projectName: string;
      changedPaths: string[];
      services: VerificationServiceDefinition[];
      checks: VerificationCheckDefinition[];
      browserAssertions: VerificationBrowserAssertionDefinition[];
      visual?: VerificationVisualDefinition;
      browserRecommended: boolean;
      browserTarget?: string;
    },
    rerunOfId?: string,
  ): VerificationRunSummary {
    return {
      id: randomUUID(),
      sessionId: input.sessionId,
      projectId: input.projectId,
      projectName: input.projectName,
      state: "ready",
      changedPaths: [...new Set(input.changedPaths)].sort(),
      services: input.services.map((service) => ({ ...serviceDefinition(service), state: "pending", healthAttempts: 0 })),
      checks: input.checks.map((check) => ({ ...checkDefinition(check), state: "pending" })),
      browserAssertions: input.browserAssertions.map((assertion) => ({ ...browserAssertionDefinition(assertion), state: "pending" })),
      ...(input.visual ? { visual: { ...visualDefinition(input.visual), state: "pending" as const } } : {}),
      browserRecommended: input.browserRecommended,
      browserState: input.browserRecommended ? "pending" : "not-required",
      ...(input.browserTarget ? { browserTarget: input.browserTarget } : {}),
      recipeFingerprint: recipeFingerprint(input.services, input.checks, input.browserAssertions, input.visual, input.browserRecommended, input.browserTarget),
      ...(rerunOfId ? { rerunOfId } : {}),
      createdAt: new Date().toISOString(),
    };
  }

  private async read(): Promise<VerificationData> {
    await this.mutations;
    return this.readSnapshot();
  }

  private async readSnapshot(): Promise<VerificationData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as VerificationData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.runs)) throw new TypeError("Unsupported verification registry.");
      parsed.handoffs ??= [];
      for (const run of parsed.runs) {
        run.services ??= [];
        run.browserAssertions ??= [];
        run.recipeFingerprint ??= recipeFingerprint(run.services, run.checks, run.browserAssertions, run.visual, run.browserRecommended, run.browserTarget);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private async mutate<T>(change: (data: VerificationData) => T, alwaysWrite = true): Promise<T> {
    let result!: T;
    const mutation = this.mutations.then(async () => {
      const data = await this.readSnapshot();
      const before = alwaysWrite ? "" : JSON.stringify(data);
      result = change(data);
      if (alwaysWrite || JSON.stringify(data) !== before) await this.write(data);
    });
    this.mutations = mutation.catch(() => undefined);
    await mutation;
    return result;
  }

  private async write(data: VerificationData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
