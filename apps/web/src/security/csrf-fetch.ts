const csrfCookieName = "vraxis_code_csrf";
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfTokenFromCookie(cookie: string): string | undefined {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === csrfCookieName) return rest.join("=");
  }
  return undefined;
}

export function shouldProtectRequest(url: URL, method: string, origin: string): boolean {
  return url.origin === origin && url.pathname.startsWith("/api/") && !safeMethods.has(method.toUpperCase());
}

/** Adds the desktop double-submit token to every same-origin API mutation. */
export function installCsrfFetch(): void {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const target = new URL(request?.url ?? String(input), window.location.href);
    const method = init?.method ?? request?.method ?? "GET";
    if (!shouldProtectRequest(target, method, window.location.origin)) return nativeFetch(input, init);
    const token = csrfTokenFromCookie(document.cookie);
    if (!token) return nativeFetch(input, init);
    const headers = new Headers(request?.headers);
    for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
    headers.set("x-vraxis-csrf", token);
    return nativeFetch(input, { ...init, headers });
  };
}
