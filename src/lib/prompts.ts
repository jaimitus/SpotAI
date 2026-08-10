import type { ActionChip, ActionChipId, Language, PromptTemplate } from "../types";

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
  pt: {
    explain:
      "Explica detalhadamente o que se segue em português. Descreve o que faz, como funciona e possíveis problemas. Usa linguagem técnica clara e concisa.",
    fix: "Identifica o erro ou falha no que se segue e fornece a versão corrigida. Explica brevemente a causa raiz em português e mostra o código arranjado.",
    refactor:
      "Refatora o que se segue para melhorar legibilidade, manutenção e desempenho em português. Conserva o comportamento original e explica as mudanças-chave em português.",
    summarize:
      "Resume o que se segue em pontos-chave claros em português. Captura apenas as ideias essenciais de forma concisa.",
    translate:
      "Traduz o que se segue para um português claro, natural e fluido.",
    improve:
      "Melhora a qualidade de escrita do que se segue em português. Corrige gramática e ortografia e melhora a fluidez mantendo o tom original.",
    comment:
      "Adiciona comentários claros e úteis em português ao seguinte código. Mantém o comportamento original e devolve o código comentado.",
  },
  fr: {
    explain:
      "Expliquez ce qui suit en détail en français. Décrivez ce que cela fait, comment cela fonctionne et les pièges éventuels. Utilisez un langage technique clair et concis.",
    fix: "Identifiez le bug ou l'erreur dans ce qui suit et fournissez la version corrigée. Expliquez brièvement la cause en français, puis montrez le code corrigé.",
    refactor:
      "Refactorisez ce qui suit pour la lisibilité, la maintenabilité et la performance. Conservez le comportement et expliquez les changements clés en français.",
    summarize:
      "Résumez ce qui suit en points clés clairs en français. Ne retenez que les idées essentielles, sans remplissage.",
    translate:
      "Traduisez ce qui suit en français clair, naturel et fluide.",
    improve:
      "Améliorez la qualité rédactionnelle de ce qui suit en français. Corrigez la grammaire et resserrez la formulation en gardant le ton d'origine.",
    comment:
      "Ajoutez des commentaires et docstrings clairs et utiles en français au code suivant. Conservez le comportement et renvoyez le code commenté.",
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

/** Curated prompt templates shown in the `/` palette and editable in Settings. */
export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "security-review",
    label: "Security review",
    prompt:
      "Review the following for security vulnerabilities (injection, auth, secrets, input validation). List each issue with severity and a fix:",
  },
  {
    id: "unit-tests",
    label: "Write unit tests",
    prompt:
      "Write comprehensive unit tests for the following code. Cover edge cases and follow the project's test conventions:",
  },
  {
    id: "sql-optimize",
    label: "Optimize SQL",
    prompt: "Optimize this SQL query for speed: add appropriate indexes and explain the changes:",
  },
  {
    id: "explain-simple",
    label: "Explain simply",
    prompt: "Explain the following in simple terms a non-expert can understand:",
  },
  {
    id: "commit-message",
    label: "Write commit message",
    prompt: "Write a concise conventional-commit message for the following changes:",
  },
];

export const DEFAULT_SETTINGS_KEY = "spotai.settings.v1";
export const SPOTAI_REPO_URL = "https://github.com/jaimitus/SpotAI";

export const BUILTIN_CLOUD_MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: "groq" },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", provider: "groq" },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "groq" },
  { id: "deepseek-chat", name: "DeepSeek Chat", provider: "deepseek" },
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
