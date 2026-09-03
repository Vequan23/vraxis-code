export const webResearchOutcomes = [
  "usable",
  "blocked",
  "challenge",
  "empty",
  "unauthorized",
  "not-found",
  "redirect",
] as const;

export type WebResearchOutcome = (typeof webResearchOutcomes)[number];

export interface WebResearchObservation {
  usable: boolean;
  outcome: WebResearchOutcome;
  observation: string;
  nextStep: string;
}

export interface WebResearchEvidence {
  url?: string;
  status?: number;
  ok?: boolean;
  title?: string;
  contentType?: string;
  body?: string;
  visibleText?: string;
  redirectLocation?: string;
  method?: string;
}

const blockedPattern = /sorry, you have been blocked|you are unable to access |attention required!?\s*\|?\s*cloudflare|cf-error(?:-details)?|access denied|request blocked|blocked by (?:the )?waf|error 10[0-2]\d/i;
const challengePattern = /checking your browser(?: before accessing)?|verify you are (?:a )?human|just a moment(?:\.\.\.)?|enable javascript and cookies|hcaptcha|recaptcha|challenge-platform|cdn-cgi\/challenge/i;
const previewLimit = 800;

function combinedText(evidence: WebResearchEvidence): string {
  return [evidence.title, evidence.visibleText, evidence.body].filter((part) => typeof part === "string").join("\n");
}

function preview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= previewLimit) return compact;
  return `${compact.slice(0, previewLimit)}…`;
}

function sameHostRedirect(url: string | undefined, redirectLocation: string): boolean {
  if (!url) return false;
  try {
    return new URL(redirectLocation, url).host === new URL(url).host;
  } catch {
    return false;
  }
}

/** Classify a fetch or browser page so the agent can stop retrying unusable results. */
export function observeWebResearchResult(evidence: WebResearchEvidence): WebResearchObservation {
  const text = combinedText(evidence);
  const status = evidence.status;
  const redirectLocation = evidence.redirectLocation?.trim() ?? "";
  const empty = !text.trim();
  const head = evidence.method === "HEAD";

  if (status && [301, 302, 303, 307, 308].includes(status) && redirectLocation) {
    const follow = sameHostRedirect(evidence.url, redirectLocation);
    return {
      usable: false,
      outcome: "redirect",
      observation: `The request redirected to ${redirectLocation} without a body.`,
      nextStep: follow
        ? `Fetch that redirect URL once if it is an approved host. Do not retry ${evidence.url ?? "the original URL"}.`
        : "Do not follow a redirect to an unapproved host. Answer now if no other approved URL remains.",
    };
  }
  if (blockedPattern.test(text) || status === 429) {
    return {
      usable: false,
      outcome: "blocked",
      observation: "A bot or WAF block page was returned. This is not the requested content.",
      nextStep: "Do not retry this URL or open the product browser. Try at most one alternative path on the same approved host, then return the repository-answer naming what blocked you. Do not request product verification.",
    };
  }
  if (challengePattern.test(text)) {
    return {
      usable: false,
      outcome: "challenge",
      observation: "A bot-check or captcha page was returned. The product browser cannot solve it.",
      nextStep: "Do not click through the challenge. Try at most one alternative path on the same approved host, then return the repository-answer. Do not request product verification.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      usable: false,
      outcome: "unauthorized",
      observation: `The host returned HTTP ${status}. Credentials must not be guessed or filled by the agent.`,
      nextStep: "Do not retry with inferred credentials. Return the repository-answer and name the limitation.",
    };
  }
  if (status === 404) {
    return {
      usable: false,
      outcome: "not-found",
      observation: "The host returned HTTP 404.",
      nextStep: "Try at most one alternative path on the same approved host, then return the repository-answer.",
    };
  }
  if (empty && !head && evidence.ok !== true) {
    return {
      usable: false,
      outcome: "empty",
      observation: status ? `HTTP ${status} returned no usable body.` : "The page or response had no usable text.",
      nextStep: "Try at most one alternative path on the same approved host, then return the repository-answer.",
    };
  }
  if (empty && !head) {
    return {
      usable: false,
      outcome: "empty",
      observation: "The response succeeded but contained no readable text.",
      nextStep: "Try at most one alternative path on the same approved host, then return the repository-answer.",
    };
  }
  return {
    usable: true,
    outcome: "usable",
    observation: "The response looks like page or API content.",
    nextStep: "Use this body as evidence. Return the repository-answer when you can answer the user.",
  };
}

export function annotateWebResearchResult<T extends Record<string, unknown>>(
  result: T,
  evidence: WebResearchEvidence,
): T & WebResearchObservation {
  const observation = observeWebResearchResult(evidence);
  if (observation.usable) return { ...result, ...observation };
  const rawBody = typeof result.body === "string" ? result.body : evidence.body ?? evidence.visibleText ?? "";
  return {
    ...result,
    ...observation,
    ...(typeof result.body === "string" ? { body: preview(rawBody) } : {}),
    ...(typeof result.visibleText === "string" ? { visibleText: preview(String(result.visibleText)) } : {}),
  };
}
