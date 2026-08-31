import { describe, expect, it } from "vitest";
import { normalizeInspector, normalizeMode, selectedProject } from "./workspace-state.js";
import { demoState } from "./demo-state.js";

describe("workspace state", () => {
  it("keeps one selected project identity", () => {
    expect(selectedProject(demoState)?.name).toBe("vraxis-code");
  });

  it("fails closed to safe default modes", () => {
    expect(normalizeMode("custom-autonomous")).toBe("ask");
    expect(normalizeInspector("unknown")).toBe("files");
    expect(normalizeInspector("verify")).toBe("verify");
  });
});
