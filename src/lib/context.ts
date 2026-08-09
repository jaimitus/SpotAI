import type { ContextKind } from "../types";

const URL_PATTERN = /^(https?:\/\/|www\.)\S+$/i;
const ERROR_PATTERN = /(traceback|stack trace|uncaught\s+(exception|error)|fatal\s+error|panic:|exception in thread|npm\s+err!|error\s*[:：]\s*|failed\s+to\s+|http\s+[45]\d\d|\b[45]\d\d\s+(error|bad|unauthorized|forbidden|not found))/i;
const CODE_PATTERN = /(^|\n)\s*(import\s+|from\s+['"]|export\s+|const\s+\w+\s*=|let\s+\w+\s*=|function\s+\w+|class\s+\w+|def\s+\w+|fn\s+\w+|public\s+(class|static)|#include\s*[<"]|package\s+\w+|using\s+System)/m;
const CODE_SYMBOL_PATTERN = /[{};]|=>|===|!==|\b(console\.log|async\s+await|SELECT\s+.+\s+FROM|npm\s+(run|install)|git\s+(status|diff|log))\b/i;

export function classifyContext(value: string): ContextKind {
  const text = value.trim();
  if (!text) return "empty";
  if (URL_PATTERN.test(text)) return "url";
  if (ERROR_PATTERN.test(text) && (text.includes("\n") || text.length > 40)) {
    return "error";
  }
  if (/^\s*[\[{]/.test(text)) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      // A code block can also start with a brace; continue with code detection.
    }
  }
  if (CODE_PATTERN.test(text) || (CODE_SYMBOL_PATTERN.test(text) && text.includes("\n"))) {
    return "code";
  }
  return "text";
}
