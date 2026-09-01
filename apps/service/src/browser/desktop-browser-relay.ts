import type { BrowserActionRequest } from "@vraxis/code-contracts";
import type { BrowserAutomationObservation, BrowserAutomationRelay } from "./browser-automation.js";
import { normalizeBrowserObservation } from "./browser-automation.js";

export class DesktopBrowserRelay implements BrowserAutomationRelay {
  private readonly controllers = new Set<AbortController>();
  private closed = false;

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly request: typeof globalThis.fetch = globalThis.fetch,
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/v1/perform" || url.username || url.password) {
      throw new TypeError("The desktop browser control endpoint is invalid.");
    }
    if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) throw new TypeError("The desktop browser control token is invalid.");
  }

  async perform(input: BrowserActionRequest): Promise<BrowserAutomationObservation> {
    if (this.closed) throw new Error("The desktop browser is unavailable.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("The desktop browser did not answer within 45 seconds.")), 45_000);
    timeout.unref();
    this.controllers.add(controller);
    try {
      const response = await this.request(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const value = await response.json() as unknown;
      if (!response.ok) {
        const message = value && typeof value === "object" && "error" in value ? String(value.error) : "The desktop browser action failed.";
        throw new Error(message.slice(0, 1_000));
      }
      return normalizeBrowserObservation(value, input.sessionId);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.controllers) controller.abort(new Error("The desktop browser closed before the action completed."));
    this.controllers.clear();
  }
}
