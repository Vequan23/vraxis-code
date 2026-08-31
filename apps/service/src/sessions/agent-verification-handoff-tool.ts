import { defineOutput, defineTool, type AgentTool, type JsonObject } from "@vraxis/agent-v";
import type { VerificationRegistry } from "../verification/verification-registry.js";

interface VerificationHandoffInput {
  note?: string;
}

const inputContract = defineOutput<VerificationHandoffInput>({
  name: "vraxis-verification-handoff-input",
  description: "An optional short explanation of what should be verified. The host always chooses the project-owned recipe.",
  jsonSchema: {
    type: "object",
    properties: {
      note: { type: "string", maxLength: 500 },
    },
    additionalProperties: false,
  },
  parse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Verification handoff input must be an object.");
    }
    const record = value as { note?: unknown };
    if (record.note !== undefined && typeof record.note !== "string") {
      throw new TypeError("Verification handoff note must be a string.");
    }
    const note = record.note?.trim();
    if (note && note.length > 500) throw new TypeError("Verification handoff notes are limited to 500 characters.");
    return note ? { note } : {};
  },
});

const outputContract = defineOutput<JsonObject>({
  name: "vraxis-verification-handoff-output",
  jsonSchema: {
    type: "object",
    properties: {
      kind: { const: "vraxis.verification-handoff" },
      handoffId: { type: "string" },
      state: { const: "requested" },
      detail: { type: "string" },
    },
    required: ["kind", "handoffId", "state", "detail"],
    additionalProperties: false,
  },
  parse(value) {
    const record = value as Record<string, unknown>;
    if (record?.kind !== "vraxis.verification-handoff" || typeof record.handoffId !== "string") {
      throw new TypeError("Verification handoff output is invalid.");
    }
    return record as JsonObject;
  },
});

/**
 * Lets an agent stop at the product trust boundary and ask the user to run the
 * manifest-backed verification recipe. It never selects or executes commands.
 */
export function createAgentVerificationHandoffTool(options: {
  sessionId: string;
  runtimeId: string;
  modelId?: string;
  verifications: VerificationRegistry;
}): AgentTool<VerificationHandoffInput, JsonObject> {
  return defineTool({
    name: "request-verification",
    version: "1.0.0",
    description: "Request a user-reviewed, product-owned verification run for the current task. This records a handoff only; it cannot choose commands, grant approval, or start processes.",
    input: inputContract,
    output: outputContract,
    requiresApproval: false,
    risk: "write",
    sideEffect: "idempotent",
    requiredPermissions: [],
    timeoutMs: 5_000,
    async execute(input) {
      const handoff = await options.verifications.requestHandoff({
        sessionId: options.sessionId,
        runtimeId: options.runtimeId,
        ...(options.modelId ? { modelId: options.modelId } : {}),
        ...(input.note ? { note: input.note } : {}),
      });
      return {
        kind: "vraxis.verification-handoff",
        handoffId: handoff.id,
        state: "requested",
        detail: "Verification was handed back to the user. Vraxis Code will show the exact project-owned recipe and require normal approvals before anything runs.",
      };
    },
  });
}
