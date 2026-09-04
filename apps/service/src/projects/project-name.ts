export function normalizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new TypeError("Project name must be 1-64 characters.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new TypeError("Project name is not valid.");
  }
  if (/[/\\:\0]/.test(trimmed)) {
    throw new TypeError("Project name cannot contain path separators.");
  }
  return trimmed;
}
