import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ApprovalPolicy, ApprovalRequest as AgentVApprovalRequest } from "@vraxis/agent-v";
import type {
  ApprovalCapability,
  ApprovalDuration,
  ApprovalPolicyAuditV1,
  ApprovalRisk,
  ApprovalRuleSummary,
  ApprovalState,
  ApprovalSummary,
  AuthorityMode,
} from "@vraxis/code-contracts";
import { authorityOptions } from "./authority-policy.js";

interface ApprovalData {
  schemaVersion: 2;
  approvals: ApprovalSummary[];
  rules: ApprovalRuleSummary[];
}

interface PendingDecision {
  resolve: (decision: "approved" | "denied") => void;
}

const emptyData: ApprovalData = { schemaVersion: 2, approvals: [], rules: [] };

function safeApprovalScope(value: string): string {
  let safe = value.trim();
  try {
    const url = new URL(safe);
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      safe = url.href;
    }
  } catch { /* Non-URL scopes are paths, controls, or commands. */ }
  return safe
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{12,}\b/gi, "[REDACTED]")
    .replace(/\bAIza[a-z0-9_-]{20,}\b/gi, "[REDACTED]")
    .replace(/\bgh[pousr]_[a-z0-9]{20,}\b/gi, "[REDACTED]")
    .replace(/\b(Bearer)\s+[a-z0-9._~+/=-]{12,}/gi, "$1 [REDACTED]")
    .replace(/((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD)\s*[=:]\s*)[^\s'";]+/gi, "$1[REDACTED]")
    .replace(/(--(?:api-key|token|secret|password)(?:=|\s+))[^\s'";]+/gi, "$1[REDACTED]")
    .slice(0, 240);
}

function titleForTool(toolName: string): string {
  if (toolName === "connect-mcp-server") return "Connect MCP server";
  if (toolName.startsWith("mcp__")) return `MCP · ${toolName.split("__").at(-1)?.replaceAll("_", " ") ?? "tool"}`;
  if (toolName.startsWith("mcp_resource__")) return "MCP · Read resource";
  if (toolName.startsWith("mcp_prompt__")) return "MCP · Get prompt";
  return toolName.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function riskFor(request: AgentVApprovalRequest): ApprovalRisk {
  if (request.category === "credentials" || request.category === "destructive" || request.risk === "privileged") return "high";
  if (request.risk === "external-side-effect" || request.risk === "write") return "medium";
  return "low";
}

function scopeFor(request: AgentVApprovalRequest): string {
  const input = request.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return request.scope.projectId;
  const record = input as Record<string, unknown>;
  for (const key of ["path", "url", "target", "command", "executable"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 240);
  }
  return request.scope.projectId;
}

export class ApprovalRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();
  private readonly decisions = new Map<string, PendingDecision>();
  private readonly earlyCancellations = new Map<string, string>();

  constructor(
    dataDirectory: string,
    private readonly govern?: (input: Omit<ApprovalSummary, "id" | "requestedAt" | "state">) => Promise<{
      forceFresh: boolean;
      deny?: string;
      teamPolicy?: NonNullable<ApprovalSummary["teamPolicy"]>;
    }>,
    private readonly authorityMode: () => Promise<AuthorityMode> = async () => "supervised",
  ) {
    this.file = join(dataDirectory, "approvals.json");
  }

  policy(sessionId: string, projectId?: string): ApprovalPolicy {
    return {
      decide: (request) => this.requestAgentDecision(sessionId, projectId ?? request.scope.projectId, request),
      cancel: (approvalId, reason) => this.cancelAgentDecision(approvalId, reason),
    };
  }

  async list(sessionId?: string): Promise<ApprovalSummary[]> {
    const data = await this.read();
    return data.approvals
      .filter((item) => !sessionId || item.sessionId === sessionId)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }

  async listRules(projectId?: string, sessionId?: string): Promise<ApprovalRuleSummary[]> {
    const data = await this.read();
    return data.rules
      .filter((item) => !item.revokedAt && (!projectId || item.projectId === projectId) && (!item.sessionId || item.sessionId === sessionId))
      .map((item) => ({ ...item, scope: safeApprovalScope(item.scope) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async audit(): Promise<ApprovalPolicyAuditV1> {
    const data = await this.read();
    const rules = data.rules
      .map((item) => ({ ...item, scope: safeApprovalScope(item.scope) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const active = rules.filter((item) => !item.revokedAt);
    return {
      kind: "vraxis.approval-policy-audit",
      version: 1,
      generatedAt: new Date().toISOString(),
      summary: {
        active: active.length,
        revoked: rules.length - active.length,
        allowed: active.filter((item) => item.effect === "allow").length,
        denied: active.filter((item) => item.effect === "deny").length,
      },
      rules,
    };
  }

  async revokeRule(id: string): Promise<ApprovalRuleSummary> {
    return this.mutate((data) => {
      const rule = data.rules.find((item) => item.id === id);
      if (!rule) throw new TypeError("Approval rule was not found.");
      if (!rule.revokedAt) rule.revokedAt = new Date().toISOString();
      return rule;
    });
  }

  async request(
    input: Omit<ApprovalSummary, "id" | "requestedAt" | "state">,
    requestedId: string = randomUUID(),
    matchRememberedRules = true,
  ): Promise<ApprovalSummary> {
    const mode = await this.authorityMode();
    const governance = await this.govern?.(input);
    const governedInput = governance?.forceFresh ? { ...input, rememberable: false } : input;
    const approval = await this.mutate((data) => {
      if (data.approvals.some((item) => item.id === requestedId)) throw new TypeError("Approval request already exists.");
      const earlyCancellation = this.earlyCancellations.get(requestedId);
      const blockedReason = !earlyCancellation ? governance?.deny : undefined;
      const approval: ApprovalSummary = {
        ...governedInput,
        actor: governedInput.actor ?? (governedInput.source === "agent" ? "agent" : "user"),
        authority: governedInput.authority ?? {
          mode,
          decision: "pending",
          reason: authorityOptions(mode, governedInput).reason,
        },
        scope: safeApprovalScope(governedInput.scope),
        id: requestedId,
        requestedAt: new Date().toISOString(),
        state: earlyCancellation ? "interrupted" : blockedReason ? "denied" : "pending",
        ...(earlyCancellation ? {
          resolvedAt: new Date().toISOString(),
          failure: earlyCancellation,
        } : blockedReason ? {
          resolvedAt: new Date().toISOString(),
          failure: blockedReason,
          authority: {
            mode,
            decision: "policy-denied",
            reason: blockedReason,
          },
        } : {}),
        ...(governance?.teamPolicy ? { teamPolicy: governance.teamPolicy } : {}),
      };
      const matchingRules = approval.state === "pending" && matchRememberedRules && !governance?.forceFresh ? data.rules.filter((item) => !item.revokedAt
        && item.projectId === approval.projectId
        && (!item.sessionId || item.sessionId === approval.sessionId)
        && item.capability === approval.capability
        && item.source === approval.source
        && item.scope === approval.scope) : [];
      const rule = matchingRules.find((item) => item.effect === "deny") ?? matchingRules[0];
      if (rule) {
        approval.state = rule.effect === "allow" ? "approved" : "denied";
        approval.resolvedAt = approval.requestedAt;
        approval.matchedRuleId = rule.id;
        approval.authority = {
          mode: approval.authority?.mode ?? "supervised",
          decision: "remembered",
          reason: `A remembered ${rule.duration} decision matched this exact scope.`,
        };
      }
      data.approvals.unshift(approval);
      return approval;
    });
    if (approval.state === "interrupted") this.earlyCancellations.delete(requestedId);
    return approval;
  }

  async decide(id: string, decision: "approve" | "deny", duration: ApprovalDuration = "once"): Promise<ApprovalSummary> {
    const next = await this.mutate((data) => {
      const approval = this.find(data, id);
      if (approval.state !== "pending") throw new TypeError("This approval request has already been resolved.");
      if (!authorityOptions(approval.authority?.mode ?? "supervised", approval).durations.includes(duration)) {
        throw new TypeError("This approval mode does not allow that decision to be remembered for so long.");
      }
      approval.state = decision === "approve" ? "approved" : "denied";
      approval.resolvedAt = new Date().toISOString();
      approval.authority = {
        mode: approval.authority?.mode ?? "supervised",
        decision: "explicit",
        reason: decision === "approve" ? "The user approved this exact request." : "The user denied this exact request.",
      };
      if (duration !== "once") {
        if (approval.rememberable === false) throw new TypeError("This sensitive action always requires a fresh decision.");
        if (!approval.projectId) throw new TypeError("This approval cannot be remembered because its project is unavailable.");
        const rule: ApprovalRuleSummary = {
          id: randomUUID(),
          projectId: approval.projectId,
          ...(duration === "session" ? { sessionId: approval.sessionId } : {}),
          effect: decision === "approve" ? "allow" : "deny",
          duration,
          capability: approval.capability,
          source: approval.source,
          scope: approval.scope,
          createdAt: approval.resolvedAt,
        };
        data.rules.unshift(rule);
        approval.matchedRuleId = rule.id;
      }
      return approval;
    });
    const pending = this.decisions.get(id);
    if (pending) {
      this.decisions.delete(id);
      pending.resolve(decision === "approve" ? "approved" : "denied");
    }
    return next;
  }

  async mark(id: string, state: ApprovalState, failure?: string): Promise<ApprovalSummary> {
    return this.mutate((data) => {
      const approval = this.find(data, id);
      approval.state = state;
      if (state !== "pending" && !approval.resolvedAt) approval.resolvedAt = new Date().toISOString();
      if (failure) approval.failure = failure;
      return approval;
    });
  }

  async reconcile(): Promise<void> {
    await this.mutate((data) => {
      for (const approval of data.approvals) {
        if ((approval.state === "pending" || approval.state === "executing") && !this.decisions.has(approval.id)) {
          approval.state = "interrupted";
          approval.resolvedAt = new Date().toISOString();
          approval.failure = "The app restarted before this request could finish. Ask the agent to try again.";
        }
      }
    }, false);
  }

  private async requestAgentDecision(sessionId: string, projectId: string, request: AgentVApprovalRequest): Promise<"approved" | "denied"> {
    const mcpRequest = request.toolName === "connect-mcp-server"
      || request.toolName.startsWith("mcp__")
      || request.toolName.startsWith("mcp_resource__")
      || request.toolName.startsWith("mcp_prompt__");
    const approval = await this.request({
      sessionId,
      projectId,
      capability: (request.category ?? "other") as ApprovalCapability,
      title: titleForTool(request.toolName),
      description: request.reason,
      scope: scopeFor(request),
      risk: riskFor(request),
      source: mcpRequest ? "mcp" : "agent",
      actor: "agent",
      boundary: mcpRequest || request.category === "network" || request.category === "credentials"
        ? "external-server"
        : request.category === "browser" ? "controlled-browser" : "isolated-worktree",
    }, request.id);
    const persisted = (await this.list(sessionId)).find((item) => item.id === approval.id);
    if (persisted?.state === "approved") return "approved";
    if (persisted?.state !== "pending") return "denied";
    return new Promise((resolve) => this.decisions.set(approval.id, { resolve }));
  }

  private async cancelAgentDecision(id: string, reason?: string): Promise<void> {
    const cancellation = reason ?? "The run ended before this request was decided.";
    // Publish cancellation before awaiting storage. requestAgentDecision can yield
    // to governance before it has persisted the approval, so cancellation must be
    // observable by the same mutation that first writes the request.
    this.earlyCancellations.set(id, cancellation);
    let found = false;
    await this.mutate((data) => {
      const approval = data.approvals.find((item) => item.id === id);
      if (!approval) return;
      found = true;
      if (approval.state !== "pending") return;
      approval.state = "interrupted";
      approval.resolvedAt = new Date().toISOString();
      approval.failure = cancellation;
    });
    if (found) this.earlyCancellations.delete(id);
    const pending = this.decisions.get(id);
    if (pending) {
      this.decisions.delete(id);
      pending.resolve("denied");
    }
  }

  private find(data: ApprovalData, id: string): ApprovalSummary {
    const approval = data.approvals.find((item) => item.id === id);
    if (!approval) throw new TypeError("Approval request was not found.");
    return approval;
  }

  private async read(): Promise<ApprovalData> {
    await this.mutations;
    return this.readSnapshot();
  }

  private async readSnapshot(): Promise<ApprovalData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as ApprovalData | { schemaVersion: 1; approvals: ApprovalSummary[] };
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.approvals)) {
        return { schemaVersion: 2, approvals: parsed.approvals, rules: [] };
      }
      if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.approvals) || !Array.isArray(parsed.rules)) {
        throw new Error("Unsupported approval registry.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private async mutate<T>(change: (data: ApprovalData) => T, alwaysWrite = true): Promise<T> {
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

  private async write(data: ApprovalData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
