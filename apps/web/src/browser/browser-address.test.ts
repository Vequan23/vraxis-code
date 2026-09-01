import { describe, expect, it } from "vitest";
import { normalizeBrowserAddress } from "./browser-address.js";

describe("normalizeBrowserAddress", () => {
  it("adds HTTPS to ordinary hostnames", () => {
    expect(normalizeBrowserAddress("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeBrowserAddress("//example.com/docs")).toBe("https://example.com/docs");
  });

  it("uses HTTP for local development addresses", () => {
    expect(normalizeBrowserAddress("localhost:4318")).toBe("http://localhost:4318/");
    expect(normalizeBrowserAddress("127.0.0.1:3000/app")).toBe("http://127.0.0.1:3000/app");
    expect(normalizeBrowserAddress("[::1]:5173")).toBe("http://[::1]:5173/");
  });

  it("preserves explicit HTTP and HTTPS addresses", () => {
    expect(normalizeBrowserAddress("https://example.com?q=1")).toBe("https://example.com/?q=1");
    expect(normalizeBrowserAddress("http://localhost:8080/path")).toBe("http://localhost:8080/path");
  });

  it("rejects spaces, credentials, and unsupported protocols", () => {
    expect(() => normalizeBrowserAddress("example dot com")).toThrow(/without spaces/);
    expect(() => normalizeBrowserAddress("https://user:secret@example.com")).toThrow(/credentials/);
    expect(() => normalizeBrowserAddress("file:///tmp/index.html")).toThrow(/HTTP or HTTPS/);
  });
});
