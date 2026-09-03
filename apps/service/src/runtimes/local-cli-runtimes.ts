import {
  builtInRuntimes,
  LocalCliRuntimeEngine,
  type LocalCliEngineOptions,
  type LocalRuntimeDefinition,
  type RuntimeInvocationInput,
} from "@vraxis/agent-v/local-cli";

/** Cursor Agent requires explicit workspace trust for non-interactive `-p` runs. */
function cursorInvocationWithTrust(
  buildInvocation: LocalRuntimeDefinition["buildInvocation"],
  input: RuntimeInvocationInput,
): readonly string[] {
  const args = [...buildInvocation(input)];
  const printIndex = args.indexOf("-p");
  if (printIndex >= 0 && !args.some((arg) => arg === "--trust" || arg === "-f" || arg === "--yolo")) {
    args.splice(printIndex + 1, 0, "--trust");
  }
  return args;
}

function withCursorTrustFlag(runtimes: readonly LocalRuntimeDefinition[]): LocalRuntimeDefinition[] {
  return runtimes.map((runtime) => {
    if (runtime.id !== "cursor") return runtime;
    const buildInvocation = runtime.buildInvocation.bind(runtime);
    return {
      ...runtime,
      buildInvocation(input: RuntimeInvocationInput) {
        return cursorInvocationWithTrust(buildInvocation, input);
      },
    };
  });
}

export const vraxisLocalCliRuntimes = withCursorTrustFlag(builtInRuntimes);

export function createLocalCliRuntimeEngine(options: LocalCliEngineOptions = {}): LocalCliRuntimeEngine {
  return new LocalCliRuntimeEngine({ ...options, runtimes: vraxisLocalCliRuntimes });
}
