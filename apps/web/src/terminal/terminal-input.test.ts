import { describe, expect, it } from "vitest";
import { configureTerminalInput } from "./terminal-input.js";

describe("terminal input", () => {
  it("identifies xterm's hidden textarea as a non-credential input", () => {
    const attributes = new Map<string, string>();
    const textarea = {
      setAttribute(name: string, value: string) { attributes.set(name, value); },
    } as unknown as HTMLTextAreaElement;

    configureTerminalInput(textarea);

    expect(Object.fromEntries(attributes)).toMatchObject({
      "aria-label": "Terminal input",
      autocomplete: "off",
      name: "vraxis-terminal-input",
      "data-form-type": "other",
      "data-1p-ignore": "true",
      "data-lpignore": "true",
      "data-bwignore": "true",
      "data-protonpass-ignore": "true",
    });
  });
});
