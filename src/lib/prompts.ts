import type { ActionChip, ActionChipId, Language } from "../types";

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
    description: "Translate to target language",
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

const TEMPLATES: Record<Language, Record<ActionChipId, string>> = {
  en: {
    explain:
      "Explain the following thoroughly in clear English. Cover what it does, how it works, and any pitfalls. Use concise technical language.",
    fix: "Identify the bug or error in the following and provide a corrected version. Explain the root cause briefly in English, then show the fixed code.",
    refactor:
      "Refactor the following for readability, maintainability, and performance. Preserve behavior. Show the improved version and note key changes in English.",
    summarize:
      "Summarize the following into clear bullet points in English. Capture essential ideas only, with no filler.",
    translate:
      "Translate the following into clear, natural English.",
    improve:
      "Improve the writing quality of the following in English. Fix grammar, tighten phrasing, and keep the original voice.",
    comment:
      "Add clear, useful comments and docstrings in English to the following code. Return the fully commented code.",
  },
  es: {
    explain:
      "Explica lo siguiente detalladamente en español. Describe qué hace, cómo funciona y posibles inconvenientes. Usa un lenguaje técnico claro y conciso.",
    fix: "Identifica el error o fallo en lo siguiente y proporciona la versión corregida. Explica brevemente la causa raíz en español y muestra el código arreglado.",
    refactor:
      "Refactoriza lo siguiente para mejorar legibilidad, mantenibilidad y rendimiento en español. Conserva el comportamiento original y explica los cambios clave en español.",
    summarize:
      "Resume lo siguiente en puntos clave claros en español. Captura solo las ideas esenciales de forma concisa.",
    translate:
      "Traduce lo siguiente a un español claro, natural y fluido.",
    improve:
      "Mejora la calidad de redacción de lo siguiente en español. Corrige gramática, ortografía y mejora la fluidez manteniendo el tono original.",
    comment:
      "Añade comentarios claros y útiles en español al siguiente código. Mantén el comportamiento original y devuelve el código comentado.",
  },
  de: {
    explain:
      "Erklären Sie Folgendes ausführlich auf Deutsch. Beschreiben Sie, was es tut, wie es funktioniert und etwaige Fallstricke. Verwenden Sie präzise Sprache.",
    fix: "Identifizieren Sie den Fehler in Folgendem und liefern Sie eine korrigierte Version. Erklären Sie die Ursache kurz auf Deutsch und zeigen Sie den behobenen Code.",
    refactor:
      "Refaktorisieren Sie Folgendes für Lesbarkeit, Wartbarkeit und Performance. Verhalten beibehalten und wichtige Änderungen auf Deutsch erklären.",
    summarize:
      "Fassen Sie Folgendes in klaren Stichpunkten auf Deutsch zusammen. Nur die wesentlichen Ideen erfassen.",
    translate:
      "Übersetzen Sie Folgendes in klares, natürliches Deutsch.",
    improve:
      "Verbessern Sie die Schreibqualität von Folgendem auf Deutsch. Grammatik korrigieren und Fluss verbessern.",
    comment:
      "Fügen Sie klaren, nützlichen Code-Kommentaren auf Deutsch hinzu. Code-Verhalten beibehalten und vollständig ausgeben.",
  },
};

export function buildActionPrompt(
  actionId: ActionChipId,
  userNote?: string,
  lang: Language = "en",
): string {
  const langTemplates = TEMPLATES[lang] || TEMPLATES.en;
  const base = langTemplates[actionId] || TEMPLATES.en[actionId];
  if (userNote && userNote.trim()) {
    return `${base}\n\nAdditional instruction: ${userNote.trim()}`;
  }
  return base;
}

export const DEFAULT_SETTINGS_KEY = "spotai.settings.v1";
export const SPOTAI_REPO_URL = "https://github.com/jaimitus/SpotAI";
export const SPOTAI_VERSION = "1.1.0";

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
  { label: string; mode: "local" | "color"; color: string }
> = {
  ollama: { label: "Ollama", mode: "local", color: "#22d3ee" },
  lmstudio: { label: "LM Studio", mode: "local", color: "#a78bfa" },
  anthropic: { label: "Anthropic", mode: "color", color: "#f59e0b" },
  openai: { label: "OpenAI", mode: "color", color: "#34d399" },
  groq: { label: "Groq", mode: "color", color: "#f472b6" },
  deepseek: { label: "DeepSeek", mode: "color", color: "#60a5fa" },
};
