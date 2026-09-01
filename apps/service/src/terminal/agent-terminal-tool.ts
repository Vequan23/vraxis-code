import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { defineOutput, defineTool, type AgentTool, type JsonObject } from "@vraxis/agent-v";
import type { ApprovalRegistry } from "../approvals/approval-registry.js";
import type { TerminalRegistry } from "./terminal-registry.js";

interface TerminalToolInput {
  command: string;
  cwd: string;
  background: boolean;
  timeoutMs: number;
}

interface TerminalToolOutput extends JsonObject {
  runId: string;
  status: "running" | "success" | "error" | "interrupted";
  command: string;
  cwd: string;
  output: string;
  exitCode?: number;
  durationMs?: number;
}

const inputContract = defineOutput<TerminalToolInput>({
  name: "vraxis-terminal-command",
  description: "One argv command and an optional project-relative working directory.",
  jsonSchema: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1, description: "Executable and arguments. Shell operators and expansion are not supported." },
      cwd: { type: "string", description: "Project-relative working directory. Defaults to the workspace root." },
      background: { type: "boolean", description: "Return a run handle immediately for a long-running process." },
      timeoutMs: { type: "number", description: "Command deadline between 1 second and 30 minutes." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  parse(value) {
    const record = value as { command?: unknown; cwd?: unknown; background?: unknown; timeoutMs?: unknown };
    if (typeof record?.command !== "string" || !record.command.trim()) throw new TypeError("Command must be a non-empty string.");
    if (record.cwd !== undefined && typeof record.cwd !== "string") throw new TypeError("Command cwd must be a string.");
    if (record.background !== undefined && typeof record.background !== "boolean") throw new TypeError("Command background must be a boolean.");
    const timeoutMs = record.timeoutMs === undefined ? 120_000 : Number(record.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60_000) throw new TypeError("Command timeoutMs must be between 1000 and 1800000.");
    const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : ".";
    if (isAbsolute(cwd)) throw new TypeError("Command cwd must be relative to the approved workspace.");
    return { command: record.command.trim(), cwd, background: record.background === true, timeoutMs };
  },
});

const outputContract = defineOutput<TerminalToolOutput>({
  name: "vraxis-terminal-result",
  jsonSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      status: { type: "string", enum: ["running", "success", "error", "interrupted"] },
      command: { type: "string" },
      cwd: { type: "string" },
      output: { type: "string" },
      exitCode: { type: "number" },
      durationMs: { type: "number" },
    },
    required: ["runId", "status", "command", "cwd", "output"],
    additionalProperties: false,
  },
  parse(value) {
    const result = value as TerminalToolOutput;
    if (!result || typeof result.runId !== "string" || !["running", "success", "error", "interrupted"].includes(result.status)) throw new TypeError("Terminal result is invalid.");
    return result;
  },
});

async function resolveCommandDirectory(workspacePath: string, cwd: string): Promise<string> {
  const canonicalRoot = await realpath(workspacePath);
  const candidate = await realpath(resolve(canonicalRoot, cwd));
  const inside = relative(canonicalRoot, candidate);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new TypeError("Command cwd escapes the approved workspace.");
  }
  if (!(await stat(candidate)).isDirectory()) throw new TypeError("Command cwd must be a project folder.");
  return candidate;
}

