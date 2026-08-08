export type ProviderId =
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "groq"
  | "deepseek";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  size?: number | null;
  modified_at?: string | null;
}

export interface PromptRequest {
  provider: string;
  model: string;
  prompt: string;
  contextText?: string | null;
  apiKey?: string | null;
  systemPrompt?: string | null;
  host?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  requestId: string;
}

export interface TokenEvent {
  requestId: string;
  token: string;
  done: boolean;
  cancelled: boolean;
  error?: string | null;
}

export interface ApiKeys {
  openai?: string | null;
  anthropic?: string | null;
  groq?: string | null;
  deepseek?: string | null;
}

export interface ApiKeyStatus {
  openai?: string | null;
  anthropic?: string | null;
  groq?: string | null;
  deepseek?: string | null;
}

export type Language = "en" | "es" | "de";

export interface CustomAction {
  id: string;
  label: string;
  prompt: string;
  icon?: "search" | "wrench" | "code" | "list" | "languages" | "wand" | "message" | "sparkles";
}

export interface AppSettings {
  language: Language;
  ollamaHost: string;
  lmstudioHost: string;
  defaultProvider: ProviderId;
  defaultModel: string;
  globalShortcut: string;
  temperature: number;
  maxTokens: number;
  customActions: CustomAction[];
}

export interface HealthStatus {
  ollama: boolean;
  ollamaVersion?: string | null;
}

export interface ShortcutStatus {
  registered: boolean;
  error?: string | null;
}

export type ActionChipId =
  | "explain"
  | "refactor"
  | "summarize"
  | "translate"
  | "fix"
  | "improve"
  | "comment";

export interface ActionChip {
  id: ActionChipId;
  label: string;
  icon: "search" | "wrench" | "code" | "list" | "languages" | "wand" | "message";
  description: string;
}

export type StreamStatus = "idle" | "streaming" | "done" | "error";
