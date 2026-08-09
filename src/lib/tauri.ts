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

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "spotai.settings.v1";
const SETTINGS_MIGRATION_FLAG = "spotai.settings.migrated.v1";

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

// ---------------------------------------------------------------------------
// Settings persistence (Tauri store + localStorage mirror)
// ---------------------------------------------------------------------------

interface AppSettingsLike extends Partial<AppSettings> {
  version?: number;
}

/** In-process defaults. */
export function defaultSettings(): AppSettings {
  return {
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
}

/**
 * Async, authoritative loader. Reads the Tauri store first and falls back to
 * the `localStorage` mirror for environments where the Rust runtime is not
 * available (plain `vite dev` in a browser, first boot before the runtime is
 * ready, etc.).
 */
export async function loadSettings(): Promise<AppSettings> {
  const defaults = defaultSettings();
  if (!isTauri()) {
    return readFromLocalStorage(defaults);
  }
  try {
    const stored = await invoke<AppSettingsLike | null>("get_app_settings");
    return mergeSettings(defaults, stored);
  } catch (cause) {
    warn("get_app_settings failed, falling back to localStorage", cause);
    return readFromLocalStorage(defaults);
  }
}

/**
 * Synchronous version used during the initial render to avoid a flash of
 * defaults. We always read the `localStorage` mirror, which `saveSettings`
 * keeps up to date. Once the async hydration finishes (or on next mount),
 * the React state will reflect whatever the Tauri store actually returned.
 */
export function loadSettingsSync(): AppSettings {
  return readFromLocalStorage(defaultSettings());
}

/**
 * Persists the given settings. Writes to the Tauri store and, in parallel,
 * updates the `localStorage` mirror so `loadSettingsSync` can hydrate on
 * subsequent reloads without an extra IPC round-trip.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("set_app_settings", { settings: toPersisted(settings) });
    } catch (cause) {
      warn("set_app_settings failed, falling back to localStorage", cause);
    }
  }
  writeToLocalStorage(settings);
}

function readFromLocalStorage(defaults: AppSettings): AppSettings {
  if (typeof window === "undefined") return defaults;
  try {
    const value = window.localStorage.getItem(SETTINGS_KEY);
    return value ? { ...defaults, ...JSON.parse(value) } : defaults;
  } catch {
    return defaults;
  }
}

function writeToLocalStorage(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota errors are non-fatal; the in-memory copy is still authoritative
    // for the current session.
  }
}

function mergeSettings(
  defaults: AppSettings,
  stored: AppSettingsLike | null | undefined,
): AppSettings {
  if (!stored) return defaults;
  const { version: _version, ...rest } = stored;
  return {
    ...defaults,
    ...rest,
    customActions: Array.isArray(stored.customActions)
      ? (stored.customActions as AppSettings["customActions"])
      : defaults.customActions,
  };
}

function toPersisted(settings: AppSettings): AppSettingsLike {
  // The backend stamps the version field itself; we omit it here so the
  // server stays the single source of truth.
  return { ...settings };
}

/**
 * One-shot migration from the legacy `localStorage` slot to the Tauri
 * settings file. Safe to call multiple times: a flag in `localStorage`
 * prevents re-runs and a missing payload is a no-op.
 */
export async function migrateLegacySettings(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(SETTINGS_MIGRATION_FLAG) === "1") return false;
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    window.localStorage.setItem(SETTINGS_MIGRATION_FLAG, "1");
    return false;
  }
  let parsed: AppSettingsLike;
  try {
    parsed = JSON.parse(raw);
  } catch {
    window.localStorage.setItem(SETTINGS_MIGRATION_FLAG, "1");
    return false;
  }
  if (isTauri()) {
    try {
      await invoke("set_app_settings", { settings: parsed });
    } catch (cause) {
      warn("migrateLegacySettings: set_app_settings failed", cause);
      return false;
    }
  }
  window.localStorage.setItem(SETTINGS_MIGRATION_FLAG, "1");
  return true;
}

// Minimal logging shim. Avoids pulling in a full logging dependency just
// for two warn() calls; output is silent in production builds anyway.
function warn(message: string, detail: unknown): void {
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.warn(`[spotai] ${message}`, detail);
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Global shortcut
// ---------------------------------------------------------------------------

export async function getShortcutStatus(): Promise<ShortcutStatus> {
  if (!isTauri()) {
    return { registered: false, error: "The Tauri desktop runtime is not active" };
  }
  return invoke<ShortcutStatus>("get_shortcut_status");
}

/**
 * Updates the global shortcut at runtime. The new combination must be a
 * `+`-separated list such as "Alt+Space", "Ctrl+Shift+K" or "Super+KeyP".
 * Throws if the string is malformed or if the OS refuses the registration
 * (e.g. because the combination is already taken by another app).
 */
export async function setGlobalShortcut(shortcut: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("The Tauri desktop runtime is not active");
  }
  return invoke<string>("set_global_shortcut", { shortcut });
}

// ---------------------------------------------------------------------------
// Models & LLM streaming
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// API keys (DPAPI-encrypted, backend-managed)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Ollama health
// ---------------------------------------------------------------------------

export async function checkOllamaHealth(host?: string): Promise<HealthStatus> {
  try {
    return await invoke<HealthStatus>("check_ollama_health", {
      host: host ?? null,
    });
  } catch {
    return { ollama: false, ollamaVersion: null };
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function resolveHost(
  provider: string,
  settings: AppSettings,
): string | null {
  if (provider === "ollama") return settings.ollamaHost;
  if (provider === "lmstudio") return settings.lmstudioHost;
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
