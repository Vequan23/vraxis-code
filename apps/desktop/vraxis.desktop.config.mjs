import { defineDesktopApp } from "@vraxis/desktop";

export default defineDesktopApp({
  schemaVersion: 1,
  app: {
    id: "vraxis-code",
    name: "Vraxis Code",
    author: "Vraxis",
    description: "Direct coding agents and review their work from one local workspace.",
    bundleId: "com.vraxis.code",
  },
  source: {
    kind: "service",
    authentication: "desktop-token",
    bundle: {
      directory: "../service/desktop-service",
      entry: "server.js",
      runtime: "node",
    },
    url: "http://127.0.0.1:{port}/app",
    healthcheck: "http://127.0.0.1:{port}/api/health",
    readyTimeoutMs: 30_000,
  },
  branding: {
    icon: "assets/icon-1024.png",
    macIcon: "assets/icon-macos.icns",
    windowsIcon: "assets/icon-windows.ico",
    linuxIcon: "assets/icon-linux.png",
    backgroundColor: "#101212",
  },
  window: {
    width: 1480,
    height: 940,
    minWidth: 760,
    minHeight: 560,
    titleBarStyle: "hiddenInset",
  },
  security: {
    externalLinks: "browser",
    allowedNavigationOrigins: [],
    permissions: [],
  },
  integrations: {
    directoryPicker: {
      title: "Choose a project folder",
      buttonLabel: "Add project",
    },
    protocols: [{ scheme: "vraxis-code", name: "Vraxis Code task" }],
  },
  packaging: {
    outputDirectory: "../../out",
    asar: true,
    overwrite: true,
    appCategoryType: "public.app-category.developer-tools",
  },
});
