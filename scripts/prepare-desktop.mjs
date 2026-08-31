import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/service/desktop-service");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "public"), { recursive: true });

await build({
  entryPoints: [resolve(root, "apps/service/src/server.ts")],
  outfile: resolve(output, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  packages: "bundle",
  // Prefer published ESM entrypoints when a package exposes both forms. Some
  // UMD entrypoints (notably jsonc-parser) use runtime-relative require calls
  // that cannot survive a single-file desktop service bundle.
  mainFields: ["module", "main"],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  external: ["@napi-rs/keyring", "@napi-rs/keyring-*", "node-pty", "playwright", "playwright/*", "playwright-core", "playwright-core/*"],
});

await cp(resolve(root, "apps/web/dist"), resolve(output, "public"), { recursive: true });

const napiSource = resolve(root, "node_modules/@napi-rs");
const napiDestination = resolve(output, "node_modules/@napi-rs");
await mkdir(napiDestination, { recursive: true });
for (const packageName of (await readdir(napiSource)).filter((name) => name === "keyring" || name.startsWith("keyring-"))) {
  await cp(resolve(napiSource, packageName), resolve(napiDestination, packageName), { recursive: true });
}

for (const packageName of ["node-pty", "playwright", "playwright-core"]) {
  await cp(
    resolve(root, "node_modules", packageName),
    resolve(output, "node_modules", packageName),
    { recursive: true },
  );
}
