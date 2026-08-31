import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const cookieName = "vraxis_code_session";
const csrfCookieName = "vraxis_code_csrf";
const defaultLifetimeMs = 24 * 60 * 60 * 1_000;

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  for (const part of request.headers.cookie?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** In-memory, process-bound authentication for the privileged loopback API. */
export class DesktopSession {
  private readonly sessionSecret = randomBytes(32).toString("base64url");
  private readonly csrfSecret = randomBytes(32).toString("base64url");
  private consumed = false;
  private expiresAt = 0;

  constructor(
    private readonly launchToken: string,
    private readonly now: () => number = Date.now,
    private readonly lifetimeMs = defaultLifetimeMs,
  ) {
    if (!launchToken) throw new TypeError("Desktop launch token must not be empty.");
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) throw new TypeError("Desktop session lifetime must be positive.");
  }

  exchange(candidate: string | null): string[] | undefined {
    if (this.consumed || !candidate || !equalSecret(candidate, this.launchToken)) return undefined;
    this.consumed = true;
    this.expiresAt = this.now() + this.lifetimeMs;
    const maxAge = Math.ceil(this.lifetimeMs / 1_000);
    return [
      `${cookieName}=${this.sessionSecret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
      `${csrfCookieName}=${this.csrfSecret}; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
    ];
  }

  authorize(request: IncomingMessage): boolean {
    const actual = cookieValue(request, cookieName);
    return Boolean(actual && this.now() < this.expiresAt && equalSecret(actual, this.sessionSecret));
  }

  authorizeMutation(request: IncomingMessage): boolean {
    const method = request.method?.toUpperCase() ?? "GET";
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
    const cookie = cookieValue(request, csrfCookieName);
    const header = request.headers["x-vraxis-csrf"];
    return Boolean(
      cookie
      && typeof header === "string"
      && equalSecret(cookie, this.csrfSecret)
      && equalSecret(header, this.csrfSecret),
    );
  }
}
