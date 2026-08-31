import { describe, expect, it, vi } from "vitest";
import { chooseProjectFolder } from "./project-picker.js";

describe("project folder picker", () => {
  it("registers only the directory selected by the desktop bridge", async () => {
    const register = vi.fn(async (path: string) => ({ path }));
    const result = await chooseProjectFolder(
      { chooseDirectory: async () => ({ cancelled: false, path: "/Users/engineer/project" }) },
      register,
      async () => { throw new Error("browser fallback should not run"); },
    );
    expect(result).toEqual({ path: "/Users/engineer/project" });
    expect(register).toHaveBeenCalledWith("/Users/engineer/project");
  });

  it("uses the local-service chooser in a browser", async () => {
    const browserFallback = vi.fn(async () => ({ path: "/Users/engineer/project" }));
    const result = await chooseProjectFolder(
      undefined,
      async () => { throw new Error("desktop registration should not run"); },
      browserFallback,
    );
    expect(result).toEqual({ path: "/Users/engineer/project" });
    expect(browserFallback).toHaveBeenCalledOnce();
  });

  it("treats cancellation as a no-op", async () => {
    const register = vi.fn(async (path: string) => ({ path }));
    const result = await chooseProjectFolder(
      { chooseDirectory: async () => ({ cancelled: true }) },
      register,
      async () => null,
    );
    expect(result).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });
});
