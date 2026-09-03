const harnessLogoIds = new Set(["codex", "claude-code", "cursor", "opencode", "antigravity"]);

export function harnessLogoUrl(runtimeId: string): string | undefined {
  return harnessLogoIds.has(runtimeId) ? `/brand/harnesses/${runtimeId}.png` : undefined;
}
