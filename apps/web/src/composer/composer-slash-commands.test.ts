import { describe, expect, it } from "vitest";
import {
  buildComposerSlashCommandSuggestions,
  buildUserComposerSlashCommandSuggestions,
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
    expect(labels).toEqual(expect.arrayContaining(["ask", "plan", "build", "review", "verify", "proof", "probe"]));
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

  it("merges project slash commands after built-ins", () => {
    const suggestions = buildComposerSlashCommandSuggestions(baseContext, [{
      id: "abc",
      name: "review-pr",
      description: "Review like a staff engineer.",
      mode: "review",
      prompt: "Review the branch.",
      scope: "project",
      path: ".vraxis/commands/review-pr.md",
    }]);
    const builtInIndex = suggestions.findIndex((item) => item.id === "command:verify");
    const userIndex = suggestions.findIndex((item) => item.id === "command:user:abc");
    expect(userIndex).toBeGreaterThan(builtInIndex);
    expect(suggestions[userIndex]).toMatchObject({
      label: "review-pr",
      group: "Project commands",
    });
  });

  it("disables project build commands when the runtime cannot write", () => {
    const suggestions = buildUserComposerSlashCommandSuggestions([{
      id: "build-recipe",
      name: "ship",
      description: "Implement a focused change.",
      mode: "build",
      prompt: "Implement the change.",
      scope: "project",
      path: ".vraxis/commands/ship.md",
    }], { ...baseContext, runtimeCanBuild: false });
    expect(suggestions[0]?.disabled).toBe(true);
  });
});
