import {
  ArrowUp,
  Clipboard,
  ExternalLink,
  History,
  Loader2,
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
import { useHistory } from "../hooks/useHistory";
import { useLLMStream } from "../hooks/useLLMStream";
import { t } from "../lib/i18n";
import { buildActionPrompt } from "../lib/prompts";
import {
  checkOllamaHealth,
  fetchCloudModels,
  fetchLmStudioModels,
  fetchLocalModels,
  getShortcutStatus,
  hideWindow,
  isTauri,
  listenWindowShown,
  loadSettings,
  loadSettingsSync,
  migrateLegacySettings,
  openExternalUrl,
  resolveHost,
  saveSettings,
  setGlobalShortcut,
} from "../lib/tauri";
import type {
  ActionChipId,
  AppSettings,
  CustomAction,
  HistoryEntry,
  ModelInfo,
  ProviderId,
} from "../types";
import { cn } from "../utils/cn";
import { ActionChips } from "./ActionChips";
import { HistoryPanel } from "./HistoryPanel";
import { ProviderBadge } from "./ProviderBadge";
import { ResponsePanel } from "./ResponsePanel";
import { SettingsModal } from "./SettingsModal";

export function SpotlightWindow() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettingsSync());
  const [provider, setProvider] = useState<ProviderId>(settings.defaultProvider);
  const [model, setModel] = useState(settings.defaultModel);
  const [prompt, setPrompt] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ollamaOnline, setOllamaOnline] = useState(false);
  const [booting, setBooting] = useState(true);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [activeShortcut, setActiveShortcut] = useState<string>(
    settings.globalShortcut || "Alt+Space",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewedEntry, setPreviewedEntry] = useState<HistoryEntry | null>(null);
  const [restoreFlash, setRestoreFlash] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { contextText, clearContext, refresh, truncated } = useClipboardContext();
  const { response, status, error, start, stop, reset } = useLLMStream();
  const history = useHistory();

  const currentLang = settings.language || "en";
  const isStreaming = status === "streaming";
  const hasResponse = Boolean(response) || status !== "idle";

  // Load models + health
  const reloadModels = useCallback(async (s: AppSettings) => {
    const [ollamaModels, lmStudioModels, cloudModels, health] = await Promise.all([
      fetchLocalModels(s.ollamaHost),
      fetchLmStudioModels(s.lmstudioHost),
      fetchCloudModels(),
      checkOllamaHealth(s.ollamaHost),
    ]);
    const availableModels: ModelInfo[] = [
      ...ollamaModels,
      ...lmStudioModels,
      ...cloudModels,
    ];
    setModels(availableModels);
    setOllamaOnline(health.ollama);
    setModel((current) => {
      if (
        availableModels.some(
          (candidate) =>
            candidate.provider === s.defaultProvider && candidate.id === current,
        )
      ) {
        return current;
      }
      return (
        availableModels.find(
          (candidate) => candidate.provider === s.defaultProvider,
        )?.id ?? ""
      );
    });
    setBooting(false);
  }, []);

  // Hydrate from the Tauri-managed store on mount. Runs once: the
  // `loadSettingsSync` initialiser is enough for the first paint, and the
  // async refresh below picks up the latest persisted values plus triggers
  // the legacy `localStorage` -> Tauri migration when applicable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await migrateLegacySettings();
        const fresh = await loadSettings();
        if (cancelled) return;
        setSettings(fresh);
      } catch (cause) {
        // Non-fatal: the synchronous loader already gave us a valid copy
        // from the `localStorage` mirror, so the user can still use the
        // app even if the store is unreachable for some reason.
        // eslint-disable-next-line no-console
        console.warn("[spotai] failed to hydrate settings", cause);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void reloadModels(settings);
    void getShortcutStatus().then((status) => {
      setShortcutError(status.registered ? null : status.error || t(currentLang, "shortcutUnavailable"));
      const backendShortcut = status.shortcut;
      if (backendShortcut) {
        setActiveShortcut(backendShortcut);
      }
      // If the user has a different shortcut persisted, push it to the
      // backend so the global hotkey matches their preference. We compare
      // against the backend-reported value (falling back to the legacy
      // default) to avoid a useless round-trip on every boot.
      const persisted = settings.globalShortcut;
      if (persisted && persisted !== (backendShortcut ?? "Alt+Space") && isTauri()) {
        setGlobalShortcut(persisted)
          .then((applied) => {
            setActiveShortcut(applied);
            setShortcutError(null);
          })
          .catch((cause) => {
            setShortcutError(
              cause instanceof Error ? cause.message : String(cause),
            );
          });
      }
    });
  }, [settings, reloadModels, currentLang]);

  useEffect(() => {
    if (hasResponse && isTauri()) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow, LogicalSize }) => {
        getCurrentWindow().innerSize().then((size) => {
          if (size.height < 560) {
            void getCurrentWindow().setSize(new LogicalSize(size.width, 620));
          }
        });
      });
    }
  }, [hasResponse]);

  // Persist a history entry as soon as a stream completes successfully.
  // We do this in a separate effect so the act of submitting the prompt is
  // not blocked on the disk write, and so we capture the final response
  // text rather than an intermediate streaming snapshot.
  const lastPersistedRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "done" || !response || error) return;
    if (!prompt.trim() && !contextText.trim()) return;
    if (previewedEntry && previewedEntry.responsePreview === response) return;
    const key = `${prompt}|${response.slice(0, 64)}`;
    if (lastPersistedRef.current === key) return;
    lastPersistedRef.current = key;
    void history.add({
      provider,
      model,
      prompt: prompt.trim() || "(empty prompt)",
      responsePreview: response,
      contextPreview: contextText ? truncateContext(contextText) : null,
    });
  }, [status, response, error, prompt, contextText, provider, model, history, previewedEntry]);

  useEffect(() => {
    // Closing the history preview should fall back to the live response if
    // the user has one in progress; clearing the previewed entry restores
    // the default render path.
    if (!historyOpen && previewedEntry) {
      setPreviewedEntry(null);
    }
  }, [historyOpen, previewedEntry]);

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
        if (historyOpen) {
          setHistoryOpen(false);
          return;
        }
        if (isStreaming) {
          void stop();
        } else if (response) {
          reset();
          setPrompt("");
          setActiveAction(null);
        } else {
          void hideWindow();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      // Alt+H toggles the history panel. We only match a bare `h`/`H` (no
      // Ctrl/Meta) so we do not swallow copy-paste or other browser
      // shortcuts.
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        setHistoryOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlisten?.();
    };
  }, [settingsOpen, historyOpen, isStreaming, response, stop, reset]);

  const handleProviderChange = (p: ProviderId, m: string) => {
    setProvider(p);
    setModel(m);
    const next = { ...settings, defaultProvider: p, defaultModel: m };
    setSettings(next);
    void saveSettings(next);
  };

  const handleAction = (id: ActionChipId) => {
    setActiveAction(id);
    const template = buildActionPrompt(id, undefined, currentLang);
    setPrompt(template);
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
    setPrompt(customAction.prompt);
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

    await start({
      provider,
      model,
      prompt: finalPrompt,
      contextText: contextText || null,
      host: resolveHost(provider, settings),
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const handleRestoreFromHistory = useCallback(
    (entry: HistoryEntry) => {
      setPrompt(entry.prompt);
      setActiveAction(null);
      setHistoryOpen(false);
      setPreviewedEntry(null);
      setRestoreFlash(true);
      setTimeout(() => setRestoreFlash(false), 800);
      // Restore the provider/model the user used historically so the next
      // re-send does not silently switch engines.
      if (models.some((m) => m.provider === entry.provider && m.id === entry.model)) {
        setProvider(entry.provider as ProviderId);
        setModel(entry.model);
      }
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        const el = inputRef.current;
        if (el) {
          const end = el.value.length;
          el.selectionStart = end;
          el.selectionEnd = end;
        }
      });
    },
    [models],
  );

  const handleShowHistoryResponse = useCallback((entry: HistoryEntry) => {
    setPreviewedEntry(entry);
    setHistoryOpen(false);
  }, []);

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
        {/* Title bar / drag region. We rely on Tauri's native
            `data-tauri-drag-region` attribute combined with the CSS
            `WebkitAppRegion: drag` so the OS handles dragging directly.
            Mixing a custom `onMouseDown` with `startDragging()` interferes
            with the click events on the header buttons (Settings, History,
            Hide) because the native drag cancels `mouseup` if the cursor
            moves between `mousedown` and `mouseup`. The result was that
            clicking the Settings button felt like the click was "lost" and
            the modal would not open until the user clicked it several
            times. */}
        <div
          className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 cursor-grab active:cursor-grabbing select-none"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
          data-tauri-drag-region
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
                    : `${activeShortcut} | ${t(currentLang, "shortcutLabel")}`}
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
              ollamaOnline={ollamaOnline}
              onChange={handleProviderChange}
            />
            <button
              type="button"
              onClick={() => setHistoryOpen((current) => !current)}
              title={t(currentLang, "historyToggleHint")}
              className={cn(
                "rounded-lg p-1.5 transition",
                historyOpen
                  ? "bg-cyan-400/15 text-cyan-300"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
              )}
            >
              <History className="h-4 w-4" />
            </button>
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
              onClick={() => void hideWindow()}
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
              onChange={(e) => setPrompt(e.target.value)}
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

        {/* Action chips (Built-in + Custom Prompt Buttons) */}
        <div className="px-3 py-2.5">
          <ActionChips
            active={activeAction}
            disabled={isStreaming}
            onSelect={handleAction}
            onSelectCustom={handleSelectCustomAction}
            customActions={settings.customActions || []}
            lang={currentLang}
          />
        </div>

        {/* Response */}
        {(hasResponse || historyOpen) && (
          <div className="relative flex min-h-0 flex-1 flex-col px-3 pb-3">
            {hasResponse && (
              <ResponsePanel
                response={previewedEntry?.responsePreview ?? response}
                status={previewedEntry ? "done" : status}
                error={error}
                lang={currentLang}
                onStop={() => void stop()}
                onClear={() => {
                  reset();
                  setActiveAction(null);
                  setPreviewedEntry(null);
                }}
              />
            )}
            {historyOpen && (
              <HistoryPanel
                open={historyOpen}
                entries={history.entries}
                busy={!history.ready}
                lang={currentLang}
                onClose={() => setHistoryOpen(false)}
                onRestore={handleRestoreFromHistory}
                onShowResponse={handleShowHistoryResponse}
                onClear={() => void history.clear()}
              />
            )}
            {restoreFlash && (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
                <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] text-cyan-200">
                  {t(currentLang, "historyRestoredToast")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Footer hints */}
        {!hasResponse && (
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
                Alt+H
              </kbd>{" "}
              {t(currentLang, "historyToggle").toLowerCase()}
              <span className="mx-1.5 text-zinc-700">|</span>
              <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
                esc
              </kbd>{" "}
              {t(currentLang, "footerHide")}
            </span>
            <span className="flex items-center gap-2 text-zinc-600">
              <button
                type="button"
                onClick={() => void openExternalUrl("https://github.com/jaimitus/SpotAI")}
                className="inline-flex items-center gap-1 text-zinc-500 hover:text-cyan-400 transition cursor-pointer"
                title="SpotAI v1.1.0 on GitHub"
              >
                <ExternalLink className="h-3 w-3" />
                <span>v1.1.0</span>
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
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={(s) => {
          setSettings(s);
          void saveSettings(s);
          if (s.globalShortcut) {
            setActiveShortcut(s.globalShortcut);
          }
        }}
      />
    </div>
  );
}

function truncateContext(text: string): string {
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
