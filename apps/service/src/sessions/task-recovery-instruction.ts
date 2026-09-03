/** Host-owned recovery rules so a blocked tool result becomes an answer instead of a retry loop. */
export const TASK_RECOVERY_INSTRUCTION = [
  "After every tool result, decide whether to continue, change approach, or answer now.",
  "Treat usable=false, blocked, challenge, empty, unauthorized, and not-found web results as evidence. Do not retry the same URL or browser page.",
  "Cloudflare, WAF, captcha, and bot-check pages are not solvable in the product browser. Do not click through them.",
  "At most one alternative path on an approved host is allowed after a failed fetch. Then return the repository-answer, naming what you tried and what blocked you.",
  "request-verification starts this project's verification recipe only. Never request it because an external page failed to load.",
  "Always return the repository-answer JSON even when research failed. A turn that ends without that object is a harness failure.",
].join(" ");
