import {
  ArrowUp,
  Clipboard,
  Download,
  ExternalLink,
  Loader2,
  MoveDiagonal2,
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
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useClipboardContext } from "../hooks/useClipboardContext";
import { useLLMStream } from "../hooks/useLLMStream";
import { t } from "../lib/i18n";
import { buildActionPrompt } from "../lib/prompts";
import { APP_VERSION } from "../lib/version";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import type { Update } from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkOllamaHealth,
  fetchCloudModels,
  fetchLmStudioModels,
  fetchLocalModels,
  fetchOpenAICompatibleModels,
  getApiKeyStatus,
  hideWindow,
  autoInsertText,
  isTauri,
  listenWindowShown,
  loadSettings,
  openExternalUrl,
  registerShortcut,
  resolveHost,
  saveSettings,
} from "../lib/tauri";
import type {
  ActionChipId,
  AppSettings,
  ChatMessage,
  ContextKind,
  CustomAction,
  ModelInfo,
} from "../types";
import { cn } from "../utils/cn";
import { ActionChips } from "./ActionChips";
import { ProviderBadge } from "./ProviderBadge";
import { ResponsePanel } from "./ResponsePanel";
import { SettingsModal } from "./SettingsModal";

const PROMPT_HISTORY_KEY = "spotai.prompt-history.v2";
const LEGACY_PROMPT_HISTORY_KEY = "spotai.prompt-history.v1";
const MAX_PROMPT_HISTORY = 20;
const CONVERSATION_KEY = "spotai.conversation.v1";
const MAX_CONVERSATION_MESSAGES = 40;
const WINDOW_SIZE_KEY = "spotai.window-size.v1";

