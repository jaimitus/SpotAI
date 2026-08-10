import {
  ArrowUp,
  Camera,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  EyeOff,
  Mic,
  ClipboardPaste,
  Copy,
  Loader2,
  MoveDiagonal2,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useClipboardContext } from "../hooks/useClipboardContext";
import { useLLMStream } from "../hooks/useLLMStream";
import {
  autoTitle,
  createConversationId,
  loadConversationsState,
  persistActiveId,
  persistConversations,
  removeConversation,
  renameConversation as renameConversationInStore,
  togglePinned as togglePinnedInStore,
  trimMessages,
  upsertConversation,
} from "../lib/conversations";
import { formatCaptureTime, formatDuration } from "../lib/format";
import { t } from "../lib/i18n";
import { resolveTheme, subscribeSystemTheme } from "../lib/theme";
import { getVoiceTranscriptionTimeout } from "../lib/voiceTimeout";
import type { ThemePreference } from "../types";
import { buildActionPrompt } from "../lib/prompts";
import { buildSlashActions, getSlashQuery, type SlashAction } from "../lib/slash";
import { APP_VERSION } from "../lib/version";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import type { Update } from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  autoInsertText,
  checkOllamaHealth,
  captureScreens,
  confirmDialog,
  fetchCloudModels,
  fetchLmStudioModels,
  fetchLocalModels,
  fetchOpenAICompatibleModels,
  getApiKeyStatus,
  hideWindow,
  isTauri,
  listenQuickAction,
  listenVoiceStatus,
  listenVoiceStopped,
  listenVoiceTranscribed,
  listenWindowShown,
  loadSettings,
  getVoiceState,
  startVoiceCapture,
  stopVoiceCapture,
  transcribeVoiceWav,
  openExternalUrl,
  registerShortcut,
  resolveHost,
  saveSettings,
  setClipboardText,
  setSelectedMicrophone,
  setVoiceEngine,
} from "../lib/tauri";
import type {
  ActionChipId,
  AppSettings,
  CapturedImage,
  CapturedScreen,
  ChatMessage,
  ContextKind,
  Conversation,
  CustomAction,
  ModelInfo,
  PromptTemplate,
  QuickActionPayload,
  SystemActionId,
  VoiceTranscribedEvent,
} from "../types";
import { cn } from "../utils/cn";
import { ActionChips } from "./ActionChips";
import { ProviderBadge } from "./ProviderBadge";
import { ResponsePanel } from "./ResponsePanel";
import { ScreenCaptureOverlay } from "./ScreenCaptureOverlay";
import { SettingsModal } from "./SettingsModal";
import { SlashMenu } from "./SlashMenu";

const PROMPT_HISTORY_KEY = "spotai.prompt-history.v2";
const LEGACY_PROMPT_HISTORY_KEY = "spotai.prompt-history.v1";
const MAX_PROMPT_HISTORY = 20;
const MODEL_MEMORY_KEY = "spotai.model-memory.v1";
const WINDOW_SIZE_KEY = "spotai.window-size.v1";
// Persisted when the Windows native recognizer fails with the "speech privacy
// policy was not accepted" error (the app lacks microphone permission), so
// Settings can show an actionable warning until a transcription succeeds.
const MIC_PERMISSION_KEY = "spotai.mic-permission.v1";

/** Formats an elapsed duration as mm:ss (e.g. "00:07"). */
function formatElapsed(start: number, now: number): string {
  return formatDuration((now - start) / 1000);
}

function loadModelMemory(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MODEL_MEMORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === "object" && parsed !== null) {
      const result: Record<string, string> = {};
      for (const [provider, model] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof model === "string" && model) result[provider] = model;
      }
      return result;
    }
  } catch {
    // Best-effort.
  }
  return {};
}