export function createAgentTerminalTool(options: {
  sessionId: string;
  workspacePath: string;
  terminal: TerminalRegistry;
  approvals: ApprovalRegistry;
}): AgentTool<TerminalToolInput, TerminalToolOutput> {
  return defineTool<TerminalToolInput, TerminalToolOutput>({
    name: "terminal-run",
    version: "1.0.0",
    description: "Use to run one approved command without a shell in Vraxis Code's visible terminal; choose background for servers and poll the retained run separately.",
    input: inputContract,
    output: outputContract,
    requiresApproval: true,
    approvalCategory: "command",
    approvalReason: "Run this command without a shell inside the approved isolated workspace.",
    risk: "privileged",
    sideEffect: "non-idempotent",
    requiredPermissions: ["command:execute"],
    timeoutMs: 30 * 60_000 + 5_000,
    async execute(input, context) {
      if (!context.approvalId) throw new TypeError("The terminal command is missing its approval receipt.");
      const absoluteCwd = await resolveCommandDirectory(options.workspacePath, input.cwd);
      const run = await options.terminal.prepare(options.sessionId, context.approvalId, input.command, input.cwd);
      await options.approvals.mark(context.approvalId, "executing");
      try {
        const execution = options.terminal.execute(run.id, absoluteCwd, context.abortSignal, input.timeoutMs);
        if (input.background) {
          void execution.then(async (completed) => {
            if (completed.status === "success") await options.approvals.mark(context.approvalId!, "completed");
            else await options.approvals.mark(context.approvalId!, "failed", completed.output.trim().slice(-500) || "Command failed.");
          }).catch(async (error) => {
            await options.approvals.mark(context.approvalId!, "failed", error instanceof Error ? error.message : "Command execution failed.");
          });
          return { runId: run.id, status: "running", command: run.command, cwd: run.cwd, output: "" };
        }
        const completed = await execution;
        if (completed.status === "success") await options.approvals.mark(context.approvalId, "completed");
        else await options.approvals.mark(context.approvalId, "failed", completed.output.trim().slice(-500) || "Command failed.");
        return {
          runId: completed.id,
          status: completed.status === "running" || completed.status === "pending" ? "interrupted" : completed.status,
          command: completed.command,
          cwd: completed.cwd,
          output: completed.output,
          ...(completed.exitCode === undefined ? {} : { exitCode: completed.exitCode }),
          ...(completed.durationMs === undefined ? {} : { durationMs: completed.durationMs }),
        };
      } catch (error) {
        await options.approvals.mark(context.approvalId, "failed", error instanceof Error ? error.message : "Command execution failed.");
        throw error;
      }
    },
  });
}

const runHandleInput = defineOutput<{ runId: string }>({
  name: "vraxis-terminal-run-handle",
  jsonSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"], additionalProperties: false },
  parse(value) {
    const runId = (value as { runId?: unknown })?.runId;
    if (typeof runId !== "string" || !runId.trim()) throw new TypeError("Terminal runId must be a non-empty string.");
    return { runId };
  },
});

function terminalResult(run: Awaited<ReturnType<TerminalRegistry["list"]>>[number]): TerminalToolOutput {
  return {
    runId: run.id,
    status: run.status === "pending" || run.status === "running" ? "running" : run.status,
    command: run.command,
    cwd: run.cwd,
    output: run.output,
    ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
    ...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
  };
}

export function createAgentTerminalPollTool(options: { sessionId: string; terminal: TerminalRegistry }): AgentTool<{ runId: string }, TerminalToolOutput> {
  return defineTool({
    name: "terminal-poll",
    version: "1.0.0",
    description: "Use after a background terminal-run to read its current output, status, duration, and exit code.",
    input: runHandleInput,
    output: outputContract,
    requiresApproval: false,
    risk: "read",
    sideEffect: "none",
    requiredPermissions: ["command:execute"],
    timeoutMs: 5_000,
    async execute({ runId }) {
      const run = (await options.terminal.list(options.sessionId)).find((item) => item.id === runId);
      if (!run) throw new TypeError("Terminal run was not found in this task.");
      return terminalResult(run);
    },
  });
}

export function createAgentTerminalStopTool(options: { sessionId: string; terminal: TerminalRegistry }): AgentTool<{ runId: string }, TerminalToolOutput> {
  return defineTool({
    name: "terminal-stop",
    version: "1.0.0",
    description: "Use to stop a running background command that belongs to this task.",
    input: runHandleInput,
    output: outputContract,
    requiresApproval: false,
    risk: "write",
    sideEffect: "idempotent",
    requiredPermissions: ["command:execute"],
    timeoutMs: 5_000,
    async execute({ runId }) {
      const run = (await options.terminal.list(options.sessionId)).find((item) => item.id === runId);
      if (!run) throw new TypeError("Terminal run was not found in this task.");
      if (run.status === "pending" || run.status === "running") await options.terminal.interrupt(runId);
      const updated = (await options.terminal.list(options.sessionId)).find((item) => item.id === runId) ?? run;
      return terminalResult(updated);
    },
  });
}
