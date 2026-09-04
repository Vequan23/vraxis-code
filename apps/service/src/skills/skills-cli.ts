const skillsCliAgentByRuntime: Record<string, string> = {
  codex: "codex",
  "claude-code": "claude-code",
  cursor: "cursor",
  opencode: "opencode",
};

export function skillsCliAgentsForRuntimes(runtimeIds: readonly string[]): string[] {
  const agents = runtimeIds
    .map((runtimeId) => skillsCliAgentByRuntime[runtimeId])
    .filter((agent): agent is string => Boolean(agent));
  return [...new Set(agents.length ? agents : ["codex", "claude-code", "cursor", "opencode"])];
}

export function buildSkillsInstallInvocation(input: {
  source: string;
  global?: boolean;
  skillNames?: readonly string[];
  agents: readonly string[];
}): { command: string; args: readonly string[] } {
  const args = ["--yes", "skills", "add", input.source.trim(), "-y", "--copy"];
  if (input.global) args.push("-g");
  for (const agent of input.agents) args.push("-a", agent);
  for (const skillName of input.skillNames ?? []) args.push("-s", skillName);
  return { command: "npx", args };
}

export function formatSkillsInstallScope(input: {
  source: string;
  global?: boolean;
  skillNames?: readonly string[];
  agents: readonly string[];
}): string {
  const parts = [
    input.source.trim(),
    input.global ? "global" : "project",
    ...(input.skillNames?.length ? [input.skillNames.join(", ")] : ["all skills"]),
    input.agents.join(", "),
  ];
  return parts.join(" · ");
}
