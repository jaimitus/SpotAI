import {
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  checkOllamaHealth,
  deleteApiKey,
  getApiKeyStatus,
  saveApiKeys,
  saveSettings,
} from "../lib/tauri";
import type {
  ApiKeyStatus,
  ApiKeys,
  AppSettings,
  HealthStatus,
} from "../types";
import { cn } from "../utils/cn";

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

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setKeys({});
    setSaveError(null);
    void (async () => {
      try {
        setKeyStatus(await getApiKeyStatus());
        const h = await checkOllamaHealth(settings.ollamaHost);
        setHealth(h);
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
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

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      saveSettings(draft);
      await saveApiKeys(keys);
      onSave(draft);
      setSavedFlash(true);
      setTimeout(() => {
        setSavedFlash(false);
        onClose();
      }, 500);
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 flex max-h-[min(640px,90vh)] w-full max-w-lg flex-col overflow-hidden",
          "rounded-2xl border border-white/10 bg-[#0c0e14] shadow-2xl shadow-black/60",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-2 text-zinc-100">
            <Settings2 className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="custom-scroll flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* Local engines */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Local engines
            </h3>

            <Field label="Ollama host">
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
            </Field>

            <Field label="LM Studio host">
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
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Cloud API keys
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Keys are stored in the OS credential manager (Windows Credential
              Manager / macOS Keychain / libsecret) when running natively.
            </p>

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

          {/* Generation */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Generation
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

          {/* Shortcut hint */}
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <p className="text-[11px] text-zinc-400">
              Global hotkey:{" "}
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                Alt + Space
              </kbd>
              <span className="text-zinc-600"> | </span>
              Escape hides the window | Runs in the system tray
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          {saveError && (
            <p className="mr-auto max-w-64 text-[10px] text-rose-300">
              {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
          >
            Cancel
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
            {savedFlash ? "Saved" : "Save"}
          </button>
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
