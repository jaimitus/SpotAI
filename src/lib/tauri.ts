import type {
  ApiKeyStatus,
  ApiKeys,
  AppSettings,
  HealthStatus,
  ModelInfo,
  PromptRequest,
  ShortcutStatus,
  TokenEvent,
} from "../types";
import { BUILTIN_CLOUD_MODELS } from "./prompts";

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

export async function getShortcutStatus(): Promise<ShortcutStatus> {
  if (!isTauri()) {
    return { registered: false, error: "The Tauri desktop runtime is not active" };
  }
  return invoke<ShortcutStatus>("get_shortcut_status");
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
    requestId: request.requestId ?? null,
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

export async function startResizingWindow(
  direction: "SouthEast" | "South" | "East" = "SouthEast",
): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startResizing(direction);
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

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    language: "en",
    ollamaHost: "http://127.0.0.1:11434",
    lmstudioHost: "http://127.0.0.1:1234",
    defaultProvider: "ollama",
    defaultModel: "",
    globalShortcut: "Alt+Space",
    temperature: 0.7,
    maxTokens: 4096,
    customActions: [],
  };
  try {
    const value = localStorage.getItem(SETTINGS_KEY);
    return value ? { ...defaults, ...JSON.parse(value) } : defaults;
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
  return null;
}