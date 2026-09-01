/// <reference types="vite/client" />

interface DirectoryPickerResult {
  cancelled: boolean;
  path?: string;
}

interface BrowserViewLayout {
  sessionId: string;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

interface BrowserViewStateEvent {
  sessionId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface Window {
  vraxisDesktop?: {
    chooseDirectory?(): Promise<DirectoryPickerResult>;
    onOpenUrl?(listener: (url: string) => void): () => void;
    browserView?: {
      setLayout(layout: BrowserViewLayout): Promise<void>;
      onState(listener: (state: BrowserViewStateEvent) => void): () => void;
    };
  };
}