function saveModelMemory(memory: Record<string, string>): void {
  try {
    localStorage.setItem(MODEL_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Best-effort.
  }
}

interface PromptHistoryEntry {
  prompt: string;
  response: string;
}

function loadPromptHistory(): PromptHistoryEntry[] {
  try {
    const value =
      localStorage.getItem(PROMPT_HISTORY_KEY) ??
      localStorage.getItem(LEGACY_PROMPT_HISTORY_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed
      .map((item): PromptHistoryEntry | null => {
        if (typeof item === "string" && item.trim()) {
          return { prompt: item.trim(), response: "" };
        }
        if (
          typeof item === "object" &&
          item !== null &&
          "prompt" in item &&
          "response" in item &&
          typeof item.prompt === "string" &&
          typeof item.response === "string" &&
          item.prompt.trim()
        ) {
          return { prompt: item.prompt.trim(), response: item.response };
        }
        return null;
      })
      .filter((item): item is PromptHistoryEntry => item !== null);
    const seen = new Set<string>();
    return entries
      .filter((entry) => {
        if (seen.has(entry.prompt)) return false;
        seen.add(entry.prompt);
        return true;
      })
      .slice(0, MAX_PROMPT_HISTORY);
  } catch {
    return [];
  }
}

export function SpotlightWindow() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [provider, setProvider] = useState<string>(settings.defaultProvider);
  const [model, setModel] = useState(settings.defaultModel);
  const [prompt, setPrompt] = useState("");
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>(loadPromptHistory);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ollamaOnline, setOllamaOnline] = useState(false);
  const [booting, setBooting] = useState(true);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [hasCloudKeys, setHasCloudKeys] = useState(false);
  const [conversationInit] = useState(loadConversationsState);
  const [conversations, setConversations] = useState<Conversation[]>(
    conversationInit.conversations,
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    conversationInit.activeId,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    () =>
      conversationInit.conversations.find(
        (conversation) => conversation.id === conversationInit.activeId,
      )?.messages ?? [],
  );
  const [contextImage, setContextImage] = useState<CapturedImage | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const [incognito, setIncognito] = useState(false);
  const [capturedScreens, setCapturedScreens] = useState<CapturedScreen[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [contextRefreshFailed, setContextRefreshFailed] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  // Total length (seconds) of the recording being transcribed, shown in the
  // "Transcribing…" bar. Set from the stop result / voice-stopped event.
  const [recordingDuration, setRecordingDuration] = useState<number | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const currentLang = settings.language || "en";

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef("");
  // Voice session tracking: bumped on every capture start / overlay clear so a
  // late `voice-transcribed` event from an older session can never overwrite
  // the prompt of a newer one.
  const voiceSessionRef = useRef(0);
  const voiceWaitingSessionRef = useRef(-1);
  const transcribeTimerRef = useRef<number | null>(null);
  // Set when a request was started from a dedicated quick-action shortcut
  // (Ctrl+Shift+T/R/K). When the reply finishes, it is inserted into the
  // previously-focused app automatically instead of waiting for Ctrl+Enter.
  const quickActionRef = useRef<QuickActionPayload | null>(null);
  const appliedShortcutRef = useRef<string | null>(null);
  const providerRef = useRef(provider);
  const activeConversationIdRef = useRef(activeConversationId);
  const modelMemoryRef = useRef<Record<string, string>>(loadModelMemory());
  const {
    contextText,
    setManualContext,
    clearContext,
    refresh,
    capturedAt,
    truncated,
    kind: contextKind,
  } = useClipboardContext();
  const contextKindLabels: Record<ContextKind, "contextKind_empty" | "contextKind_text" | "contextKind_code" | "contextKind_error" | "contextKind_json" | "contextKind_url"> = {
    empty: "contextKind_empty",
    text: "contextKind_text",
    code: "contextKind_code",
    error: "contextKind_error",
    json: "contextKind_json",
    url: "contextKind_url",
  };
  const { response, status, error, start, stop, restore, reset } = useLLMStream();

  const setPromptValue = useCallback((value: string) => {
    historyIndexRef.current = null;
    historyDraftRef.current = "";
    restore("");
    setPrompt(value);
  }, [restore]);

  const clearTranscribeTimer = () => {
    if (transcribeTimerRef.current !== null) {
      window.clearTimeout(transcribeTimerRef.current);
      transcribeTimerRef.current = null;
    }
  };

  // Enter the "Transcribing…" state for the current voice session.  A timeout
  // guard prevents the state from hanging forever when the OS recognizer is
  // unavailable (e.g. no language pack) or a rapid re-record was dropped.
  const beginWaitingForTranscription = useCallback((durationSecs?: number) => {
    voiceWaitingSessionRef.current = voiceSessionRef.current;
    setTranscribing(true);
    clearTranscribeTimer();
    // The native recognizer answers in a couple of seconds. Whisper is a local
    // CPU transcription that scales with the recording length, so a fixed 9s
    // timeout would give up before whisper-cli finishes on longer captures.
    // The whisper callers always pass a number (even 0 for an empty capture),
    // while the native engine callers pass nothing and keep the fast 9s.
    const timeoutMs = getVoiceTranscriptionTimeout(durationSecs);
    transcribeTimerRef.current = window.setTimeout(() => {
      transcribeTimerRef.current = null;
      setTranscribing(false);
      setRecordingDuration(null);
      setVoiceError(t(currentLang, "transcribeTimeout") || "Transcription timed out");
    }, timeoutMs);
  }, [currentLang]);

  const cancelWaitingForTranscription = useCallback(() => {
    clearTranscribeTimer();
    setTranscribing(false);
    // The transcription is over: drop the processed duration marker too. It
    // is set right before beginWaitingForTranscription, never after, so this
    // cannot erase a duration the bar still needs to show.
    setRecordingDuration(null);
  }, []);

  // Track when the current capture started so the recording bar can show a
  // session marker (start time + live elapsed) that distinguishes captures.
  // Derived from the `recording` state so every entry/exit path stays in sync
  // (button, Alt+V events, backend reconciliation).
  useEffect(() => {
    if (recording) {
      setRecordingSince(Date.now());
      // A fresh capture invalidates the previous recording's duration marker.
      setRecordingDuration(null);
    } else {
      setRecordingSince(null);
    }
  }, [recording]);

  // Tick once per second while recording for the live elapsed counter.
  useEffect(() => {
    if (!recording) return;
    setElapsedNow(Date.now());
    const timer = window.setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Ask the backend what it is actually doing and reconcile the recording UI.
  // A start can race with the Alt+V shortcut (or a previous session left the
  // backend capturing), so the button must never stay stuck on a stale
  // "already in progress" toast when the backend is genuinely recording.
  const syncVoiceState = useCallback(async () => {
    try {
      const state = await getVoiceState();
      setRecording(state.recording);
      if (state.recording) setVoiceError(null);
    } catch {
      // Command unavailable (non-Tauri); keep the current UI state.
    }
  }, []);

  const recordPrompt = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized || incognito) return;
    setPromptHistory((current) => [
      { prompt: normalized, response: "" },
      ...current.filter((item) => item.prompt !== normalized),
    ].slice(0, MAX_PROMPT_HISTORY));
    historyIndexRef.current = null;
    historyDraftRef.current = "";
  }, [incognito]);

  const recordResponse = useCallback((promptValue: string, responseValue: string) => {
    if (!responseValue || incognito) return;
    setPromptHistory((current) => {
      const exists = current.some((entry) => entry.prompt === promptValue);
      if (!exists) {
        return [{ prompt: promptValue, response: responseValue }, ...current].slice(
          0,
          MAX_PROMPT_HISTORY,
        );
      }
      return current.map((entry) =>
        entry.prompt === promptValue ? { ...entry, response: responseValue } : entry,
      );
    });
  }, [incognito]);

  const removePrompt = useCallback((promptValue: string) => {
    setPromptHistory((current) =>
      current.filter((entry) => entry.prompt !== promptValue),
    );
  }, []);

  const moveHistory = useCallback((direction: "older" | "newer") => {
    if (promptHistory.length === 0) return;

    if (direction === "older") {
      if (historyIndexRef.current === null) {
        historyDraftRef.current = prompt;
      }
      const nextIndex = Math.min(
        (historyIndexRef.current ?? -1) + 1,
        promptHistory.length - 1,
      );
      historyIndexRef.current = nextIndex;
      const entry = promptHistory[nextIndex];
      setPrompt(entry.prompt);
      setActiveAction(null);
      restore(entry.response);
    } else if (historyIndexRef.current !== null) {
      const nextIndex = historyIndexRef.current - 1;
      if (nextIndex < 0) {
        historyIndexRef.current = null;
        setPrompt(historyDraftRef.current);
        historyDraftRef.current = "";
        restore("");
      } else {
        historyIndexRef.current = nextIndex;
        const entry = promptHistory[nextIndex];
        setPrompt(entry.prompt);
        setActiveAction(null);
        restore(entry.response);
      }
    } else {
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const input = inputRef.current;
      if (input) input.selectionStart = input.selectionEnd = input.value.length;
    });
  }, [prompt, promptHistory, restore]);

  const clearOverlayState = useCallback(() => {
    // Kill any in-flight stream so a late completion cannot write into a
    // conversation the user has already switched away from.
    if (status === "streaming") {
      void stop();
    }
    reset();
    setPromptValue("");
    setActiveAction(null);
    // Cancel any pending quick-action auto-insert (Esc, new chat, incognito…).
    quickActionRef.current = null;
    // Drop any in-flight voice transcription so it cannot land in a newer session.
    voiceSessionRef.current += 1;
    cancelWaitingForTranscription();
  }, [status, stop, reset, setPromptValue, cancelWaitingForTranscription]);

  const newChat = useCallback(() => {
    clearOverlayState();
    setMessages([]);
    setActiveConversationId(createConversationId());
  }, [clearOverlayState]);

  const dismissOverlay = useCallback(() => {
    if (status === "streaming") {
      void stop();
    }
    reset();
    setPromptValue("");
    setActiveAction(null);
    // Ignore any in-flight transcription when the overlay is dismissed.
    voiceSessionRef.current += 1;
    cancelWaitingForTranscription();
    void hideWindow();
  }, [status, stop, reset, setPromptValue, cancelWaitingForTranscription]);

  const selectConversation = useCallback(
    (id: string) => {
      const target = conversations.find((conversation) => conversation.id === id);
      if (!target) return;
      clearOverlayState();
      setActiveConversationId(id);
      setMessages(target.messages);
    },
    [conversations, clearOverlayState],
  );

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((current) => renameConversationInStore(current, id, title));
  }, []);

  const togglePinned = useCallback((id: string) => {
    setConversations((current) => togglePinnedInStore(current, id));
  }, []);

  const editPrompt = useCallback(
    (content: string) => {
      setActiveAction(null);
      setPromptValue(content);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        const el = inputRef.current;
        if (el) el.selectionStart = el.selectionEnd = el.value.length;
      });
    },
    [setPromptValue],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      const ok = await confirmDialog(t(currentLang, "deleteChatConfirm"));
      if (!ok) return;
      setConversations((current) => removeConversation(current, id));
      if (activeConversationId === id) {
        const remaining = conversations.filter((item) => item.id !== id);
        const next = remaining[0];
        clearOverlayState();
        setActiveConversationId(next?.id ?? null);
        setMessages(next?.messages ?? []);
      }
    },
    [activeConversationId, conversations, clearOverlayState, currentLang],
  );

  const isStreaming = status === "streaming";
  const hasResponse = messages.length > 0 || status !== "idle";
  const lastAssistantContent = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return "";
  }, [messages]);
  const insertTarget =
    status === "done" && response ? response : lastAssistantContent;
  const canAutoInsert = status !== "streaming" && Boolean(insertTarget);

  const autoInsertResponse = useCallback(async () => {
    if (!canAutoInsert) return;
    await autoInsertText(insertTarget);
    clearOverlayState();
    // The native command hides before injecting so the previous app receives Ctrl+V.
    await hideWindow();
  }, [insertTarget, canAutoInsert, clearOverlayState]);

  // Re-runs the last user question, dropping the previous reply so the new
  // answer replaces it instead of stacking on top.
  const regenerate = useCallback(async () => {
    if (isStreaming) return;
    const conversationAtSubmit = activeConversationIdRef.current;
    const trimmedMessages = messages.slice();
    while (
      trimmedMessages.length > 0 &&
      trimmedMessages[trimmedMessages.length - 1].role === "assistant"
    ) {
      trimmedMessages.pop();
    }
    const lastUser = trimmedMessages
      .filter((message) => message.role === "user")
      .at(-1);
    if (!lastUser) return;
    setMessages(trimmedMessages);
    const completedResponse = await start({
      provider,
      model,
      prompt: lastUser.content,
      contextText: contextText || null,
      imageDataUrl: contextImage?.dataUrl ?? null,
      host: resolveHost(provider, settings),
      systemPrompt: settings.systemPrompt || null,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      history: trimmedMessages,
    });
    // Never write a finished turn into a conversation the user switched away from.
    if (activeConversationIdRef.current !== conversationAtSubmit) return;
    if (completedResponse) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: completedResponse },
      ]);
      recordResponse(lastUser.content, completedResponse);
    }
  }, [
    isStreaming,
    messages,
    provider,
    model,
    contextText,
    contextImage,
    settings,
    start,
    recordResponse,
  ]);

  const installUpdate = async () => {
    if (!pendingUpdate || updating) return;
    setUpdating(true);
    setUpdateFailed(false);
    try {
      await pendingUpdate.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setUpdateFailed(true);
      setUpdating(false);
    }
  };
  const showOnboarding =
    !booting &&
    !hasCloudKeys &&
    (settings.customProviders || []).length === 0 &&
    models.filter((m) => m.provider === "ollama" || m.provider === "lmstudio").length ===
      0;

  // Load models + health
  const reloadModels = useCallback(async (s: AppSettings) => {
    const [ollamaModels, lmStudioModels, cloudModels, health] = await Promise.all([
      fetchLocalModels(s.ollamaHost),
      fetchLmStudioModels(s.lmstudioHost),
      fetchCloudModels(),
      checkOllamaHealth(s.ollamaHost),
    ]);
    const customResults = await Promise.all(
      (s.customProviders || []).map(async (cp) => {
        const fetched = await fetchOpenAICompatibleModels(cp.baseUrl);
        if (fetched.length > 0) {
          return fetched.map((m) => ({ ...m, provider: `custom:${cp.id}` }));
        }
        const fallback = cp.defaultModel?.trim();
        return fallback
          ? [{ id: fallback, name: fallback, provider: `custom:${cp.id}` }]
          : [];
      }),
    );
    const availableModels: ModelInfo[] = [
      ...ollamaModels,
      ...lmStudioModels,
      ...cloudModels,
      ...customResults.flat(),
    ];
    setModels(availableModels);
    setOllamaOnline(health.ollama);
    // Keep the selected provider when it still exists; otherwise fall back to
    // the default so a deleted custom provider cannot leave stale state.
    const currentProvider = providerRef.current;
    const effectiveProvider = availableModels.some(
      (candidate) => candidate.provider === currentProvider,
    )
      ? currentProvider
      : s.defaultProvider;
    setProvider(effectiveProvider);
    setModel((current) => {
      if (
        availableModels.some(
          (candidate) =>
            candidate.provider === effectiveProvider && candidate.id === current,
        )
      ) {
        return current;
      }
      // Restore the last model used for this provider when it is still available.
      const remembered = modelMemoryRef.current[effectiveProvider];
      if (
        remembered &&
        availableModels.some(
          (candidate) =>
            candidate.provider === effectiveProvider && candidate.id === remembered,
        )
      ) {
        return remembered;
      }
      return (
        availableModels.find(
          (candidate) => candidate.provider === effectiveProvider,
        )?.id ?? ""
      );
    });
    setBooting(false);
  }, []);

  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  // Apply the light/dark preference to the document root. When "system" is
  // selected, follow the OS color scheme and update live when it changes.
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(settings.theme);
    if ((settings.theme || "dark") !== "system") return;
    return subscribeSystemTheme(() => {
      document.documentElement.dataset.theme = resolveTheme("system");
    });
  }, [settings.theme]);

  // Check for a new release once per session; the banner stays visible until
  // dismissed/installed even though the window starts hidden.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((update) => {
        if (!cancelled && update) setPendingUpdate(update);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the user's preferred window size (borderless windows keep no
  // native frame, so the size is remembered here instead).
  useEffect(() => {
    if (!isTauri()) return;
    try {
      const raw = localStorage.getItem(WINDOW_SIZE_KEY);
      if (!raw) return;
      const size = JSON.parse(raw) as { width?: number; height?: number };
      if (
        typeof size.width === "number" &&
        typeof size.height === "number" &&
        Number.isFinite(size.width) &&
        Number.isFinite(size.height) &&
        size.width > 0 &&
        size.height > 0
      ) {
        void getCurrentWindow()
          .setSize(new PhysicalSize(Math.round(size.width), Math.round(size.height)))
          .catch(() => undefined);
      }
    } catch {
      // Invalid stored size; keep the configured default.
    }
  }, []);

  // Remember the window size whenever the user resizes it.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let mounted = true;
    void getCurrentWindow()
      .onResized(({ payload }) => {
        if (!mounted) return;
        try {
          localStorage.setItem(
            WINDOW_SIZE_KEY,
            JSON.stringify({ width: payload.width, height: payload.height }),
          );
        } catch {
          // Size persistence is best-effort.
        }
      })
      .then((dispose) => {
        if (mounted) unlisten = dispose;
        else dispose();
      });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (incognito) return;
    try {
      localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(promptHistory));
      localStorage.removeItem(LEGACY_PROMPT_HISTORY_KEY);
    } catch {
      // Prompt history is a convenience; the overlay must still work if storage is unavailable.
    }
  }, [promptHistory, incognito]);

  // Persist the active conversation whenever its messages change, deriving an
  // auto-title from the first user prompt unless the user renamed it.
  useEffect(() => {
    if (!activeConversationId) return;
    setConversations((current) => {
      const existing = current.find((item) => item.id === activeConversationId);
      const trimmed = trimMessages(messages);
      if (trimmed.length === 0 && !existing) return current;
      return upsertConversation(current, {
        id: activeConversationId,
        title:
          existing?.renamed && existing.title
            ? existing.title
            : autoTitle(trimmed) || existing?.title || "New chat",
        renamed: existing?.renamed ?? false,
        // Preserve the pin across message updates.
        pinned: existing?.pinned ?? false,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        messages: trimmed,
      });
    });
  }, [messages, activeConversationId]);

  useEffect(() => {
    if (incognito) return;
    persistConversations(conversations);
  }, [conversations, incognito]);

  useEffect(() => {
    // The ref must always track the active chat (it guards chat switches while
    // a stream is running); only the persistence is skipped in incognito.
    activeConversationIdRef.current = activeConversationId;
    if (incognito) return;
    persistActiveId(activeConversationId);
  }, [activeConversationId, incognito]);

  // The Settings "Clear conversations" action resets the in-memory chat state.
  useEffect(() => {
    const onCleared = () => {
      setConversations([]);
      setActiveConversationId(null);
      setMessages([]);
      clearOverlayState();
    };
    window.addEventListener("spotai:conversations-cleared", onCleared);
    return () => {
      window.removeEventListener("spotai:conversations-cleared", onCleared);
    };
  }, [clearOverlayState]);

  useEffect(() => {
    void reloadModels(settings);
    // Sync the persisted voice preferences to the Rust backend on every boot
    // (and whenever settings change). The backend starts with the native
    // engine, so without this a stored Whisper selection would silently
    // revert to SAPI after an app restart — and dictation would "stop
    // working" even though Settings still says Whisper.
    if (isTauri()) {
      void setVoiceEngine(settings.voiceEngine || "native").catch(() => undefined);
      void setSelectedMicrophone(settings.selectedMic || "").catch(() => undefined);
    }
    void getApiKeyStatus().then((status) => {
      setHasCloudKeys(
        Boolean(status.openai || status.anthropic || status.groq || status.deepseek),
      );
    });
    // Register the user-configured global shortcut on boot (and after it changes).
    const shortcut = settings.globalShortcut || "Alt+Space";
    if (appliedShortcutRef.current === shortcut) return;
    appliedShortcutRef.current = shortcut;
    void registerShortcut(shortcut).then((status) => {
      setShortcutError(
        status.registered ? null : status.error || t(currentLang, "shortcutUnavailable"),
      );
    });
  }, [settings, reloadModels, currentLang]);

  useEffect(() => {
    const focus = () => {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    focus();
    // Reconcile with the backend on show: a capture may still be running from
    // a previous session or the Alt+V shortcut.
    void syncVoiceState();
    let unlisten: (() => void) | undefined;
    void listenWindowShown(() => {
      focus();
      void syncVoiceState();
    }).then((dispose) => {
      unlisten = dispose;
    });

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !settingsOpen) {
        e.preventDefault();
        if (isStreaming) {
          void stop();
          dismissOverlay();
        } else {
          dismissOverlay();
        }
      }
      if (e.defaultPrevented || settingsOpen) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canAutoInsert) {
        e.preventDefault();
        void autoInsertResponse().catch(() => undefined);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlisten?.();
    };
  }, [settingsOpen, isStreaming, canAutoInsert, stop, dismissOverlay, autoInsertResponse, syncVoiceState]);

  const handleProviderChange = (p: string, m: string) => {
    setProvider(p);
    setModel(m);
    modelMemoryRef.current = { ...modelMemoryRef.current, [p]: m };
    saveModelMemory(modelMemoryRef.current);
    const next = { ...settings, defaultProvider: p, defaultModel: m };
    setSettings(next);
    saveSettings(next);
  };

  const handleAction = (id: ActionChipId) => {
    setActiveAction(id);
    const template = buildActionPrompt(id, undefined, currentLang);
    setPromptValue(template);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el) {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      }
    });
  };

  const handleSelectCustomAction = (customAction: CustomAction) => {
    setActiveAction(customAction.id);
    setPromptValue(customAction.prompt);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el) {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      }
    });
  };

  const handleSelectTemplate = (template: PromptTemplate) => {
    setActiveAction(template.id);
    setPromptValue(template.prompt);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el) {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      }
    });
  };

  const toggleIncognito = useCallback(() => {
    const next = !incognito;
    setIncognito(next);
    if (next) {
      // Start clean: fresh chat, no history and no clipboard context.
      clearOverlayState();
      setMessages([]);
      setActiveConversationId(createConversationId());
      setPromptHistory([]);
      clearContext();
    }
  }, [incognito, clearOverlayState, clearContext]);

  const startScreenCapture = useCallback(async () => {
    if (captureLoading) return;
    setCaptureLoading(true);
    try {
      const screens = await captureScreens();
      if (!screens.length) return;
      setCapturedScreens(screens);
      setCaptureOpen(true);
    } catch (error) {
      console.error("Screen capture failed:", error);
    } finally {
      setCaptureLoading(false);
    }
  }, [captureLoading]);

  const handleSystemAction = (id: SystemActionId) => {
    switch (id) {
      case "new":
        newChat();
        break;
      case "theme": {
        const resolved = settings.theme === "system" ? resolveTheme(undefined) : settings.theme;
        const nextTheme: ThemePreference = resolved === "light" ? "dark" : "light";
        const updated = { ...settings, theme: nextTheme };
        setSettings(updated);
        saveSettings(updated);
        break;
      }
      case "settings":
        setSettingsOpen(true);
        break;
      case "hide":
        dismissOverlay();
        break;
      case "clear":
        clearOverlayState();
        setMessages([]);
        break;
      case "capture":
        void startScreenCapture();
        break;
      case "incognito":
        toggleIncognito();
        break;
    }
  };

  const slashActions = useMemo(
    () =>
      buildSlashActions(
        prompt,
        settings.customActions || [],
        settings.promptTemplates || [],
        currentLang,
      ),
    [prompt, settings.customActions, settings.promptTemplates, currentLang],
  );
  const slashOpen = prompt.startsWith("/");

  useEffect(() => {
    setSlashIndex(0);
  }, [slashOpen]);

  const pickSlashAction = (action: SlashAction) => {
    if (action.kind === "chip" && action.chipId) {
      handleAction(action.chipId);
    } else if (action.kind === "custom" && action.custom) {
      handleSelectCustomAction(action.custom);
    } else if (action.kind === "template" && action.template) {
      handleSelectTemplate(action.template);
    } else if (action.kind === "system" && action.systemId) {
      handleSystemAction(action.systemId);
    }
    // Close the palette after running a command (also covers direct keyword
    // execution like "/theme" or "/settings" which do not clear the input).
    setPromptValue("");
    setSlashIndex(0);
  };

  // Dedicated global shortcuts (Ctrl+Shift+T/R/K) arrive as "quick-action"
  // events with the clipboard text captured by the backend. The chip prompt is
  // loaded and the clipboard text is injected as context so the action applies
  // to whatever the user had selected/copied in the other app.
  const handleQuickAction = useCallback(
    (payload: QuickActionPayload) => {
      const chipIds: Record<string, ActionChipId> = {
        translate: "translate",
        refactor: "refactor",
        summarize: "summarize",
      };
      const chipId = chipIds[payload.action];
      if (chipId) handleAction(chipId);
      // Route through setManualContext so the capture timestamp and kind are
      // kept consistent with clipboard captures.
      if (payload.text.trim()) setManualContext(payload.text.trim());
      quickActionRef.current = payload;
    },
    [handleAction, setManualContext],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenQuick: (() => void) | undefined;
    void listenQuickAction(handleQuickAction).then((dispose) => {
      unlistenQuick = dispose;
    });
    return () => {
      unlistenQuick?.();
    };
  }, [handleQuickAction]);

  // Voice input: listen for status changes (recording on/off), completed
  // captures (WAV file), and live transcriptions from the native engine.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenStatus: (() => void) | undefined;
    let unlistenStopped: (() => void) | undefined;
    let unlistenTranscribed: (() => void) | undefined;

    void listenVoiceStatus((event) => {
      if (event.recording) {
        // A new capture session started (Alt+V); bump the session so stale
        // transcriptions from a previous session are ignored.
        voiceSessionRef.current += 1;
        cancelWaitingForTranscription();
        setRecording(true);
      } else {
        setRecording(false);
      }
      if (event.error) setVoiceError(event.error);
      else setVoiceError(null);
    }).then((dispose) => {
      unlistenStatus = dispose;
    });

    void listenVoiceStopped((event) => {
      setRecording(false);
      setRecordingDuration(event.durationSecs);
      if (event.engine === "whisper") {
        // Whisper engine: transcribe the recorded WAV file. The result
        // arrives via the voice-transcribed event. Scale the wait with the
        // recording length (local CPU transcription).
        beginWaitingForTranscription(event.durationSecs);
        void transcribeVoiceWav(event.path).catch(() => undefined);
      } else {
        // Native engine transcribes the live mic; the text arrives via the
        // voice-transcribed event once the speaker pauses.
        beginWaitingForTranscription();
      }
      setVoiceError(null);
    }).then((dispose) => {
      unlistenStopped = dispose;
    });

    void listenVoiceTranscribed((event: VoiceTranscribedEvent) => {
      // The native recognizer can fail because Windows has not granted the app
      // microphone access. Remember that and surface an actionable warning in
      // Settings (persisted until a transcription finally succeeds).
      if (event.error && /privacy policy was not accepted/i.test(event.error)) {
        // Only notify once per transition so a burst of identical recognizer
        // failures (common when permission is missing) does not spam Settings.
        const wasAlreadyDenied =
          (() => {
            try {
              return localStorage.getItem(MIC_PERMISSION_KEY) === "1";
            } catch {
              return true;
            }
          })();
        if (!wasAlreadyDenied) {
          window.dispatchEvent(new CustomEvent("spotai:mic-permission-denied"));
        }
        try {
          localStorage.setItem(MIC_PERMISSION_KEY, "1");
        } catch {
          // Best-effort.
        }
      } else if (event.text) {
        // A successful transcription proves the recognizer works. Notify live
        // so an open Settings can hide the warning without reopening.
        try {
          localStorage.removeItem(MIC_PERMISSION_KEY);
        } catch {
          // Best-effort.
        }
        window.dispatchEvent(new CustomEvent("spotai:mic-permission-cleared"));
      }
      // Ignore transcriptions that no longer belong to the current session
      // (e.g. the user started a new capture or dismissed the overlay). A
      // stale event — like the OS recognizer erroring out while the user is
      // STILL recording — must not reset the recording state: the backend
      // keeps capturing and the UI must keep showing the recording bar.
      if (voiceWaitingSessionRef.current !== voiceSessionRef.current) {
        cancelWaitingForTranscription();
        return;
      }
      setRecording(false);
      cancelWaitingForTranscription();
      if (event.error || !event.text) {
        // Replace the cryptic OS error with a clear, actionable message when
        // it is caused by the missing microphone permission.
        const isPrivacy =
          typeof event.error === "string" &&
          /privacy policy was not accepted/i.test(event.error);
        setVoiceError(
          isPrivacy
            ? t(currentLang, "micPermissionError") ||
                "Microphone access denied by Windows. Allow it in Settings → Privacy → Microphone and restart SpotAI."
            : event.error || "No speech detected",
        );
        return;
      }
      setVoiceError(null);
      // Inject the recognised text straight into the prompt.
      setPromptValue(event.text);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        const el = inputRef.current;
        if (el) el.selectionStart = el.selectionEnd = el.value.length;
      });
    }).then((dispose) => {
      unlistenTranscribed = dispose;
    });

    return () => {
      unlistenStatus?.();
      unlistenStopped?.();
      unlistenTranscribed?.();
      clearTranscribeTimer();
    };
  }, [
    setPromptValue,
    beginWaitingForTranscription,
    cancelWaitingForTranscription,
    currentLang,
  ]);

  const toggleVoiceCapture = useCallback(() => {
    if (recording) {
      setVoiceError(null);
      void stopVoiceCapture()
        .then((result) => {
          setRecording(false);
          setRecordingDuration(result.durationSecs);
          if (result.engine === "whisper") {
            beginWaitingForTranscription(result.durationSecs);
            void transcribeVoiceWav(result.path).catch(() => undefined);
          } else {
            // Wait for the voice-transcribed event from the native engine.
            beginWaitingForTranscription();
          }
        })
        .catch((err) => {
          // The backend may have already stopped (e.g. Alt+V was released or
          // a previous stop won the race). Reconcile with the real state
          // instead of showing a bogus error toast.
          setRecording(false);
          void getVoiceState()
            .then((state) => {
              // The error toast is gated on `!recording`, so when the backend
              // is still capturing keep the indicator on (so the user can
              // retry the stop) and clear any toast. When it is not, clear
              // the toast too: the stop intent already succeeded.
              setRecording(state.recording);
              setVoiceError(null);
              cancelWaitingForTranscription();
            })
            .catch(() => {
              cancelWaitingForTranscription();
              setVoiceError(String(err));
            });
        });
    } else {
      setVoiceError(null);
      voiceSessionRef.current += 1;
      cancelWaitingForTranscription();
      setRecording(true);
      void startVoiceCapture().catch((err) => {
        // The backend may already be recording (started by Alt+V or a previous
        // session). If so, sync to that state instead of showing a confusing
        // "already in progress" toast that would leave the UI desynced.
        void getVoiceState()
          .then((state) => {
            if (state.recording) {
              setRecording(true);
              setVoiceError(null);
            } else {
              setRecording(false);
              setVoiceError(String(err));
            }
          })
          .catch(() => {
            setRecording(false);
            setVoiceError(String(err));
          });
      });
    }
  }, [recording, beginWaitingForTranscription, cancelWaitingForTranscription]);

  const canSubmit = useMemo(() => {
    if (isStreaming) return false;
    if (!prompt.trim() && !contextText.trim() && !contextImage) return false;
    if (!model) return false;
    return true;
  }, [isStreaming, prompt, contextText, contextImage, model]);

  const submit = async () => {
    if (!canSubmit) return;

    let finalPrompt = prompt.trim();
    if (!finalPrompt && (contextText || contextImage)) {
      finalPrompt = buildActionPrompt("explain", undefined, currentLang);
    }

    const conversationAtSubmit = activeConversationIdRef.current;
    // Disarm any pending quick-action auto-insert immediately: only the submit
    // that started from the shortcut may insert, and it must not survive a chat
    // switch mid-stream or a later manual request.
    const quickAction = quickActionRef.current;
    quickActionRef.current = null;
    const userMessage: ChatMessage = { role: "user", content: finalPrompt };
    setMessages((current) => [...current, userMessage]);
    recordPrompt(finalPrompt);
    const completedResponse = await start({
      provider,
      model,
      prompt: finalPrompt,
      contextText: contextText || null,
      imageDataUrl: contextImage?.dataUrl ?? null,
      host: resolveHost(provider, settings),
      systemPrompt: settings.systemPrompt || null,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      history: messages,
    });
    // The user may have switched chats (or started a new one) while the model
    // was streaming; never write the finished turn into a different chat.
    if (activeConversationIdRef.current !== conversationAtSubmit) return;
    if (completedResponse) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: completedResponse },
      ]);
      recordResponse(finalPrompt, completedResponse);
      // Requests launched from a dedicated quick-action shortcut either insert
      // the reply into the previously-focused app automatically, or (when the
      // user disabled auto-insert) copy it to the clipboard and stay open.
      if (quickAction) {
        if (settings.autoInsertQuickActions !== false) {
          try {
            await autoInsertText(completedResponse);
            clearOverlayState();
            await hideWindow();
          } catch {
            // Keep the window open with the answer visible so it can be copied.
          }
        } else {
          try {
            await setClipboardText(completedResponse);
            // Leave the window open with the answer visible, but clear the
            // pre-filled prompt so a stray Enter cannot re-send the same
            // request; the clipboard context is kept for easy re-runs.
            setPromptValue("");
            setActiveAction(null);
            setCopiedFlash(true);
            window.setTimeout(() => setCopiedFlash(false), 1800);
          } catch {
            // Clipboard can be temporarily unavailable; the text is still visible.
          }
        }
      }
    } else {
      // The turn produced no output (error or cancelled): a pending quick
      // action must not stick around for the next manual request.
      quickActionRef.current = null;
      removePrompt(finalPrompt);
      // The turn produced no output (error or cancelled): drop the trailing
      // user message so the conversation is not left with a dangling question.
      setMessages((current) =>
        current.length > 0 && current[current.length - 1].role === "user"
          ? current.slice(0, -1)
          : current,
      );
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          if (dataUrl) setContextImage({ mime: item.type, dataUrl });
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  // Exact keyword match (e.g. "/new") wins over the highlighted palette row,
  // so commands can be typed and run without browsing. Uses the live input
  // value (not state) so the lookup always sees the very latest keystroke.
  const resolveSlashAction = (value: string) => {
    const query = getSlashQuery(value);
    if (!query) return slashActions[slashIndex];
    return (
      slashActions.find((action) =>
        (action.keywords ?? []).some((keyword) => keyword === query),
      ) ?? slashActions[slashIndex]
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (slashActions.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIndex((current) =>
            e.key === "ArrowDown"
              ? (current + 1) % slashActions.length
              : (current - 1 + slashActions.length) % slashActions.length,
          );
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const action = resolveSlashAction(e.currentTarget.value);
          if (action) pickSlashAction(action);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const action = resolveSlashAction(e.currentTarget.value);
          if (action) pickSlashAction(action);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPromptValue("");
        return;
      }
    }
    const isPlainArrow = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const isSingleLine = !e.currentTarget.value.includes("\n");
    const selectionIsComplete =
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === e.currentTarget.value.length;
    const atStart = e.currentTarget.selectionStart === 0;
    const atEnd = e.currentTarget.selectionEnd === e.currentTarget.value.length;

    if (isPlainArrow && e.key === "ArrowUp") {
      if ((isSingleLine || atStart || selectionIsComplete) && promptHistory.length > 0) {
        e.preventDefault();
        moveHistory("older");
      }
      return;
    }

    if (isPlainArrow && e.key === "ArrowDown") {
      if ((isSingleLine || atEnd || selectionIsComplete) && historyIndexRef.current !== null) {
        e.preventDefault();
        moveHistory("newer");
      }
      return;
    }

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canAutoInsert) {
      e.preventDefault();
      void autoInsertResponse().catch(() => undefined);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="h-screen w-screen m-0 p-0 bg-transparent flex flex-col justify-start overflow-hidden select-none">
      <div
        className={cn(
          "isolate flex h-full w-full flex-col relative",
          "rounded-xl border border-[var(--pe-border)]",
          "bg-[var(--pe-bg)] shadow-2xl",
          "backdrop-blur-2xl overflow-hidden",
        )}
      >
        {/* Update available banner */}
        {pendingUpdate && (
          <div className="flex items-center justify-between gap-3 border-b border-cyan-400/20 bg-cyan-400/[0.08] px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Download className="h-3.5 w-3.5 shrink-0 text-[var(--pe-accent-strong)]" />
              <span
                className={cn(
                  "truncate text-[11px]",
                  updateFailed ? "text-[var(--pe-amber-strong)]" : "text-cyan-100",
                )}
              >
                {updateFailed
                  ? t(currentLang, "updateFailed")
                  : t(currentLang, "updateAvailable").replace(
                      "{0}",
                      pendingUpdate.version,
                    )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void installUpdate()}
                disabled={updating}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition select-none",
                  updating
                    ? "cursor-wait bg-[var(--pe-hover)] text-[var(--pe-text-muted)]"
                    : "bg-cyan-500/90 text-zinc-950 hover:bg-cyan-400",
                )}
              >
                {updating ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t(currentLang, "updating")}
                  </>
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {!updating && t(currentLang, "installRestart")}
              </button>
              <button
                type="button"
                onClick={() => setPendingUpdate(null)}
                title={t(currentLang, "dismiss")}
                className="rounded-md p-1 text-[var(--pe-accent-strong)]/70 transition hover:bg-[var(--pe-hover)] hover:text-cyan-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Title bar / drag region */}
        <div
          className="flex items-center justify-between border-b border-[var(--pe-border-soft)] px-3 py-2 cursor-grab active:cursor-grabbing select-none"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
          data-tauri-drag-region
          onMouseDown={(e) => {
            if (e.button === 0 && isTauri()) {
              const target = e.target as HTMLElement;
              if (!target.closest("button, input, select, textarea")) {
                try {
                  void getCurrentWindow().startDragging();
                } catch {
                  // Fallback
                }
              }
            }
          }}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 shadow-lg shadow-cyan-500/20">
              <Sparkles className="h-3.5 w-3.5 text-zinc-950" strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="text-[12px] font-semibold tracking-tight text-[var(--pe-text-strong)]">
                SpotAI
              </div>
              <div
                className={cn(
                  "text-[10px]",
                  shortcutError ? "text-[var(--pe-rose-strong)]" : "text-[var(--pe-text-muted)]",
                )}
                title={shortcutError ?? undefined}
              >
                {booting
                  ? t(currentLang, "starting")
                  : shortcutError
                    ? t(currentLang, "shortcutUnavailable")
                    : `${settings.globalShortcut || "Alt+Space"} | ${t(currentLang, "aiSpotlight")}`}
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-1"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
            <ProviderBadge
              provider={provider}
              model={model}
              models={models}
              customProviders={settings.customProviders || []}
              ollamaOnline={ollamaOnline}
              lang={currentLang}
              onRefresh={() => void reloadModels(settings)}
              onChange={handleProviderChange}
            />
            {/* Voice input only exists in the desktop runtime: without Tauri the
                capture backend is unavailable, so hide the mic button. */}
            {isTauri() && (
              <button
                type="button"
                onClick={toggleVoiceCapture}
                title={recording ? "Recording… (Alt+V)" : t(currentLang, "voiceInput") || "Voice input"}
                aria-label={recording ? "Stop recording" : "Voice input"}
                className={cn(
                  "rounded-lg p-1.5 transition",
                  recording
                    ? "bg-rose-400/15 text-[var(--pe-rose-strong)] animate-pulse"
                    : "text-[var(--pe-text-muted)] hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]",
                )}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={toggleIncognito}
              title={
                incognito ? t(currentLang, "incognitoOn") : t(currentLang, "incognito")
              }
              aria-label={
                incognito ? t(currentLang, "incognitoOn") : t(currentLang, "incognito")
              }
              className={cn(
                "rounded-lg p-1.5 transition",
                incognito
                  ? "bg-violet-400/15 text-[var(--pe-violet-strong)]"
                  : "text-[var(--pe-text-muted)] hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]",
              )}
            >
              <EyeOff className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={t(currentLang, "settingsTitle")}
              className="rounded-lg p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={dismissOverlay}
              title={t(currentLang, "hideTitle")}
              className="rounded-lg p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Context strip — always visible so clipboard context can be captured,
            refreshed or dismissed at any time without restarting the app. */}
        <div className="flex items-start gap-2 border-b border-[var(--pe-border-faint)] bg-cyan-400/[0.03] px-3 py-2">
          <Clipboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--pe-accent-strong)]" />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-[var(--pe-accent-strong)]">
              {t(currentLang, "capturedContext")}
              {contextText ? (
                <>
                  <span className="normal-case tracking-normal text-[var(--pe-text-muted)]">
                    {t(currentLang, contextKindLabels[contextKind])}
                  </span>
                  {truncated && (
                    <span className="normal-case tracking-normal text-[var(--pe-amber-strong)]">
                      {t(currentLang, "truncated")}
                    </span>
                  )}
                  <span className="font-normal normal-case tracking-normal text-[var(--pe-text-faint)]">
                    {contextText.length.toLocaleString()} {t(currentLang, "chars")}
                  </span>
                  {capturedAt && (
                    <span className="font-normal normal-case tracking-normal text-[var(--pe-text-faint)]">
                      · {t(currentLang, "capturedAt")} {formatCaptureTime(capturedAt, currentLang)}
                    </span>
                  )}
                </>
              ) : (
                <span className="font-normal normal-case tracking-normal text-[var(--pe-text-muted)]">
                  {t(currentLang, "noContextHint")}
                </span>
              )}
            </div>
            {contextText ? (
              <div className="custom-scroll max-h-20 overflow-y-auto whitespace-pre-wrap break-all pr-1 font-mono text-[11px] leading-relaxed text-[var(--pe-text-soft)]">
                {contextText}
              </div>
            ) : (
              <p className="text-[11px] italic leading-relaxed text-[var(--pe-text-faint)]">
                {t(currentLang, "noContextDesc")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setPasteDraft(contextText);
                setPasteOpen((open) => !open);
              }}
              title={t(currentLang, "pasteManual")}
              aria-label={t(currentLang, "pasteManual")}
              className={cn(
                "rounded-md p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-accent-strong)]",
                pasteOpen && "bg-[var(--pe-hover)] text-[var(--pe-accent-strong)]",
              )}
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
            </button>
            {contextText && (
              <button
                type="button"
                onClick={() => {
                  void setClipboardText(contextText)
                    .then(() => {
                      setCopiedFlash(true);
                      window.setTimeout(() => setCopiedFlash(false), 1800);
                    })
                    .catch(() => undefined);
                }}
                title={t(currentLang, "copyContext")}
                aria-label={t(currentLang, "copyContext")}
                className="rounded-md p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-accent-strong)]"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void refresh().then((ok) => {
                  if (!ok) {
                    setContextRefreshFailed(true);
                    window.setTimeout(() => setContextRefreshFailed(false), 2000);
                  }
                });
              }}
              title={t(currentLang, "refreshContext")}
              aria-label={t(currentLang, "refreshContext")}
              className="rounded-md p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-accent-strong)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {contextText && (
              <button
                type="button"
                onClick={clearContext}
                title={t(currentLang, "dismiss")}
                aria-label={t(currentLang, "dismiss")}
                className="rounded-md p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-rose-strong)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Manual paste panel */}
        {pasteOpen && (
          <div className="border-b border-[var(--pe-border-faint)] bg-[var(--pe-bg-2)] px-3 py-2">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--pe-accent-strong)]">
              {t(currentLang, "pasteManualTitle")}
            </div>
            <textarea
              value={pasteDraft}
              onChange={(e) => setPasteDraft(e.target.value)}
              onKeyDown={(e) => {
                // Stop propagation so the global handlers (Esc dismisses the
                // window, Ctrl+Enter auto-inserts) do not fire for the panel.
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  const text = pasteDraft.trim();
                  if (text) {
                    setManualContext(text);
                    setPasteOpen(false);
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setPasteOpen(false);
                }
              }}
              rows={3}
              placeholder={t(currentLang, "pasteManualPlaceholder")}
              className={cn(
                "w-full resize-none rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--pe-text-strong)] placeholder:text-[var(--pe-text-faint)] outline-none transition-colors focus:border-cyan-400/40",
                "font-mono",
              )}
              autoFocus
              spellCheck={false}
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] text-[var(--pe-text-faint)]">
                {t(currentLang, "pasteManualHint")}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPasteOpen(false)}
                  className="rounded-lg px-2.5 py-1 text-[11px] text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
                >
                  {t(currentLang, "cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const text = pasteDraft.trim();
                    if (text) {
                      setManualContext(text);
                      setPasteOpen(false);
                    }
                  }}
                  disabled={!pasteDraft.trim()}
                  className="rounded-lg bg-cyan-500/80 px-2.5 py-1 text-[11px] font-medium text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-[var(--pe-hover)] disabled:text-[var(--pe-text-faint)]"
                >
                  {t(currentLang, "useText")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transcribing indicator */}
        {transcribing && !recording && (
          <div className="flex items-center gap-2 border-b border-[var(--pe-border-faint)] bg-cyan-400/[0.05] px-3 py-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--pe-accent-strong)]" />
            <span className="text-[11px] font-medium text-[var(--pe-accent-strong)]">
              {t(currentLang, "transcribing") || "Transcribing…"}
            </span>
            {recordingDuration != null && (
              <span className="font-mono text-[10px] text-[var(--pe-text-faint)]">
                {`· ${t(currentLang, "recordingDuration") || "duration"} ${formatDuration(recordingDuration)}`}
              </span>
            )}
          </div>
        )}

        {/* Recording indicator */}
        {recording && (
          <div className="flex items-center gap-2 border-b border-[var(--pe-border-faint)] bg-rose-400/[0.05] px-3 py-1.5">
            <Mic className="h-4 w-4 animate-pulse text-[var(--pe-rose-strong)]" />
            <span className="text-[11px] font-medium text-[var(--pe-rose-strong)]">
              {t(currentLang, "recording") || "Recording…"}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-[var(--pe-text-muted)]">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--pe-rose-strong)] animate-pulse" />
              <span>{t(currentLang, "recordingHint") || "Release Alt+V to stop"}</span>
              {recordingSince && (
                <span className="font-mono text-[var(--pe-text-faint)]">
                  {`· ${t(currentLang, "recordingSince") || "started at"} ${formatCaptureTime(recordingSince, currentLang)} · ${formatElapsed(recordingSince, elapsedNow)}`}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={toggleVoiceCapture}
              className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-[var(--pe-text-muted)] transition hover:bg-rose-400/15 hover:text-[var(--pe-rose-strong)]"
            >
              {t(currentLang, "stop") || "Stop"}
            </button>
          </div>
        )}

        {/* Voice error toast */}
        {voiceError && !recording && (
          <div className="flex items-center gap-2 border-b border-[var(--pe-border-faint)] bg-rose-400/[0.05] px-3 py-1.5">
            <span className="text-[11px] text-[var(--pe-rose-strong)]">
              {voiceError}
            </span>
            <button
              type="button"
              onClick={() => setVoiceError(null)}
              className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-[var(--pe-text-muted)] transition hover:bg-rose-400/15 hover:text-[var(--pe-rose-strong)]"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Pasted image context (vision models) */}
        {contextImage && (
          <div className="flex items-center gap-2 border-b border-[var(--pe-border-faint)] bg-violet-400/[0.05] px-3 py-1.5">
            <img
              src={contextImage.dataUrl}
              alt=""
              title={t(currentLang, "pasteImageHint")}
              className="h-9 w-9 shrink-0 rounded-md border border-[var(--pe-border)] object-cover shadow-md"
            />
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--pe-violet-strong)]">
              {t(currentLang, "imageContext")}
            </span>
            <span className="font-mono text-[10px] text-[var(--pe-text-muted)]">
              {contextImage.mime}
            </span>
            {provider === "deepseek" && (
              <span className="text-[10px] text-[var(--pe-amber-strong)]">
                {t(currentLang, "imageUnsupported")}
              </span>
            )}
            <button
              type="button"
              onClick={() => setContextImage(null)}
              className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-rose-strong)]"
            >
              {t(currentLang, "removeImage")}
            </button>
          </div>
        )}

        {/* Input */}
        <form onSubmit={onSubmit} className="relative px-3 pt-3">
          <div
            className={cn(
              "relative rounded-xl border border-[var(--pe-border)] bg-[var(--pe-input)] transition-colors",
              "focus-within:border-cyan-400/30 focus-within:bg-[var(--pe-input)] focus-within:shadow-[0_0_0_3px_rgba(34,211,238,0.06)]",
            )}
          >
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={hasResponse ? 2 : 3}
              placeholder={
                contextText || contextImage
                  ? t(currentLang, "placeholderContext")
                  : t(currentLang, "placeholderDefault")
              }
              className={cn(
                "w-full resize-none bg-transparent px-3.5 py-3 pr-14",
                "text-[14px] leading-relaxed text-[var(--pe-text-strong)] placeholder:text-[var(--pe-text-faint)]",
                "outline-none",
              )}
              spellCheck={false}
              disabled={isStreaming}
            />
            {/* Screen capture needs the desktop runtime (xcap captures the
                monitors); without Tauri captureScreens() returns [], so hide it. */}
            {isTauri() && (
              <button
                type="button"
                onClick={() => void startScreenCapture()}
                disabled={isStreaming || captureLoading}
                title={t(currentLang, "screenCapture")}
                className={cn(
                  "absolute bottom-2.5 right-12 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pe-text-muted)] transition-colors",
                  "hover:bg-[var(--pe-hover)] hover:text-[var(--pe-violet-strong)]",
                  (isStreaming || captureLoading) && "opacity-40",
                )}
              >
                {captureLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              title={t(currentLang, "sendPrompt")}
              className={cn(
                "absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                canSubmit
                  ? "bg-gradient-to-br from-cyan-400 to-violet-500 text-zinc-950 shadow-lg shadow-cyan-500/25 hover:brightness-110"
                  : "bg-[var(--pe-hover)] text-[var(--pe-text-faint)]",
              )}
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          </div>

          {/* Slash command palette */}
          {slashOpen && (
            <SlashMenu
              actions={slashActions}
              activeIndex={slashIndex}
              lang={currentLang}
              onHover={setSlashIndex}
              onPick={pickSlashAction}
            />
          )}
        </form>

        {/* Action chips + compact prompt history controls */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <ActionChips
              active={activeAction}
              disabled={isStreaming}
              onSelect={handleAction}
              onSelectCustom={handleSelectCustomAction}
              customActions={settings.customActions || []}
              lang={currentLang}
              contextKind={contextKind}
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--pe-border-soft)] pl-2">
            <button
              type="button"
              disabled={promptHistory.length === 0 || isStreaming}
              onClick={() => moveHistory("older")}
              className="rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] px-1.5 py-1 font-mono text-[12px] leading-none text-[var(--pe-text-soft)] transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-[var(--pe-accent-strong)] disabled:cursor-not-allowed disabled:opacity-30"
              title={t(currentLang, "historyOlder")}
              aria-label={t(currentLang, "historyOlder")}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={promptHistory.length === 0 || isStreaming}
              onClick={() => moveHistory("newer")}
              className="rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] px-1.5 py-1 font-mono text-[12px] leading-none text-[var(--pe-text-soft)] transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-[var(--pe-accent-strong)] disabled:cursor-not-allowed disabled:opacity-30"
              title={t(currentLang, "historyNewer")}
              aria-label={t(currentLang, "historyNewer")}
            >
              ↓
            </button>
          </div>
        </div>

        {/* Transient feedback toasts (copy / clipboard read failure) */}
        {(copiedFlash || contextRefreshFailed) && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-lg",
                copiedFlash
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400 shadow-emerald-500/10"
                  : "border-rose-400/30 bg-rose-400/10 text-rose-400 shadow-rose-500/10",
              )}
            >
              {copiedFlash ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {copiedFlash
                ? t(currentLang, "copiedToClipboard")
                : t(currentLang, "clipboardUnavailable")}
            </div>
          </div>
        )}

        {/* Response */}
        {hasResponse && (
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
            <ResponsePanel
              messages={messages}
              current={response}
              status={status}
              error={error}
              lang={currentLang}
              model={model}
              chatTitle={
                conversations.find(
                  (conversation) => conversation.id === activeConversationId,
                )?.title
              }
              onStop={() => void stop()}
              onNewChat={newChat}
              onAutoInsertSuccess={clearOverlayState}
              onRegenerate={() => void regenerate()}
              onEditPrompt={editPrompt}
              chats={{
                conversations,
                activeId: activeConversationId,
                onSelect: selectConversation,
                onRename: renameConversation,
                onDelete: (id) => void deleteConversation(id),
                onTogglePin: togglePinned,
              }}
            />
          </div>
        )}

        {/* Footer hints / first-run onboarding */}
        {!hasResponse &&
          (showOnboarding ? (
            <div className="flex flex-col items-start gap-3 border-t border-[var(--pe-border-faint)] px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 shadow-lg shadow-cyan-500/20">
                  <Sparkles className="h-4 w-4 text-zinc-950" strokeWidth={2.5} />
                </div>
                <span className="text-[12px] font-semibold text-[var(--pe-text-strong)]">
                  {t(currentLang, "onboardingTitle")}
                </span>
              </div>
              <ol className="space-y-1.5 text-[11px] leading-relaxed text-[var(--pe-text-soft)]">
                <li>{t(currentLang, "onboardingStep1")}</li>
                <li>{t(currentLang, "onboardingStep2")}</li>
                <li>
                  {t(currentLang, "onboardingStep3").replace(
                    "{0}",
                    settings.globalShortcut || "Alt+Space",
                  )}
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/90 px-3 py-1.5 text-[11px] font-medium text-zinc-950 transition hover:bg-cyan-400"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t(currentLang, "openSettings")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between border-t border-[var(--pe-border-faint)] px-3 py-2 text-[10px] text-[var(--pe-text-faint)]">
            <span>
              <kbd className="rounded border border-[var(--pe-border)] bg-[var(--pe-input)] px-1 py-0.5 font-mono">
                Enter
              </kbd>{" "}
              {t(currentLang, "footerRun")}
              <span className="mx-1.5 text-[var(--pe-text-faint)]">|</span>
              <kbd className="rounded border border-[var(--pe-border)] bg-[var(--pe-input)] px-1 py-0.5 font-mono">
                Shift+Enter
              </kbd>{" "}
              {t(currentLang, "footerNewline")}
              <span className="mx-1.5 text-[var(--pe-text-faint)]">|</span>
              <kbd className="rounded border border-[var(--pe-border)] bg-[var(--pe-input)] px-1 py-0.5 font-mono">
                Esc
              </kbd>{" "}
              {t(currentLang, "footerHide")}
              <span className="mx-1.5 text-[var(--pe-text-faint)]">|</span>
              <kbd className="rounded border border-[var(--pe-border)] bg-[var(--pe-input)] px-1 py-0.5 font-mono">
                Ctrl+Enter
              </kbd>{" "}
              {t(currentLang, "footerInsert")}

            </span>
            <span className="flex items-center gap-2 text-[var(--pe-text-faint)]">
              <button
                type="button"
                onClick={() => void openExternalUrl("https://github.com/jaimitus/SpotAI")}
                className="inline-flex items-center gap-1 text-[var(--pe-text-muted)] hover:text-cyan-400 transition cursor-pointer"
                title={`SpotAI v${APP_VERSION} on GitHub`}
              >
                <ExternalLink className="h-3 w-3" />
                <span>v{APP_VERSION}</span>
              </button>
              <span>|</span>
              <span>
                {provider === "ollama" || provider === "lmstudio"
                  ? t(currentLang, "local")
                  : t(currentLang, "cloud")}{" "}
                | {model}
              </span>
            </span>
            </div>
          )
        )}

        {/* Custom resize handles — the borderless window has no native frame */}
        <div
          className="absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-ns-resize"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          onMouseDown={(e) => {
            e.preventDefault();
            if (!isTauri()) return;
            try {
              void getCurrentWindow().startResizeDragging("South");
            } catch {
              // Fallback: ignore
            }
          }}
        />
        <div
          className="absolute bottom-0 right-0 z-20 flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded-tl-md text-[var(--pe-text-faint)] transition hover:text-[var(--pe-accent-strong)]"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          onMouseDown={(e) => {
            e.preventDefault();
            if (!isTauri()) return;
            try {
              void getCurrentWindow().startResizeDragging("SouthEast");
            } catch {
              // Fallback: ignore
            }
          }}
          title={t(currentLang, "resizeWindow")}
          aria-label={t(currentLang, "resizeWindow")}
        >
          <MoveDiagonal2 className="h-3.5 w-3.5" />
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => {
          setSettings(s);
          saveSettings(s);
        }}
      />

      {captureOpen && (
        <ScreenCaptureOverlay
          screens={capturedScreens}
          lang={currentLang}
          onCapture={(mime, dataUrl) => {
            setContextImage({ mime, dataUrl });
            setCaptureOpen(false);
          }}
          onClose={() => setCaptureOpen(false)}
        />
      )}
    </div>
  );
}
