import type { ActionChip, ActionChipId } from "../types";

export const ACTION_CHIPS: ActionChip[] = [
  {
    id: "explain",
    label: "Explain Code",
    icon: "search",
    description: "Explain selected code or text clearly",
  },
  {
    id: "fix",
    label: "Fix Bug",
    icon: "wrench",
    description: "Diagnose and fix the error",
  },
  {
    id: "refactor",
    label: "Refactor",
    icon: "code",
    description: "Refactor for clarity and performance",
  },
  {
    id: "summarize",
    label: "Summarize",
    icon: "list",
    description: "Condense into key points",
  },
  {
    id: "translate",
    label: "Translate",
    icon: "languages",
    description: "Translate to English (or target language)",
  },
  {
    id: "improve",
    label: "Improve",
    icon: "wand",
    description: "Polish writing quality and tone",
  },
  {
    id: "comment",
    label: "Comment",
    icon: "message",
    description: "Add clear inline documentation",
  },
];

const TEMPLATES: Record<ActionChipId, string> = {
  explain:
    "Explain the following thoroughly. Cover what it does, how it works, and any pitfalls. Use concise technical language.",
  fix: "Identify the bug or error in the following and provide a corrected version. Explain the root cause briefly, then show the fixed code.",
  refactor:
    "Refactor the following for readability, maintainability, and performance. Preserve behavior. Show the improved version and note key changes.",
  summarize:
    "Summarize the following into clear bullet points. Capture the essential ideas only, with no filler.",
  translate:
    "Translate the following into clear, natural English. If it is already English, improve fluency while preserving meaning.",
  improve:
    "Improve the writing quality of the following. Fix grammar, tighten phrasing, and keep the original voice.",
  comment:
    "Add clear, useful comments and docstrings to the following code. Do not change behavior. Return the fully commented code.",
};

export function buildActionPrompt(
  actionId: ActionChipId,
  userNote?: string,
): string {
  const base = TEMPLATES[actionId];
  if (userNote && userNote.trim()) {
    return `${base}\n\nAdditional instruction: ${userNote.trim()}`;
  }
  return base;
}

export const DEFAULT_SETTINGS_KEY = "spotai.settings.v1";

export const BUILTIN_CLOUD_MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: "groq" },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", provider: "groq" },
  { id: "deepseek-chat", name: "DeepSeek Chat", provider: "deepseek" },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "groq" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner", provider: "deepseek" },
] as const;

export const PROVIDER_META: Record<
  string,
  { label: string; mode: "local" | "cloud"; color: string }
> = {
  ollama: { label: "Ollama", mode: "local", color: "#22d3ee" },
  lmstudio: { label: "LM Studio", mode: "local", color: "#a78bfa" },
  anthropic: { label: "Anthropic", mode: "cloud", color: "#f59e0b" },
  openai: { label: "OpenAI", mode: "cloud", color: "#34d399" },
  groq: { label: "Groq", mode: "cloud", color: "#f472b6" },
  deepseek: { label: "DeepSeek", mode: "cloud", color: "#60a5fa" },
};
