import type {
  ApiKeyStatus,
  ApiKeys,
  AppSettings,
  CapturedScreen,
  HealthStatus,
  MicDevice,
  ModelInfo,
  OllamaPsModel,
  PromptRequest,
  QuickActionPayload,
  ShortcutStatus,
  TokenEvent,
  VoiceCaptureResult,
  VoiceStateEvent,
  VoiceStatusEvent,
  VoiceStoppedEvent,
  VoiceTranscribedEvent,
  WhisperProgressEvent,
  WhisperStatus,
} from "../types";
import { BUILTIN_CLOUD_MODELS, DEFAULT_PROMPT_TEMPLATES } from "./prompts";

const SETTINGS_KEY = "spotai.settings.v1";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new Error(
      "SpotAI requires the Tauri desktop runtime. Start it with `npx tauri dev`.",
    );
  }
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

type Unlisten = () => void;

export async function listenTokenEvents(
  handler: (event: TokenEvent) => void,
): Promise<Unlisten> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TokenEvent>("llm-token", (event) => handler(event.payload));
}

export async function listenWindowShown(handler: () => void): Promise<Unlisten> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen("window-shown", handler);
}

export async function listenCapturedContext(
  handler: (text: string) => void,
): Promise<Unlisten> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("context-captured", (event) => handler(event.payload));
}

export async function listenQuickAction(
  handler: (payload: QuickActionPayload) => void,
): Promise<Unlisten> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<QuickActionPayload>("quick-action", (event) =>
    handler(event.payload),
  );
}

export async function captureScreens(): Promise<CapturedScreen[]> {
  if (!isTauri()) return [];
  return invoke<CapturedScreen[]>("capture_screens");
}

export async function ollamaPullModel(
  name: string,
  host?: string,
): Promise<void> {
  await invoke("ollama_pull_model", { name, host: host ?? null });
}

export async function ollamaDeleteModel(
  name: string,
  host?: string,
): Promise<void> {
  await invoke("ollama_delete_model", { name, host: host ?? null });
}

export async function fetchOllamaPs(host?: string): Promise<OllamaPsModel[]> {
  try {
    return await invoke<OllamaPsModel[]>("fetch_ollama_ps", {
      host: host ?? null,
    });
  } catch {
    return [];
  }
}

export async function getClipboardText(): Promise<string> {
  if (isTauri()) return invoke<string>("get_clipboard_text");
  return navigator.clipboard?.readText?.() ?? "";
}

export async function setClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    await invoke("set_clipboard_text", { text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function autoInsertText(text: string): Promise<void> {
  await invoke("auto_insert_text", { text });
}

export async function registerShortcut(shortcut: string): Promise<ShortcutStatus> {
  if (!isTauri()) {
    return { registered: false, error: "The Tauri desktop runtime is not active" };
  }
  return invoke<ShortcutStatus>("register_shortcut", { shortcut });
}

export async function fetchLocalModels(host?: string): Promise<ModelInfo[]> {
  try {
    return await invoke<ModelInfo[]>("fetch_local_models", { host: host ?? null });
  } catch {
    return [];
  }
}

export async function fetchLmStudioModels(host?: string): Promise<ModelInfo[]> {
  try {
    return await invoke<ModelInfo[]>("fetch_lmstudio_models", {
      host: host ?? null,
    });
  } catch {
    return [];
  }
}

export async function fetchOpenAICompatibleModels(baseUrl: string): Promise<ModelInfo[]> {
  try {
    return await invoke<ModelInfo[]>("fetch_openai_compatible_models", {
      host: baseUrl,
    });
  } catch {
    return [];
  }
}

export async function fetchCloudModels(): Promise<ModelInfo[]> {
  if (isTauri()) return invoke<ModelInfo[]>("fetch_cloud_models");
  return BUILTIN_CLOUD_MODELS.map((model) => ({ ...model }));
}

export async function sendPromptStream(request: PromptRequest): Promise<void> {
  await invoke("send_prompt_stream", {
    provider: request.provider,
    model: request.model,
    prompt: request.prompt,
    contextText: request.contextText ?? null,
    apiKey: request.apiKey ?? null,
    host: request.host ?? null,
    systemPrompt: request.systemPrompt ?? null,
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
    history: request.history ?? null,
    imageDataUrl: request.imageDataUrl ?? null,
    requestId: request.requestId ?? null,
    topP: request.topP ?? null,
    topK: request.topK ?? null,
    repeatPenalty: request.repeatPenalty ?? null,
    seed: request.seed ?? null,
    numCtx: request.numCtx ?? null,
    numPredict: request.numPredict ?? null,
  });
}

export async function cancelStream(): Promise<void> {
  if (isTauri()) await invoke("cancel_stream");
}

export async function hideWindow(): Promise<void> {
  if (isTauri()) await invoke("hide_window");
}

export async function startDraggingWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  await invoke("save_api_keys", { keys });
}

export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
  if (!isTauri()) return {};
  return invoke<ApiKeyStatus>("get_api_key_status");
}

