import type { TaskReceiptV1 } from "@vraxis/code-contracts";

const urlPattern = /\bhttps?:\/\/[^\s<>"']+/gi;

function redactUrl(raw: string): string {
  const suffix = raw.match(/[),.;!?]+$/)?.[0] ?? "";
  const candidate = suffix ? raw.slice(0, -suffix.length) : raw;
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[REDACTED]");
    return `${url.href}${suffix}`;
  } catch {
    return raw;
  }
}

/** Removes common credentials and URL payloads before evidence leaves the local product boundary. */
export function redactPortableText(value: string): string {
  return value
    .replace(urlPattern, redactUrl)
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{12,}\b/gi, "[REDACTED API KEY]")
    .replace(/\bAIza[a-z0-9_-]{20,}\b/gi, "[REDACTED API KEY]")
    .replace(/\bgh[pousr]_[a-z0-9]{20,}\b/gi, "[REDACTED TOKEN]")
    .replace(/\bxox[baprs]-[a-z0-9-]{12,}\b/gi, "[REDACTED TOKEN]")
    .replace(/\b(Bearer|Basic)\s+[a-z0-9._~+/=-]{12,}/gi, "$1 [REDACTED]")
    .replace(/((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s'";]+)/gi, "$1[REDACTED]")
    .replace(/((?:--?)(?:api[-_]?key|token|secret|password|passwd)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]");
}

function redactPortableValue(value: unknown): unknown {
  if (typeof value === "string") return redactPortableText(value);
  if (Array.isArray(value)) return value.map(redactPortableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPortableValue(item)]));
}

/** Creates the secret-minimized receipt that is signed and exported. Raw local evidence stays untouched. */
export function redactTaskReceipt(receipt: TaskReceiptV1): TaskReceiptV1 {
  return redactPortableValue(receipt) as TaskReceiptV1;
}
