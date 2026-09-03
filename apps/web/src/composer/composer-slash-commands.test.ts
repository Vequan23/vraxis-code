import { describe, expect, it } from "vitest";
import {
  buildComposerSlashCommandSuggestions,
  composerSlashCommandById,
  composerSlashCommandDefinitionsForTest,
  type ComposerSlashCommandContext,
} from "./composer-slash-commands.js";

const baseContext: ComposerSlashCommandContext = {
  previewMode: false,
  sessionIsRunning: false,
  hasSession: true,
  hasProject: true,
  runtimeCanBuild: true,
  verificationHasRecipe: true,
  hasChanges: true,
  pendingApprovalCount: 1,
  hasRuntime: true,
  startingNewTask: false,
};

describe("composer slash commands", () => {
  it("exposes standard mode commands and differentiated evidence commands", () => {
    const labels = composerSlashCommandDefinitionsForTest.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["ask", "plan", "build", "review", "verify", "doctor", "proof", "probe"]));
  });

  it("maps commands to slash suggestions with grouped metadata", () => {
    const suggestions = buildComposerSlashCommandSuggestions(baseContext);
    const verify = suggestions.find((item) => item.id === "command:verify");
    expect(verify).toMatchObject({
      trigger: "/",
      kind: "command",
      label: "verify",
      group: "Evidence",
      selectionBehavior: "emit",
      disabled: false,
    });
  });

  it("disables build commands when the runtime cannot write to a worktree", () => {
    const suggestions = buildComposerSlashCommandSuggestions({
      ...baseContext,
      runtimeCanBuild: false,
    });
    expect(suggestions.find((item) => item.id === "command:build")?.disabled).toBe(true);
    expect(suggestions.find((item) => item.id === "command:ask")?.disabled).toBe(false);
  });

  it("disables commit when there are no changes", () => {
    const suggestions = buildComposerSlashCommandSuggestions({
      ...baseContext,
      hasChanges: false,
    });
    expect(suggestions.find((item) => item.id === "command:commit")?.disabled).toBe(true);
    expect(suggestions.find((item) => item.id === "command:commit")?.disabledReason).toMatch(/changes/i);
  });

  it("resolves command definitions by id", () => {
    expect(composerSlashCommandById("handoff")?.action).toEqual({
      type: "prompt",
      mode: "ask",
      prompt: expect.stringContaining("external attachments"),
    });
  });
});
