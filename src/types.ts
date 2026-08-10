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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
  history?: ChatMessage[] | null;
  /** Optional pasted screenshot as a data URL ("data:<mime>;base64,..."). */
  imageDataUrl?: string | null;
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

export type Language = "en" | "es" | "de" | "pt" | "fr";

export type ThemePreference = "dark" | "light" | "system";

export interface CustomAction {
  id: string;
  label: string;
  prompt: string;
  icon?: "search" | "wrench" | "code" | "list" | "languages" | "wand" | "message" | "sparkles";
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel?: string;
}

export interface AppSettings {
  language: Language;
  theme?: ThemePreference;
  ollamaHost: string;
  lmstudioHost: string;
  defaultProvider: string;
  defaultModel: string;
  globalShortcut: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  customActions: CustomAction[];
  customProviders: CustomProvider[];
  autostart?: boolean;
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

export interface Conversation {
  id: string;
  title: string;
  /** True once the user has manually renamed the chat; auto-titles stop updating. */
  renamed?: boolean;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface CapturedImage {
  mime: string;
  dataUrl: string;
}

export type ContextKind = "empty" | "text" | "code" | "error" | "json" | "url";
