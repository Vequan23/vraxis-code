export interface DesktopDirectoryBridge {
  chooseDirectory(): Promise<{ cancelled: boolean; path?: string }>;
}

export async function chooseProjectFolder<T>(
  desktop: DesktopDirectoryBridge | undefined,
  register: (path: string) => Promise<T>,
  browserFallback: () => Promise<T | null>,
): Promise<T | null> {
  if (!desktop) return browserFallback();
  const selected = await desktop.chooseDirectory();
  if (selected.cancelled || !selected.path) return null;
  return register(selected.path);
}
