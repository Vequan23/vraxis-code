import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { defineOutput, defineTool, type AgentTool, type JsonObject } from "@vraxis/agent-v";
import type { ApprovalRegistry } from "../approvals/approval-registry.js";
import type { TerminalRegistry } from "./terminal-registry.js";

interface TerminalToolInput {
  command: string;
  cwd: string;
}

interface TerminalToolOutput extends JsonObject {
  runId: string;
  status: "success" | "error" | "interrupted";
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
    },
    required: ["command"],
    additionalProperties: false,
  },
  parse(value) {
    const record = value as { command?: unknown; cwd?: unknown };
    if (typeof record?.command !== "string" || !record.command.trim()) throw new TypeError("Command must be a non-empty string.");
    if (record.cwd !== undefined && typeof record.cwd !== "string") throw new TypeError("Command cwd must be a string.");
    const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : ".";
    if (isAbsolute(cwd)) throw new TypeError("Command cwd must be relative to the approved workspace.");
    return { command: record.command.trim(), cwd };
  },
});

const outputContract = defineOutput<TerminalToolOutput>({
  name: "vraxis-terminal-result",
  jsonSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      status: { type: "string", enum: ["success", "error", "interrupted"] },
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
    if (!result || typeof result.runId !== "string" || !["success", "error", "interrupted"].includes(result.status)) throw new TypeError("Terminal result is invalid.");
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
    description: "Run one command without a shell in Vraxis Code's visible terminal. The user must approve every invocation, and the result is retained as a terminal receipt.",
    input: inputContract,
    output: outputContract,
    requiresApproval: true,
    approvalCategory: "command",
    approvalReason: "Run this command without a shell inside the approved isolated workspace.",
    risk: "privileged",
    sideEffect: "non-idempotent",
    requiredPermissions: ["command:execute"],
    timeoutMs: 125_000,
    async execute(input, context) {
      if (!context.approvalId) throw new TypeError("The terminal command is missing its approval receipt.");
      const absoluteCwd = await resolveCommandDirectory(options.workspacePath, input.cwd);
      const run = await options.terminal.prepare(options.sessionId, context.approvalId, input.command, input.cwd);
      await options.approvals.mark(context.approvalId, "executing");
      try {
        const completed = await options.terminal.execute(run.id, absoluteCwd, context.abortSignal);
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