export async function deleteApiKey(provider: string): Promise<void> {
  await invoke("delete_api_key", { provider });
}

export async function saveCustomApiKey(provider: string, key: string): Promise<void> {
  await invoke("save_custom_api_key", { provider, key });
}

export async function deleteCustomApiKey(provider: string): Promise<void> {
  await invoke("delete_custom_api_key", { provider });
}

export async function getCustomApiKeyStatus(
  provider: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("get_custom_api_key_status", { provider });
}

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    language: "en",
    theme: "dark",
    ollamaHost: "http://127.0.0.1:11434",
    lmstudioHost: "http://127.0.0.1:1234",
    defaultProvider: "ollama",
    defaultModel: "",
    globalShortcut: "Alt+Space",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 4096,
    // Advanced sampling params default to unset so out-of-the-box requests are
    // byte-identical to previous versions. They are only sent once the user
    // explicitly moves a slider in Settings (avoiding e.g. top_k reaching the
    // OpenAI API, which rejects unknown arguments).
    topP: undefined,
    topK: undefined,
    repeatPenalty: undefined,
    seed: undefined,
    numCtx: undefined,
    numPredict: undefined,
    customActions: [],
    customProviders: [],
    promptTemplates: DEFAULT_PROMPT_TEMPLATES,
    autostart: false,
    autoInsertQuickActions: true,
    voiceEngine: "native",
    voiceLanguage: "auto",
    whisperModel: "tiny",
  };
  try {
    const value = localStorage.getItem(SETTINGS_KEY);
    if (!value) return defaults;
    const parsed = JSON.parse(value) as Partial<AppSettings>;
    const merged = { ...defaults, ...parsed };
    // Smart default for the recognition language: when the user has never
    // pinned one, follow the UI language. Whisper's auto-detection on the tiny
    // model tends to assume English and transcribe nonsense on other languages,
    // so a Spanish UI user gets `-l es` without touching Settings. The explicit
    // value wins once saved.
    if (!parsed.voiceLanguage && merged.language && merged.language !== "en") {
      merged.voiceLanguage = merged.language;
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function checkOllamaHealth(host?: string): Promise<HealthStatus> {
  try {
    return await invoke<HealthStatus>("check_ollama_health", {
      host: host ?? null,
    });
  } catch {
    return { ollama: false, ollamaVersion: null };
  }
}

export function resolveHost(
  provider: string,
  settings: AppSettings,
): string | null {
  if (provider === "ollama") return settings.ollamaHost;
  if (provider === "lmstudio") return settings.lmstudioHost;
  if (provider.startsWith("custom:")) {
    const id = provider.slice("custom:".length);
    return settings.customProviders?.find((cp) => cp.id === id)?.baseUrl ?? null;
  }
  return null;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("open_external_url", { url });
      return;
    } catch {
      // Fallback
    }
  }
  window.open(url, "_blank", "noreferrer");
}

export async function exportSettingsToFile(path: string, content: string): Promise<void> {
  await invoke("export_settings_to_file", { path, content });
}

