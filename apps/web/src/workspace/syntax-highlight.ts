import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const grammars = {
  bash,
  cpp,
  csharp,
  css,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, grammar] of Object.entries(grammars)) hljs.registerLanguage(name, grammar);

const languageAliases: Record<string, keyof typeof grammars> = {
  c: "cpp",
  html: "xml",
  jsx: "javascript",
  shell: "bash",
  toml: "ini",
  tsx: "typescript",
  vue: "xml",
};

const maximumHighlightedCharacters = 200_000;

export interface HighlightedCode {
  html: string;
  highlighted: boolean;
}

function escapeHtml(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function highlightCode(content: string, language: string): HighlightedCode {
  const normalized = languageAliases[language] ?? language;
  if (content.length > maximumHighlightedCharacters || !hljs.getLanguage(normalized)) {
    return { html: escapeHtml(content), highlighted: false };
  }
  try {
    return {
      html: hljs.highlight(content, { language: normalized, ignoreIllegals: true }).value,
      highlighted: true,
    };
  } catch {
    return { html: escapeHtml(content), highlighted: false };
  }
}
