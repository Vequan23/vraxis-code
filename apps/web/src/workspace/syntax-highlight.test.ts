import { describe, expect, it } from "vitest";
import { highlightCode } from "./syntax-highlight.js";

describe("syntax highlighting", () => {
  it("highlights a known project language", () => {
    const result = highlightCode("export const ready: boolean = true;", "typescript");
    expect(result.highlighted).toBe(true);
    expect(result.html).toContain('class="hljs-keyword"');
    expect(result.html).toContain('class="hljs-literal"');
  });

  it("escapes unsupported file content instead of treating it as markup", () => {
    const result = highlightCode('<script>alert("unsafe")</script>', "unknown");
    expect(result.highlighted).toBe(false);
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("maps product language aliases to registered grammars", () => {
    expect(highlightCode("<template><main /></template>", "vue").highlighted).toBe(true);
    expect(highlightCode("const view = <main />;", "tsx").highlighted).toBe(true);
  });

  it("keeps markup escaped for known languages", () => {
    const result = highlightCode('<img src="x" onerror="alert(1)">', "html");
    expect(result.highlighted).toBe(true);
    expect(result.html).not.toContain("<img");
    expect(result.html).toContain("&lt;");
  });

  it("falls back to escaped plain text for very large files", () => {
    const result = highlightCode("const safe = true;\n".repeat(12_000), "typescript");
    expect(result.highlighted).toBe(false);
    expect(result.html).toContain("const safe = true;");
  });
});
