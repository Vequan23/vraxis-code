import assert from "node:assert/strict";
import test from "node:test";
import { builtInAgentSkills } from "@vraxis/agent-v/skills";
import {
  activeRuntimeSkillNames,
  attachedSkillArtifacts,
  attachedSkillMetadata,
  attachedSkillsFromMetadata,
  modeRuntimeSelection,
  runtimeAgentSkills,
  runtimeAgentSkillsFromMetadata,
  verificationRecipeSkill,
  vraxisCodeSkill,
} from "../src/runtimes/mode-agent-runtime.js";
import { defineSkill } from "@vraxis/agent-v";

test("maps session modes to agent-v starter recipes", () => {
  assert.deepEqual(modeRuntimeSelection("ask"), {
    recipe: "research",
    extraSkillIds: [builtInAgentSkills.repositoryComprehension.id],
  });
  assert.deepEqual(modeRuntimeSelection("plan"), { recipe: "planning", extraSkillIds: [] });
  assert.equal(modeRuntimeSelection("build").recipe, "frontend");
  assert.equal(modeRuntimeSelection("review").recipe, "security");
});

test("includes product and attached guidance skills without granting tools", () => {
  const attached = [{
    reference: { id: "abc", name: "UX fundamentals", version: "1.0.0" },
    skill: defineSkill({
      id: "ux-fundamentals",
      name: "UX fundamentals",
      version: "1.0.0",
      description: "UX guidance",
      instructions: "Preserve visible system status.",
      tools: ["create-text"],
      trust: "local",
    }),
  }];
  const skills = runtimeAgentSkills("ask", attached);
  const attachedSkill = skills.find((skill) => skill.id === "attached-abc");
  assert.ok(attachedSkill);
  assert.deepEqual(attachedSkill?.tools, []);
  assert.match(attachedSkill?.instructions ?? "", /guidance only/);
  assert.ok(skills.some((skill) => skill.id === vraxisCodeSkill.id));
  assert.ok(skills.some((skill) => skill.id === verificationRecipeSkill.id));
  assert.match(vraxisCodeSkill.instructions, /Do not request verification because an external page failed/);
  assert.match(vraxisCodeSkill.instructions, /Do not retry the same URL/);
  assert.match(verificationRecipeSkill.instructions, /If the current page is not the configured target/);
  assert.ok(activeRuntimeSkillNames("plan").includes("Project architecture"));
});

test("round-trips attached skill metadata for runtime reconstruction", () => {
  const metadata = attachedSkillMetadata([{
    reference: { id: "abc", name: "UX fundamentals", version: "1.0.0" },
    skill: defineSkill({
      id: "ux-fundamentals",
      name: "UX fundamentals",
      version: "1.0.0",
      description: "UX guidance",
      instructions: "Preserve visible system status.",
      tools: [],
      trust: "local",
    }),
  }]);
  const restored = attachedSkillsFromMetadata(metadata);
  assert.deepEqual(restored, metadata);
  assert.equal(runtimeAgentSkillsFromMetadata("ask", restored).find((skill) => skill.id === "attached-abc")?.name, "UX fundamentals");
});

test("builds attached skill artifacts for local runtime runs", () => {
  const metadata = attachedSkillMetadata([{
    reference: { id: "abc", name: "UX fundamentals", version: "1.0.0" },
    skill: defineSkill({
      id: "ux-fundamentals",
      name: "UX fundamentals",
      version: "1.0.0",
      instructions: "Preserve visible system status.",
      tools: [],
      trust: "local",
    }),
  }]);
  assert.deepEqual(attachedSkillArtifacts(metadata), [{
    id: "attached-skill:abc",
    uri: "vraxis-skill:///abc/1.0.0",
    mediaType: "text/markdown",
    title: "UX fundamentals",
    content: "Preserve visible system status.",
    metadata: { skillId: "abc", version: "1.0.0" },
  }]);
});