function loadConversation(): ChatMessage[] {
  try {
    const value = localStorage.getItem(CONVERSATION_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ChatMessage | null => {
        if (
          typeof item === "object" &&
          item !== null &&
          "role" in item &&
          "content" in item &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.trim()
        ) {
          return { role: item.role, content: item.content };
        }
        return null;
      })
      .filter((item): item is ChatMessage => item !== null)
      .slice(-MAX_CONVERSATION_MESSAGES);
  } catch {
    return [];
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
  const [messages, setMessages] = useState<ChatMessage[]>(loadConversation);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyIndexRef = useRef<number | null>(null);
  const historyDraftRef = useRef("");
  const appliedShortcutRef = useRef<string | null>(null);
  const providerRef = useRef(provider);
  const { contextText, clearContext, refresh, truncated, kind: contextKind } = useClipboardContext();
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

  const recordPrompt = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setPromptHistory((current) => [
      { prompt: normalized, response: "" },
      ...current.filter((item) => item.prompt !== normalized),
    ].slice(0, MAX_PROMPT_HISTORY));
    historyIndexRef.current = null;
    historyDraftRef.current = "";
  }, []);

  const recordResponse = useCallback((promptValue: string, responseValue: string) => {
    if (!responseValue) return;
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
  }, []);

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
    reset();
    setPromptValue("");
    setActiveAction(null);
  }, [reset, setPromptValue]);

  const newChat = useCallback(() => {
    clearOverlayState();
    setMessages([]);
  }, [clearOverlayState]);

  const dismissOverlay = useCallback(() => {
    if (status === "streaming") {
      void stop();
    }
    reset();
    setPromptValue("");
    setActiveAction(null);
    void hideWindow();
  }, [status, stop, reset, setPromptValue]);

  const currentLang = settings.language || "en";
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
    setModel((current) =>
      availableModels.some(
        (candidate) => candidate.provider === effectiveProvider && candidate.id === current,
      )
        ? current
        : (availableModels.find(
            (candidate) => candidate.provider === effectiveProvider,
          )?.id ?? ""),
    );
    setBooting(false);
  }, []);

  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

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
    try {
      localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(promptHistory));
      localStorage.removeItem(LEGACY_PROMPT_HISTORY_KEY);
    } catch {
      // Prompt history is a convenience; the overlay must still work if storage is unavailable.
    }
  }, [promptHistory]);

  useEffect(() => {
    try {
      // Keep the newest messages within both a message and a character budget so
      // long responses cannot bloat localStorage.
      const kept: ChatMessage[] = [];
      let totalChars = 0;
      for (const message of [...messages].reverse()) {
        if (kept.length >= MAX_CONVERSATION_MESSAGES) break;
        if (totalChars + message.content.length > 80_000) break;
        totalChars += message.content.length;
        kept.push(message);
      }
      kept.reverse();
      localStorage.setItem(CONVERSATION_KEY, JSON.stringify(kept));
    } catch {
      // Conversation persistence is best-effort; the overlay must still work.
    }
  }, [messages]);

  useEffect(() => {
    void reloadModels(settings);
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
    let unlisten: (() => void) | undefined;
    void listenWindowShown(focus).then((dispose) => {
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
  }, [settingsOpen, isStreaming, canAutoInsert, stop, dismissOverlay, autoInsertResponse]);

  const handleProviderChange = (p: string, m: string) => {
    setProvider(p);
    setModel(m);
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

  const canSubmit = useMemo(() => {
    if (isStreaming) return false;
    if (!prompt.trim() && !contextText.trim()) return false;
    if (!model) return false;
    return true;
  }, [isStreaming, prompt, contextText, model]);

  const submit = async () => {
    if (!canSubmit) return;

    let finalPrompt = prompt.trim();
    if (!finalPrompt && contextText) {
      finalPrompt = buildActionPrompt("explain", undefined, currentLang);
    }

    const userMessage: ChatMessage = { role: "user", content: finalPrompt };
    setMessages((current) => [...current, userMessage]);
    recordPrompt(finalPrompt);
    const completedResponse = await start({
      provider,
      model,
      prompt: finalPrompt,
      contextText: contextText || null,
      host: resolveHost(provider, settings),
      systemPrompt: settings.systemPrompt || null,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      history: messages,
    });
    if (completedResponse) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: completedResponse },
      ]);
      recordResponse(finalPrompt, completedResponse);
    } else {
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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  const contextPreview = contextText
    ? contextText.length > 160
      ? `${contextText.slice(0, 160)}...`
      : contextText
    : "";

  return (
    <div className="h-screen w-screen m-0 p-0 bg-transparent flex flex-col justify-start overflow-hidden select-none">
      <div
        className={cn(
          "isolate flex h-full w-full flex-col relative",
          "rounded-xl border border-white/15",
          "bg-[#0a0c12]/98 shadow-2xl",
          "backdrop-blur-2xl overflow-hidden",
        )}
      >
        {/* Update available banner */}
        {pendingUpdate && (
          <div className="flex items-center justify-between gap-3 border-b border-cyan-400/20 bg-cyan-400/[0.08] px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Download className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
              <span
                className={cn(
                  "truncate text-[11px]",
                  updateFailed ? "text-amber-300" : "text-cyan-100",
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
                    ? "cursor-wait bg-white/5 text-zinc-500"
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
                className="rounded-md p-1 text-cyan-300/70 transition hover:bg-white/5 hover:text-cyan-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Title bar / drag region */}
        <div
          className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 cursor-grab active:cursor-grabbing select-none"
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
              <div className="text-[12px] font-semibold tracking-tight text-zinc-100">
                SpotAI
              </div>
              <div
                className={cn(
                  "text-[10px]",
                  shortcutError ? "text-rose-300" : "text-zinc-500",
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
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={t(currentLang, "settingsTitle")}
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={dismissOverlay}
              title={t(currentLang, "hideTitle")}
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Context strip */}
        {contextText && (
          <div className="flex items-start gap-2 border-b border-white/[0.05] bg-cyan-400/[0.03] px-3 py-2">
            <Clipboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400/80" />
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-cyan-400/70">
                {t(currentLang, "capturedContext")}
                <span className="normal-case tracking-normal text-zinc-500">
                  {t(currentLang, contextKindLabels[contextKind])}
                </span>
                {truncated && (
                  <span className="normal-case tracking-normal text-amber-400/80">
                    {t(currentLang, "truncated")}
                  </span>
                )}
                <span className="font-normal normal-case tracking-normal text-zinc-600">
                  {contextText.length.toLocaleString()} {t(currentLang, "chars")}
                </span>
              </div>
              <p className="line-clamp-2 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-400">
                {contextPreview}
              </p>
            </div>
            <button
              type="button"
              onClick={clearContext}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
            >
              {t(currentLang, "dismiss")}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
            >
              {t(currentLang, "refresh")}
            </button>
          </div>
        )}

        {/* Input */}
        <form onSubmit={onSubmit} className="px-3 pt-3">
          <div
            className={cn(
              "relative rounded-xl border border-white/10 bg-white/[0.03] transition-colors",
              "focus-within:border-cyan-400/30 focus-within:bg-white/[0.04] focus-within:shadow-[0_0_0_3px_rgba(34,211,238,0.06)]",
            )}
          >
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={onKeyDown}
              rows={hasResponse ? 2 : 3}
              placeholder={
                contextText
                  ? t(currentLang, "placeholderContext")
                  : t(currentLang, "placeholderDefault")
              }
              className={cn(
                "w-full resize-none bg-transparent px-3.5 py-3 pr-14",
                "text-[14px] leading-relaxed text-zinc-100 placeholder:text-zinc-600",
                "outline-none",
              )}
              spellCheck={false}
              disabled={isStreaming}
            />
            <button
              type="submit"
              disabled={!canSubmit}
              title={t(currentLang, "sendPrompt")}
              className={cn(
                "absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                canSubmit
                  ? "bg-gradient-to-br from-cyan-400 to-violet-500 text-zinc-950 shadow-lg shadow-cyan-500/25 hover:brightness-110"
                  : "bg-white/5 text-zinc-600",
              )}
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          </div>
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
          <div className="flex shrink-0 items-center gap-0.5 border-l border-white/[0.06] pl-2">
            <button
              type="button"
              disabled={promptHistory.length === 0 || isStreaming}
              onClick={() => moveHistory("older")}
              className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1 font-mono text-[12px] leading-none text-zinc-400 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-30"
              title={t(currentLang, "historyOlder")}
              aria-label={t(currentLang, "historyOlder")}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={promptHistory.length === 0 || isStreaming}
              onClick={() => moveHistory("newer")}
              className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-1 font-mono text-[12px] leading-none text-zinc-400 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-30"
              title={t(currentLang, "historyNewer")}
              aria-label={t(currentLang, "historyNewer")}
            >
              ↓
            </button>
          </div>
        </div>

        {/* Response */}
        {hasResponse && (
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
            <ResponsePanel
              messages={messages}
              current={response}
              status={status}
              error={error}
              lang={currentLang}
              onStop={() => void stop()}
              onNewChat={newChat}
              onAutoInsertSuccess={clearOverlayState}
            />
          </div>
        )}

        {/* Footer hints / first-run onboarding */}
        {!hasResponse &&
          (showOnboarding ? (
            <div className="flex flex-col items-start gap-3 border-t border-white/[0.04] px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 shadow-lg shadow-cyan-500/20">
                  <Sparkles className="h-4 w-4 text-zinc-950" strokeWidth={2.5} />
                </div>
                <span className="text-[12px] font-semibold text-zinc-100">
                  {t(currentLang, "onboardingTitle")}
                </span>
              </div>
              <ol className="space-y-1.5 text-[11px] leading-relaxed text-zinc-400">
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
            <div className="flex items-center justify-between border-t border-white/[0.04] px-3 py-2 text-[10px] text-zinc-600">
            <span>
              <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
                Enter
              </kbd>{" "}
              {t(currentLang, "footerRun")}
              <span className="mx-1.5 text-zinc-700">|</span>
              <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
                Shift+Enter
              </kbd>{" "}
              {t(currentLang, "footerNewline")}
              <span className="mx-1.5 text-zinc-700">|</span>
              <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
                Esc
              </kbd>{" "}
              {t(currentLang, "footerHide")}
              <span className="mx-1.5 text-zinc-700">|</span>
              <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
                Ctrl+Enter
              </kbd>{" "}
              {t(currentLang, "footerInsert")}

            </span>
            <span className="flex items-center gap-2 text-zinc-600">
              <button
                type="button"
                onClick={() => void openExternalUrl("https://github.com/jaimitus/SpotAI")}
                className="inline-flex items-center gap-1 text-zinc-500 hover:text-cyan-400 transition cursor-pointer"
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
          className="absolute bottom-0 right-0 z-20 flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded-tl-md text-zinc-700 transition hover:text-cyan-300"
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
    </div>
  );
}
