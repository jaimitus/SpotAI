import {
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Keyboard,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import {
  checkOllamaHealth,
  deleteApiKey,
  getApiKeyStatus,
  getShortcutStatus,
  isTauri,
  openExternalUrl,
  saveApiKeys,
  saveSettings,
  setGlobalShortcut,
} from "../lib/tauri";
import type {
  ApiKeyStatus,
  ApiKeys,
  AppSettings,
  CustomAction,
  HealthStatus,
  Language,
  ShortcutStatus,
} from "../types";
import { cn } from "../utils/cn";
import { ShortcutRecorder } from "./ShortcutRecorder";

const DEFAULT_SHORTCUT = "Alt+Space";

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}

export function SettingsModal({
  open,
  settings,
  onClose,
  onSave,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [keys, setKeys] = useState<ApiKeys>({});
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "providers" | "customButtons">("general");
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // New Custom Button Form state
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft({
      ...settings,
      language: settings.language || "en",
      customActions: settings.customActions || [],
      globalShortcut: settings.globalShortcut || DEFAULT_SHORTCUT,
    });
    setKeys({});
    setSaveError(null);
    setLoading(true);

    // Hydrate the modal in parallel. We use allSettled so a slow / failed
    // network call (e.g. Ollama down) does not block the rest of the UI
    // and the user is never stuck waiting for the modal to become
    // interactive.
    let cancelled = false;
    void (async () => {
      const [keyResult, healthResult, shortcutResult] = await Promise.allSettled([
        isTauri() ? getApiKeyStatus() : Promise.resolve({} as ApiKeyStatus),
        checkOllamaHealth(settings.ollamaHost),
        isTauri() ? getShortcutStatus() : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (keyResult.status === "fulfilled") {
        setKeyStatus(keyResult.value);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[spotai] getApiKeyStatus failed", keyResult.reason);
      }
      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
      } else {
        setHealth({ ollama: false, ollamaVersion: null });
      }
      if (shortcutResult.status === "fulfilled" && shortcutResult.value) {
        const s = shortcutResult.value as ShortcutStatus;
        setShortcutStatus(s);
        if (s.shortcut) {
          setDraft((d) => ({ ...d, globalShortcut: s.shortcut! }));
        }
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const currentLang = draft.language || "en";

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Re-register the global shortcut before persisting the rest, so a bad
      // combination aborts the save with a clear message and the user does
      // not end up with a saved setting that the OS will not honour.
      const nextShortcut = (draft.globalShortcut || DEFAULT_SHORTCUT).trim();
      if (isTauri() && nextShortcut && nextShortcut !== (shortcutStatus?.shortcut ?? "")) {
        try {
          await setGlobalShortcut(nextShortcut);
          setShortcutStatus({
            registered: true,
            error: null,
            shortcut: nextShortcut,
          });
        } catch (cause) {
          setSaveError(
            `Could not apply shortcut "${nextShortcut}": ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          );
          setSaving(false);
          return;
        }
      }

      void saveSettings(draft);
      await saveApiKeys(keys);
      onSave(draft);
      setSavedFlash(true);
      setTimeout(() => {
        setSavedFlash(false);
        onClose();
      }, 450);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async (provider: keyof ApiKeys) => {
    try {
      await deleteApiKey(provider);
      setKeyStatus((current) => ({ ...current, [provider]: null }));
      setKeys((current) => ({ ...current, [provider]: null }));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const pingOllama = async () => {
    const h = await checkOllamaHealth(draft.ollamaHost);
    setHealth(h);
  };

  const handleAddCustomButton = () => {
    if (!newLabel.trim() || !newPrompt.trim()) return;
    const newBtn: CustomAction = {
      id: `custom_${Date.now()}`,
      label: newLabel.trim(),
      prompt: newPrompt.trim(),
      icon: "sparkles",
    };
    setDraft((d) => ({
      ...d,
      customActions: [...(d.customActions || []), newBtn],
    }));
    setNewLabel("");
    setNewPrompt("");
  };

  const handleDeleteCustomButton = (id: string) => {
    setDraft((d) => ({
      ...d,
      customActions: (d.customActions || []).filter((b) => b.id !== id),
    }));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 flex max-h-[min(660px,92vh)] w-full max-w-lg flex-col overflow-hidden",
          "rounded-2xl border border-white/10 bg-[#0c0e14] shadow-2xl shadow-black/80",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-2 text-zinc-100">
            <Settings2 className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-semibold tracking-tight">
              {t(currentLang, "settingsHeader")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-white/[0.06] bg-white/[0.01] px-4 py-2">
          {(
            [
              ["general", t(currentLang, "tabGeneral")],
              ["providers", t(currentLang, "tabProviders")],
              ["customButtons", t(currentLang, "tabCustomButtons")],
            ] as const
          ).map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all select-none",
                activeTab === tabKey
                  ? "bg-cyan-400/15 text-cyan-300 border border-cyan-400/30"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200 border border-transparent",
              )}
            >
              {label}
            </button>
          ))}
          {loading && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t(currentLang, "settingsLoading")}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="custom-scroll flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* TAB 1: GENERAL & LANGUAGE */}
          {activeTab === "general" && (
            <>
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  <Globe className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "languageLabel")}</span>
                </div>
                <Field label={t(currentLang, "languageDesc")}>
                  <select
                    value={draft.language}
                    onChange={(e) => update("language", e.target.value as Language)}
                    className={inputCls}
                  >
                    <option value="en" className="bg-[#0c0e14] text-zinc-100">
                      🇺🇸 English (Default)
                    </option>
                    <option value="es" className="bg-[#0c0e14] text-zinc-100">
                      🇪🇸 Español (España)
                    </option>
                    <option value="de" className="bg-[#0c0e14] text-zinc-100">
                      🇩🇪 Deutsch (German)
                    </option>
                  </select>
                </Field>
              </section>

              <section className="space-y-3 pt-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Generation & Limits
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Temperature | ${draft.temperature.toFixed(2)}`}>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={draft.temperature}
                      onChange={(e) =>
                        update("temperature", parseFloat(e.target.value))
                      }
                      className="w-full accent-cyan-400"
                    />
                  </Field>
                  <Field label="Max tokens">
                    <input
                      type="number"
                      min={256}
                      max={128000}
                      step={256}
                      value={draft.maxTokens}
                      onChange={(e) =>
                        update("maxTokens", parseInt(e.target.value || "4096", 10))
                      }
                      className={inputCls}
                    />
                  </Field>
                </div>
              </section>

              {/* Shortcut info */}
              <section className="space-y-2 pt-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  <Keyboard className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "shortcutRecorderLabel")}</span>
                </div>
                <Field label={t(currentLang, "shortcutRecorderHelp")}>
                  <ShortcutRecorder
                    value={draft.globalShortcut || DEFAULT_SHORTCUT}
                    defaultValue={DEFAULT_SHORTCUT}
                    onChange={(v) => update("globalShortcut", v)}
                    disabled={!isTauri()}
                  />
                  {shortcutStatus?.error && (
                    <p className="mt-1.5 text-[10px] text-rose-300">
                      {shortcutStatus.error}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-zinc-500 leading-normal">
                    {t(currentLang, "shortcutRecorderHint")}
                    {!isTauri() && ` ${t(currentLang, "shortcutRecorderRequiresRuntime")}`}
                  </p>
                </Field>
              </section>
            </>
          )}

          {/* TAB 2: AI PROVIDERS & KEYS */}
          {activeTab === "providers" && (
            <>
              {/* Local engines */}
              <section className="space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Local Engines
                </h3>

                <Field label={t(currentLang, "ollamaHostLabel")}>
                  <div className="flex gap-2">
                    <input
                      value={draft.ollamaHost}
                      onChange={(e) => update("ollamaHost", e.target.value)}
                      className={inputCls}
                      placeholder="http://127.0.0.1:11434"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={pingOllama}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-zinc-300 transition hover:bg-white/[0.08]"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Ping
                    </button>
                  </div>
                  {health && (
                    <p
                      className={cn(
                        "mt-1.5 text-[11px]",
                        health.ollama ? "text-emerald-400" : "text-zinc-500",
                      )}
                    >
                      {health.ollama
                        ? `Online${health.ollamaVersion ? ` | v${health.ollamaVersion}` : ""}`
                        : "Offline. Start Ollama to use local models."}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-zinc-500 leading-normal">
                    {t(currentLang, "ollamaHostHelp")}
                  </p>
                </Field>

                <Field label="LM Studio Host">
                  <input
                    value={draft.lmstudioHost}
                    onChange={(e) => update("lmstudioHost", e.target.value)}
                    className={inputCls}
                    placeholder="http://127.0.0.1:1234"
                    spellCheck={false}
                  />
                </Field>
              </section>

              {/* Cloud API keys */}
              <section className="space-y-3 pt-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Cloud API Keys (DPAPI Encrypted)
                </h3>

                {(
                  [
                    ["anthropic", "Anthropic (Claude)"],
                    ["openai", "OpenAI"],
                    ["groq", "Groq"],
                    ["deepseek", "DeepSeek"],
                  ] as const
                ).map(([id, label]) => (
                  <Field key={id} label={label}>
                    <div className="relative">
                      <input
                        type={show[id] ? "text" : "password"}
                        value={keys[id] ?? ""}
                        onChange={(e) =>
                          setKeys((k) => ({ ...k, [id]: e.target.value }))
                        }
                        className={cn(inputCls, "pr-9")}
                        placeholder={
                          keyStatus[id]
                            ? `Saved securely (${keyStatus[id]})`
                            : `Enter ${label} API key`
                        }
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        aria-label={show[id] ? `Hide ${label} API key` : `Show ${label} API key`}
                        onClick={() =>
                          setShow((s) => ({ ...s, [id]: !s[id] }))
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                      >
                        {show[id] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    {keyStatus[id] && (
                      <button
                        type="button"
                        onClick={() => void removeKey(id)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-zinc-500 transition hover:text-rose-300"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove saved key
                      </button>
                    )}
                  </Field>
                ))}
              </section>
            </>
          )}

          {/* TAB 3: CUSTOM PROMPT BUTTONS */}
          {activeTab === "customButtons" && (
            <section className="space-y-4">
              <div>
                <h3 className="text-[12px] font-semibold text-zinc-200">
                  {t(currentLang, "customButtonsTitle")}
                </h3>
                <p className="text-[11px] leading-relaxed text-zinc-500 mt-0.5">
                  {t(currentLang, "customButtonsDesc")}
                </p>
              </div>

              {/* Form to add new button */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3.5 space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{t(currentLang, "addCustomButton")}</span>
                </div>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t(currentLang, "buttonLabelPlaceholder")}
                  className={inputCls}
                />
                <textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder={t(currentLang, "buttonPromptPlaceholder")}
                  rows={2}
                  className={cn(inputCls, "resize-none")}
                />
                <button
                  type="button"
                  onClick={handleAddCustomButton}
                  disabled={!newLabel.trim() || !newPrompt.trim()}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition select-none",
                    newLabel.trim() && newPrompt.trim()
                      ? "bg-amber-400 text-zinc-950 hover:bg-amber-300"
                      : "bg-white/5 text-zinc-600 cursor-not-allowed",
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t(currentLang, "addCustomButton")}</span>
                </button>
              </div>

              {/* Existing Custom Buttons List */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Active Buttons ({(draft.customActions || []).length})
                </h4>
                {(draft.customActions || []).length === 0 ? (
                  <p className="text-[11px] text-zinc-500 italic">
                    No custom buttons created yet. Create your first button above!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {draft.customActions.map((btn) => (
                      <div
                        key={btn.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                              {btn.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 font-mono leading-relaxed line-clamp-2">
                            {btn.prompt}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomButton(btn.id)}
                          className="rounded-lg p-1.5 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300 transition"
                          title="Delete button"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="font-medium text-zinc-300">SpotAI v1.1.0</span>
            <span className="text-zinc-700">•</span>
            <button
              type="button"
              onClick={() => void openExternalUrl("https://github.com/jaimitus/SpotAI")}
              className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub Repo
            </button>
          </div>

          <div className="flex items-center gap-2">
            {saveError && (
              <p className="max-w-64 text-[10px] text-rose-300">
                {saveError}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
            >
              {t(currentLang, "cancelButton")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition",
                "bg-cyan-500/90 text-zinc-950 hover:bg-cyan-400",
                "disabled:opacity-60",
              )}
            >
              <Save className="h-3.5 w-3.5" />
              {savedFlash ? t(currentLang, "copied") : t(currentLang, "saveButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls = cn(
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2",
  "text-[12px] text-zinc-200 placeholder:text-zinc-600",
  "outline-none transition focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-400/20",
);
