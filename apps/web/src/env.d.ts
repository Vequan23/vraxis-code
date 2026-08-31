/// <reference types="vite/client" />

interface DirectoryPickerResult {
  cancelled: boolean;
  path?: string;
}

interface Window {
  vraxisDesktop?: {
    chooseDirectory?(): Promise<DirectoryPickerResult>;
    onOpenUrl?(listener: (url: string) => void): () => void;
  };
}