/** Writes arbitrary text (e.g. a Markdown chat export) to a picked path. */
export async function exportTextToFile(path: string, content: string): Promise<void> {
  await invoke("write_text_to_file", { path, content });
}

/** Browser fallback: downloads the text as a file through an anchor click. */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importSettingsFromFile(path: string): Promise<string> {
  return invoke<string>("import_settings_from_file", { path });
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: defaultName, filters: [{ name: "JSON", extensions: ["json"] }] });
}

export async function pickOpenPath(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
}

export async function confirmDialog(message: string): Promise<boolean> {
  if (!isTauri()) return window.confirm(message);
  const { confirm } = await import("@tauri-apps/plugin-dialog");
  return confirm(message, { kind: "warning" });
}

// ── Voice input ───────────────────────────────────────────────────────────

export async function startVoiceCapture(): Promise<void> {
  await invoke("start_voice_capture");
}

export async function stopVoiceCapture(): Promise<VoiceCaptureResult> {
  return invoke<VoiceCaptureResult>("stop_voice_capture");
}

/** Returns the backend's current capture state so the UI can reconcile (e.g.
 *  after a start that raced with the Alt+V shortcut or a hung recognizer). */
export async function getVoiceState(): Promise<VoiceStateEvent> {
  if (!isTauri()) {
    return { recording: false, engine: "native", language: null };
  }
  return invoke<VoiceStateEvent>("voice_state");
}

export async function setVoiceEngine(engine: string): Promise<void> {
  await invoke("set_voice_engine", { engine });
}

/** Pins the language Whisper transcribes in; "auto" lets it detect from audio. */
export async function setVoiceLanguage(language: string): Promise<void> {
  await invoke("set_voice_language", { language });
}

export async function listMicrophones(): Promise<MicDevice[]> {
  if (!isTauri()) return [];
  return invoke<MicDevice[]>("list_microphones");
}

/** Persists the microphone chosen in Settings; empty string uses the OS default. */
export async function setSelectedMicrophone(mic: string): Promise<void> {
  await invoke("set_selected_microphone", { mic });
}

export async function listenVoiceStatus(
  handler: (event: VoiceStatusEvent) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceStatusEvent>("voice-status", (e) => handler(e.payload));
}

export async function listenVoiceStopped(
  handler: (event: VoiceStoppedEvent) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceStoppedEvent>("voice-stopped", (e) => handler(e.payload));
}

export async function listenVoiceTranscribed(
  handler: (event: VoiceTranscribedEvent) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<VoiceTranscribedEvent>("voice-transcribed", (e) =>
    handler(e.payload),
  );
}

// ── Whisper.cpp ──────────────────────────────────────────────────────────

/** The downloadable Whisper models, smallest to largest (larger = better). */
export const WHISPER_MODELS = [
  { id: "tiny", label: "Tiny", sizeMb: 75 },
  { id: "base", label: "Base", sizeMb: 145 },
  { id: "small", label: "Small", sizeMb: 466 },
] as const;

export type WhisperModelId = (typeof WHISPER_MODELS)[number]["id"];

export async function getWhisperStatus(): Promise<WhisperStatus> {
  if (!isTauri()) {
    return {
      installed: false,
      installing: false,
      modelSize: 0,
      activeModel: "tiny",
      installedModels: [],
    };
  }
  return invoke<WhisperStatus>("get_whisper_status");
}

export async function installWhisper(): Promise<void> {
  await invoke("install_whisper");
}

/** Switches the active Whisper model and returns the fresh status (no download —
 *  the panel shows the download button when the chosen model file is missing). */
export async function setWhisperModel(model: string): Promise<WhisperStatus> {
  return invoke<WhisperStatus>("set_whisper_model", { model });
}

/** Transcribes a recorded WAV with whisper-cli; the result arrives as a
 *  `voice-transcribed` event. */
export async function transcribeVoiceWav(path: string): Promise<void> {
  await invoke("transcribe_voice_wav", { path });
}

