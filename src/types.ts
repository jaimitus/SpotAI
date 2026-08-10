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
  /** Advanced sampling parameters for better control over generation */
  topP?: number | null;
  topK?: number | null;
  repeatPenalty?: number | null;
  seed?: number | null;
  /** Context window size (num_ctx in Ollama) - crucial for local models */
  numCtx?: number | null;
  /** Maximum tokens to predict (num_predict in Ollama) */
  numPredict?: number | null;
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

export interface PromptTemplate {
  id: string;
  label: string;
  prompt: string;
}

export type SystemActionId =
  | "new"
  | "theme"
  | "settings"
  | "hide"
  | "clear"
  | "capture"
  | "incognito"
  | "exec"
  | "rag";

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
  /** Advanced sampling parameters for Ollama/LLM generation */
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  seed?: number;
  /** Context window size (num_ctx in Ollama) - crucial for local models */
  numCtx?: number;
  /** Maximum tokens to predict (num_predict in Ollama) */
  numPredict?: number;
  customActions: CustomAction[];
  customProviders: CustomProvider[];
  promptTemplates?: PromptTemplate[];
  autostart?: boolean;
  /** When enabled, quick-action results are inserted into the previous app
   *  automatically; when disabled they are only copied to the clipboard. */
  autoInsertQuickActions?: boolean;
  /** Speech-to-text engine preference. */
  voiceEngine?: string;
  /** Name of the microphone chosen in Settings (empty = OS default). */
  selectedMic?: string;
  /** Language Whisper transcribes in ("auto" = detect from the audio). */
  voiceLanguage?: string;
  /** Whisper model size selected in Settings ("tiny" | "base" | "small"). */
  whisperModel?: string;
}

export interface MicDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface HealthStatus {
  ollama: boolean;
  ollamaVersion?: string | null;
}

export interface CapturedScreen {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface QuickActionPayload {
  action: string;
  text: string;
}

export interface OllamaPsModel {
  name: string;
  size: number;
  sizeVram: number;
  expiresAt?: string | null;
}

export interface ShortcutStatus {
  registered: boolean;
  error?: string | null;
}

export type VoiceEngine = "native" | "whisper";

export interface VoiceCaptureResult {
  path: string;
  durationSecs: number;
  engine: VoiceEngine;
}

export interface VoiceStatusEvent {
  recording: boolean;
  error?: string | null;
}

/** Snapshot of the backend capture state, queried to reconcile the UI (e.g.
 *  after a start that raced with the Alt+V shortcut). */
export interface VoiceStateEvent {
  recording: boolean;
  engine: VoiceEngine;
  /** Whisper recognition language currently pinned (null = auto). */
  language?: string | null;
}

export interface VoiceStoppedEvent {
  path: string;
  durationSecs: number;
  engine: VoiceEngine;
}

export interface VoiceTranscribedEvent {
  text?: string | null;
  error?: string | null;
}

export interface WhisperModelStatus {
  id: string;
  size: number;
}

export interface WhisperStatus {
  installed: boolean;
  installing: boolean;
  /** Size of the ACTIVE model file (0 when not downloaded). */
  modelSize: number;
  /** Id of the active model ("tiny" | "base" | "small"). */
  activeModel?: string;
  /** Every model already downloaded, with its size. */
  installedModels?: WhisperModelStatus[];
}

export interface WhisperProgressEvent {
  phase: "binary" | "model";
  received: number;
  total: number;
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
  /** Pinned conversations float to the top of the chat list. */
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface CapturedImage {
  mime: string;
  dataUrl: string;
}

export type ContextKind = "empty" | "text" | "code" | "error" | "json" | "url";

/** Shell command for CLI injection feature */
export interface ShellCommand {
  command: string;
  shell: string;
  args: string[];
  description: string;
  safetyLevel: 'safe' | 'caution' | 'dangerous';
}
