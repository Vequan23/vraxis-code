import { describe, expect, it } from "vitest";
import { csrfTokenFromCookie, shouldProtectRequest } from "./csrf-fetch.js";

describe("desktop request-forgery protection", () => {
  it("extracts only the dedicated token", () => {
    expect(csrfTokenFromCookie("theme=dark; vraxis_code_csrf=random-token; other=value")).toBe("random-token");
    expect(csrfTokenFromCookie("vraxis_code_session=private")).toBeUndefined();
  });

  it("protects same-origin API mutations and leaves reads or external URLs alone", () => {
    const origin = "http://127.0.0.1:4317";
    expect(shouldProtectRequest(new URL(`${origin}/api/projects`), "POST", origin)).toBe(true);
    expect(shouldProtectRequest(new URL(`${origin}/api/bootstrap`), "GET", origin)).toBe(false);
    expect(shouldProtectRequest(new URL("https://example.com/api/projects"), "POST", origin)).toBe(false);
    expect(shouldProtectRequest(new URL(`${origin}/assets/app.js`), "POST", origin)).toBe(false);
  });
});