export async function listenWhisperProgress(
  handler: (event: WhisperProgressEvent) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<WhisperProgressEvent>("whisper-progress", (e) =>
    handler(e.payload),
  );
}

/** Normalised file drag & drop delivered by Tauri at the window level. The
 *  HTML5 drop event with `dataTransfer.files` never fires inside the desktop
 *  app because `dragDropEnabled` (default) intercepts drops at the OS level;
 *  `listenDragDrop` is the only reliable path there. */
export interface DragDropEvent {
  type: "enter" | "over" | "leave" | "drop";
  paths: string[];
}

export async function listenDragDrop(
  handler: (event: DragDropEvent) => void,
): Promise<Unlisten> {
  if (!isTauri()) return () => undefined;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "enter" || payload.type === "over") {
      handler({ type: "enter", paths: [] });
    } else if (payload.type === "leave") {
      handler({ type: "leave", paths: [] });
    } else {
      handler({ type: "drop", paths: payload.paths });
    }
  });
}

// ── RAG (Pregunta a tus Archivos) ────────────────────────────────────────

export interface RagStats {
  documentCount: number;
  chunkCount: number;
}

export interface RagSearchResult {
  chunkId: string;
  documentPath: string;
  content: string;
  similarity: number;
  metadata: {
    fileType: string;
    fileSize: number;
    createdAt: number;
    lineStart?: number;
    lineEnd?: number;
  };
}

export interface RagQueryResult {
  results: RagSearchResult[];
  query: string;
  totalChunksSearched: number;
}

/** Get relevant context from RAG for a given query */
export async function ragGetContext(query: string, maxChunks?: number): Promise<string> {
  const result = await ragQuery(query, maxChunks ?? 3);
  if (result.results.length === 0) return "";
  
  // Format results into a coherent context string
  const contextParts = result.results.map((r) => {
    const fileName = r.documentPath.split(/[\\/]/).pop() ?? r.documentPath;
    return `[From ${fileName}]:\n${r.content}`;
  });
  
  return contextParts.join("\n\n");
}

/** Index multiple files for RAG semantic search */
export async function ragIndexFiles(filePaths: string[]): Promise<Record<string, number>> {
  return invoke<Record<string, number>>("rag_index_files", { filePaths });
}

/** Query indexed documents with semantic search */
export async function ragQuery(query: string, topK?: number): Promise<RagQueryResult> {
  return invoke<RagQueryResult>("rag_query", { query, topK: topK ?? null });
}

/** Get statistics about indexed documents */
export async function ragGetStats(): Promise<RagStats> {
  return invoke<RagStats>("rag_get_stats");
}

/** Remove a document from the RAG index */
export async function ragRemoveDocument(docPath: string): Promise<void> {
  return invoke("rag_remove_document", { docPath });
}

/** Analyze command safety for CLI injection */
export interface ShellCommand {
  command: string;
  shell: string;
  args: string[];
  description: string;
  safetyLevel: 'safe' | 'caution' | 'dangerous';
}

export async function analyzeCommandSafety(command: string): Promise<ShellCommand> {
  return invoke("analyze_command_safety", { command });
}

export async function executeShellCommand(cmd: ShellCommand): Promise<string> {
  return invoke("execute_shell_command", { cmd });
}

/**
 * Check if a file type is supported for indexing. Kept in sync with
 * `SUPPORTED_EXTENSIONS` in src-tauri/src/rag.rs.
 */
export function isSupportedFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  const supported = [
    // Documents
    'pdf', 'docx', 'md', 'markdown', 'txt', 'rtf',
    // Web & markup
    'html', 'htm', 'xml', 'csv', 'json', 'yaml', 'yml', 'toml',
    // Code
    'rs', 'py', 'js', 'ts', 'jsx', 'tsx', 'sh', 'bat', 'ps1', 'css',
    'scss', 'sql', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'rb', 'php',
    'kt', 'swift',
    // Config & logs
    'ini', 'cfg', 'conf', 'log', 'env', 'properties', 'lock', 'gradle',
  ];
  return ext ? supported.includes(ext) : false;
}