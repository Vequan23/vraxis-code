import { spawn, spawnSync } from "node:child_process";

const servicePort = Number(process.env.PORT ?? 4317);

const contracts = spawnSync("npm", ["run", "build:contracts"], { stdio: "inherit", shell: false });
if (contracts.status !== 0) process.exit(contracts.status ?? 1);

const children = [
  spawn("npm", ["run", "dev:service"], { stdio: "inherit", shell: false, env: { ...process.env, PORT: String(servicePort) } }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", shell: false }),
];

let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error.message);
    close(1);
  });
  child.once("exit", (code, signal) => {
    if (!closing && code !== 0 && signal !== "SIGTERM") {
      console.error(
        `A dev process exited unexpectedly. If the service failed with EADDRINUSE on ${servicePort}, stop the other listener with: lsof -ti tcp:${servicePort} | xargs kill`,
      );
      close(code ?? 1);
    }
  });
}

process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
