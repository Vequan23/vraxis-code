import { createHttpFetchTool } from "@vraxis/agent-v/tools";
import type { AgentTool } from "@vraxis/agent-v";
import type { ApprovalRegistry } from "../approvals/approval-registry.js";

const absoluteUrlPattern = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const explicitBareTargetPattern = /\b(?:fetch|curl|visit|open|website|url)\s+(?:at\s+)?((?:www\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}(?::\d{1,5})?(?:\/[^\s<>"'`]*)?|localhost(?::\d{1,5})?(?:\/[^\s<>"'`]*)?|127\.0\.0\.1(?::\d{1,5})?(?:\/[^\s<>"'`]*)?)/gi;
const trailingPunctuation = /[),.;!?\]}]+$/;

function normalizedUrl(value: string, addHttps: boolean): URL | undefined {
  const candidate = value.replace(trailingPunctuation, "");
  try {
    const url = new URL(addHttps ? `https://${candidate}` : candidate);
    if (url.username || url.password) return undefined;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/** Hosts explicitly named in the current user turn. Historical messages never expand network authority. */
export function promptWebHosts(prompt: string): string[] {
  const hosts = new Set<string>();
  for (const match of prompt.matchAll(absoluteUrlPattern)) {
    const url = normalizedUrl(match[0], false);
    if (url) hosts.add(url.host.toLowerCase());
    if (hosts.size >= 8) return [...hosts];
  }
  for (const match of prompt.matchAll(explicitBareTargetPattern)) {
    const url = normalizedUrl(match[1] ?? "", true);
    if (url) hosts.add(url.host.toLowerCase());
    if (hosts.size >= 8) break;
  }
  return [...hosts];
}

/**
 * A typed alternative to raw curl for URLs the user named in this turn.
 * The normal agent approval policy authorizes the request; this wrapper also
 * advances the product receipt through executing/completed/failed.
 */
export function createPromptWebFetchTool(prompt: string, approvals?: ApprovalRegistry): AgentTool | undefined {
  const allowedHosts = promptWebHosts(prompt);
  if (!allowedHosts.length) return undefined;
  const tool = createHttpFetchTool({ allowedHosts });
  return {
    ...tool,
    async execute(input, context) {
      if (context.approvalId && approvals) await approvals.mark(context.approvalId, "executing");
      try {
        const result = await tool.execute(input, context);
        if (context.approvalId && approvals) await approvals.mark(context.approvalId, "completed");
        return result;
      } catch (error) {
        if (context.approvalId && approvals) {
          await approvals.mark(context.approvalId, "failed", "The approved web request failed.");
        }
        throw error;
      }
    },
  };
}
