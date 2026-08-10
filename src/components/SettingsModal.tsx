import {
  AlertTriangle,
  ArrowRightLeft,
  BookOpen,
  Box,
  Check,
  Cloud,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Languages,
  Loader2,
  Mic,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { resolveTheme, subscribeSystemTheme } from "../lib/theme";
import { APP_VERSION } from "../lib/version";
import { DEFAULT_PROMPT_TEMPLATES } from "../lib/prompts";
import {
  checkOllamaHealth,
  confirmDialog,
  deleteApiKey,
  deleteCustomApiKey,
  exportSettingsToFile,
  fetchOllamaPs,
  getApiKeyStatus,
  getCustomApiKeyStatus,
  getWhisperStatus,
  importSettingsFromFile,
  installWhisper,
  isTauri,
  listMicrophones,
  setWhisperModel,
  WHISPER_MODELS,
  type WhisperModelId,
  setSelectedMicrophone,
  setVoiceLanguage,
  listenWhisperProgress,
  ollamaDeleteModel,
  ollamaPullModel,
  openExternalUrl,
  pickOpenPath,
  pickSavePath,
  registerShortcut,
  saveApiKeys,
  saveCustomApiKey,
  saveSettings,
} from "../lib/tauri";
import type {
  ApiKeyStatus,
  ApiKeys,
  AppSettings,
  CustomAction,
  CustomProvider,
  HealthStatus,
  Language,
  MicDevice,
  OllamaPsModel,
  PromptTemplate,
  WhisperProgressEvent,
  WhisperStatus,
} from "../types";
import { cn } from "../utils/cn";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

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
  const [shortcutDraft, setShortcutDraft] = useState("Alt+Space");
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  // Real OS-level autostart state read on open; used to detect a user toggle
  // even when it differs from the value persisted in settings.
  const autostartOsRef = useRef<boolean | null>(null);

  // Custom provider form state
  const [customForm, setCustomForm] = useState({ name: "", baseUrl: "", defaultModel: "" });
  const [customKey, setCustomKey] = useState("");
  const [customShowKey, setCustomShowKey] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [customKeyStatus, setCustomKeyStatus] = useState<Record<string, string | null>>({});
  // Custom key writes are deferred to the main Save so cancelling the modal
  // cannot leave orphaned credentials in the keyring.
  const [pendingCustomKeys, setPendingCustomKeys] = useState<Record<string, string>>({});
  const [pendingCustomDeletes, setPendingCustomDeletes] = useState<string[]>([]);

  // New Custom Button Form state
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  // Prompt Library state
  const [templateLabel, setTemplateLabel] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");

  // Ollama model manager state
  const [ollamaPs, setOllamaPs] = useState<OllamaPsModel[]>([]);
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerMessage, setManagerMessage] = useState<string | null>(null);
  const [pullName, setPullName] = useState("");

  // Data & updates state
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "uptodate" | "available" | "failed"
  >("idle");
  const [foundUpdate, setFoundUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

  // Whisper install state
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus>({
    installed: false,
    installing: false,
    modelSize: 0,
    activeModel: "tiny",
    installedModels: [],
  });
  const [whisperProgress, setWhisperProgress] = useState<WhisperProgressEvent | null>(null);
  const [whisperError, setWhisperError] = useState<string | null>(null);

  // Microphone picker state
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [micsLoading, setMicsLoading] = useState(false);
  const [micsError, setMicsError] = useState<string | null>(null);
  // True when the native recognizer reported that Windows has not granted the
  // app microphone access; shows an actionable warning in the Voice section.
  const [micPermissionDenied, setMicPermissionDenied] = useState(() => {
    try {
      return localStorage.getItem("spotai.mic-permission.v1") === "1";
    } catch {
      return false;
    }
  });

  const loadMics = useCallback(async () => {
    setMicsLoading(true);
    setMicsError(null);
    try {
      const devices = await listMicrophones();
      setMics(devices);
      if (devices.length === 0) {
        setMicsError(t(settings.language || "en", "noMicrophones"));
      }
    } catch (cause) {
      setMicsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMicsLoading(false);
    }
  }, [settings.language]);

  useEffect(() => {
    if (!open) return;
    setDraft({
      ...settings,
      language: settings.language || "en",
      systemPrompt: settings.systemPrompt || "",
      customActions: settings.customActions || [],
      promptTemplates: settings.promptTemplates || [],
    });
    setShortcutDraft(settings.globalShortcut || "Alt+Space");
    setAutostartEnabled(Boolean(settings.autostart));
    autostartOsRef.current = Boolean(settings.autostart);
    // Sync the toggle with the OS-level autostart registration (e.g. the user
    // may have toggled it via Task Manager startup apps).
    if (isTauri()) {
      import("@tauri-apps/plugin-autostart")
        .then(({ isEnabled }) => isEnabled())
        .then((enabled) => {
          autostartOsRef.current = enabled;
          setAutostartEnabled(enabled);
        })
        .catch(() => undefined);
    }
    setKeys({});
    setPendingCustomKeys({});
    setPendingCustomDeletes([]);
    setSaveError(null);
    setDataMsg(null);
    setUpdateState("idle");
    setFoundUpdate(null);
    setWhisperError(null);
    // Re-read the mic permission flag on open: the recognizer may have failed
    // while the modal was closed.
    try {
      setMicPermissionDenied(localStorage.getItem("spotai.mic-permission.v1") === "1");
    } catch {
      setMicPermissionDenied(false);
    }
    void getWhisperStatus().then(setWhisperStatus).catch(() => undefined);
    void loadMics();
    void (async () => {
      try {
        setKeyStatus(await getApiKeyStatus());
        const h = await checkOllamaHealth(settings.ollamaHost);
        setHealth(h);
        const statuses: Record<string, string | null> = {};
        for (const cp of settings.customProviders || []) {
          statuses[cp.id] = await getCustomApiKeyStatus(cp.id).catch(() => null);
        }
        setCustomKeyStatus(statuses);
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [open, settings, loadMics]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Live-update the mic permission warning when the native recognizer fails
  // while the modal is already open.
  useEffect(() => {
    if (!open) return;
    const onMicDenied = () => setMicPermissionDenied(true);
    const onMicCleared = () => setMicPermissionDenied(false);
    window.addEventListener("spotai:mic-permission-denied", onMicDenied);
    window.addEventListener("spotai:mic-permission-cleared", onMicCleared);
    return () => {
      window.removeEventListener("spotai:mic-permission-denied", onMicDenied);
      window.removeEventListener("spotai:mic-permission-cleared", onMicCleared);
    };
  }, [open]);

  // Live whisper download progress.
  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    void listenWhisperProgress((event) => {
      setWhisperProgress(event);
      setWhisperStatus((s) => ({ ...s, installing: true }));
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      unlisten?.();
    };
  }, [open]);

  const handleInstallWhisper = async () => {
    setWhisperError(null);
    setWhisperStatus((s) => ({ ...s, installing: true }));
    setWhisperProgress(null);
    try {
      await installWhisper();
      const status = await getWhisperStatus();
      setWhisperStatus(status);
      setWhisperProgress(null);
      // Auto-switch the engine to whisper once it is ready.
      if (draft.voiceEngine !== "whisper") update("voiceEngine", "whisper");
    } catch (cause) {
      setWhisperError(cause instanceof Error ? cause.message : String(cause));
      setWhisperStatus((s) => ({ ...s, installing: false }));
      setWhisperProgress(null);
    }
  };

  // Switch the active Whisper model. Fast: the backend only changes the model
  // id, so the panel immediately reflects whether that model is downloaded
  // (ready) or still needs the download button.
  const handleWhisperModelChange = async (model: WhisperModelId) => {
    update("whisperModel", model);
    setWhisperError(null);
    try {
      const status = await setWhisperModel(model);
      setWhisperStatus(status);
      setWhisperProgress(null);
    } catch (cause) {
      setWhisperError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Live-preview the theme while the modal is open (like the language picker),
  // and restore the saved theme if the modal is closed/cancelled. When the
  // draft is "system", follow the OS color scheme live too.
  useEffect(() => {
    if (!open) return;
    document.documentElement.dataset.theme = resolveTheme(draft.theme);
    let unsubscribe: (() => void) | undefined;
    if ((draft.theme || "dark") === "system") {
      unsubscribe = subscribeSystemTheme(() => {
        document.documentElement.dataset.theme = resolveTheme("system");
      });
    }
    return () => {
      unsubscribe?.();
      document.documentElement.dataset.theme = resolveTheme(settings.theme);
    };
  }, [open, draft.theme, settings.theme]);

  if (!open) return null;

  const currentLang = draft.language || "en";

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Apply the global shortcut first so an invalid/unavailable combo is reported
      // before anything else is persisted.
      const requestedShortcut = shortcutDraft.trim() || "Alt+Space";
      let updated = draft;
      if (requestedShortcut !== (draft.globalShortcut || "Alt+Space")) {
        const status = await registerShortcut(requestedShortcut);
        if (!status.registered) {
          setSaveError(
            status.error || `Could not register shortcut "${requestedShortcut}"`,
          );
          setSaving(false);
          return;
        }
        updated = { ...draft, globalShortcut: requestedShortcut };
        setDraft(updated);
      }
      // Apply the start-with-Windows preference to the OS. Compare against the
      // state read from the OS on open (not the stored setting) so toggling off
      // an externally enabled entry is not lost. Skipped in browser mode where
      // the plugin has no runtime.
      if (isTauri() && autostartEnabled !== (autostartOsRef.current ?? Boolean(settings.autostart))) {
        const { enable, disable } = await import("@tauri-apps/plugin-autostart");
        if (autostartEnabled) await enable();
        else await disable();
      }
      saveSettings(updated);
      // Sync the voice engine preference to the Rust backend.
      try {
        const { setVoiceEngine: syncVoice } = await import("../lib/tauri");
        await syncVoice(updated.voiceEngine || "native");
      } catch {
        // Non-critical; the backend will get the preference on next restart.
      }
      // Sync the chosen microphone to the Rust backend.
      try {
        await setSelectedMicrophone(updated.selectedMic || "");
      } catch {
        // Non-critical; falls back to the OS default until the next sync.
      }
      // Sync the Whisper recognition language to the Rust backend.
      try {
        await setVoiceLanguage(updated.voiceLanguage || "auto");
      } catch {
        // Non-critical; the backend will get the preference on next restart.
      }
      // Sync the chosen Whisper model size to the Rust backend.
      try {
        await setWhisperModel(updated.whisperModel || "tiny");
      } catch {
        // Non-critical; the backend will get the preference on next restart.
      }
      await saveApiKeys(keys);
      for (const [id, key] of Object.entries(pendingCustomKeys)) {
        if (key.trim()) await saveCustomApiKey(id, key.trim());
      }
      for (const id of pendingCustomDeletes) {
        await deleteCustomApiKey(id);
      }
      onSave(updated);
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

  const toggleAutostart = (value: boolean) => {
    setAutostartEnabled(value);
    update("autostart", value);
  };

  const pingOllama = async () => {
    const h = await checkOllamaHealth(draft.ollamaHost);
    setHealth(h);
    if (h.ollama) void loadOllamaPs();
  };

  const loadOllamaPs = async () => {
    const models = await fetchOllamaPs(draft.ollamaHost);
    setOllamaPs(models);
  };

  const dismissMicPermission = () => {
    try {
      localStorage.removeItem("spotai.mic-permission.v1");
    } catch {
      // Best-effort.
    }
    setMicPermissionDenied(false);
  };

  const handlePullModel = async () => {
    const name = pullName.trim();
    if (!name || managerBusy) return;
    setManagerBusy(true);
    setManagerError(null);
    setManagerMessage(`${t(currentLang, "pullingModel")} ${name}…`);
    try {
      await ollamaPullModel(name, draft.ollamaHost);
      setManagerMessage(`${t(currentLang, "pulledModel")} ${name}`);
      setPullName("");
      void loadOllamaPs();
    } catch (error) {
      setManagerError(String(error));
      setManagerMessage(null);
    } finally {
      setManagerBusy(false);
    }
  };

  const handleDeleteModel = async (name: string) => {
    if (managerBusy) return;
    setManagerBusy(true);
    setManagerError(null);
    setManagerMessage(null);
    try {
      await ollamaDeleteModel(name, draft.ollamaHost);
      setManagerMessage(`${t(currentLang, "deletedModel")} ${name}`);
      void loadOllamaPs();
    } catch (error) {
      setManagerError(String(error));
    } finally {
      setManagerBusy(false);
    }
  };

  const startEditCustom = (cp: CustomProvider) => {
    setEditingCustomId(cp.id);
    setCustomForm({
      name: cp.name,
      baseUrl: cp.baseUrl,
      defaultModel: cp.defaultModel || "",
    });
    setCustomKey("");
    setCustomShowKey(false);
  };

  const resetCustomForm = () => {
    setEditingCustomId(null);
    setCustomForm({ name: "", baseUrl: "", defaultModel: "" });
    setCustomKey("");
    setCustomShowKey(false);
  };

  const saveCustomProvider = async () => {
    const name = customForm.name.trim();
    const baseUrl = customForm.baseUrl.trim();
    if (!name || !baseUrl) return;
    if (!/^https?:\/\//i.test(baseUrl)) {
      setSaveError(t(currentLang, "baseUrlError"));
      return;
    }
    const id = editingCustomId ?? `custom_${Date.now()}`;
    const updated: CustomProvider = {
      id,
      name,
      baseUrl,
      defaultModel: customForm.defaultModel.trim() || undefined,
    };
    setDraft((d) => {
      const others = (d.customProviders || []).filter((cp) => cp.id !== id);
      return { ...d, customProviders: [...others, updated] };
    });
    if (customKey.trim()) {
      setPendingCustomKeys((pending) => ({ ...pending, [id]: customKey.trim() }));
      setPendingCustomDeletes((pending) => pending.filter((pid) => pid !== id));
      setCustomKeyStatus((s) => ({ ...s, [id]: "••••" }));
    }
    resetCustomForm();
  };

  const removeCustomProvider = async (cp: CustomProvider) => {
    setDraft((d) => ({
      ...d,
      customProviders: (d.customProviders || []).filter((p) => p.id !== cp.id),
    }));
    setCustomKeyStatus((s) => {
      const next = { ...s };
      delete next[cp.id];
      return next;
    });
    if (editingCustomId === cp.id) resetCustomForm();
    setPendingCustomDeletes((pending) =>
      pending.includes(cp.id) ? pending : [...pending, cp.id],
    );
    setPendingCustomKeys((pending) => {
      const next = { ...pending };
      delete next[cp.id];
      return next;
    });
  };

  const removeCustomKey = (cp: CustomProvider) => {
    setPendingCustomDeletes((pending) =>
      pending.includes(cp.id) ? pending : [...pending, cp.id],
    );
    setPendingCustomKeys((pending) => {
      const next = { ...pending };
      delete next[cp.id];
      return next;
    });
    setCustomKeyStatus((s) => ({ ...s, [cp.id]: null }));
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

  const handleAddTemplate = () => {
    if (!templateLabel.trim() || !templatePrompt.trim()) return;
    const template: PromptTemplate = {
      id: `tpl_${Date.now()}`,
      label: templateLabel.trim(),
      prompt: templatePrompt.trim(),
    };
    setDraft((d) => ({
      ...d,
      promptTemplates: [...(d.promptTemplates || []), template],
    }));
    setTemplateLabel("");
    setTemplatePrompt("");
  };

  const handleDeleteTemplate = (id: string) => {
    setDraft((d) => ({
      ...d,
      promptTemplates: (d.promptTemplates || []).filter((tpl) => tpl.id !== id),
    }));
  };

  const handleRestoreTemplates = () => {
    setDraft((d) => ({ ...d, promptTemplates: DEFAULT_PROMPT_TEMPLATES }));
  };

  const handleExportSettings = async () => {
    setDataMsg(null);
    setSaveError(null);
    try {
      const path = await pickSavePath("spotai-settings.json");
      if (!path) return;
      const payload = JSON.stringify(
        {
          ...draft,
          customActions: draft.customActions || [],
          customProviders: draft.customProviders || [],
        },
        null,
        2,
      );
      await exportSettingsToFile(path, payload);
      setDataMsg(t(currentLang, "settingsExported"));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleImportSettings = async () => {
    setDataMsg(null);
    setSaveError(null);
    const path = await pickOpenPath();
    if (!path) return;
    try {
      const raw = await importSettingsFromFile(path);
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid JSON");
      setDraft((d) => ({
        ...d,
        ...parsed,
        language: parsed.language || d.language,
        customActions: parsed.customActions ?? d.customActions ?? [],
        customProviders: parsed.customProviders ?? d.customProviders ?? [],
      }));
      setDataMsg(t(currentLang, "settingsImported"));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleCheckUpdates = async () => {
    setUpdateState("checking");
    setDataMsg(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setFoundUpdate(update);
        setUpdateState("available");
      } else {
        setUpdateState("uptodate");
      }
    } catch {
      setUpdateState("failed");
    }
  };

  const installFoundUpdate = async () => {
    if (!foundUpdate || installing) return;
    setInstalling(true);
    try {
      await foundUpdate.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setUpdateState("failed");
      setInstalling(false);
    }
  };

  const handleClearData = async (
    kind: "history" | "conversations" | "keys",
  ) => {
    const ok = await confirmDialog(t(currentLang, "confirmClear"));
    if (!ok) return;
    if (kind === "history") {
      localStorage.removeItem("spotai.prompt-history.v2");
      localStorage.removeItem("spotai.prompt-history.v1");
    } else if (kind === "conversations") {
      localStorage.removeItem("spotai.conversation.v1");
      localStorage.removeItem("spotai.conversations.v2");
      localStorage.removeItem("spotai.active-conversation.v1");
      // Let the overlay drop its in-memory chat state.
      window.dispatchEvent(new CustomEvent("spotai:conversations-cleared"));
    } else {
      for (const id of ["openai", "anthropic", "groq", "deepseek"]) {
        await deleteApiKey(id).catch(() => undefined);
      }
      for (const cp of draft.customProviders || []) {
        await deleteCustomApiKey(cp.id).catch(() => undefined);
      }
      setKeyStatus({});
      setCustomKeyStatus({});
      // Also drop unsaved key entries typed in this session so a later Save
      // cannot re-persist them.
      setKeys({});
      setPendingCustomKeys({});
      setPendingCustomDeletes([]);
    }
    setDataMsg(t(currentLang, "dataCleared"));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Transparent click-catcher: closes on outside click without dimming
          the whole window (a full-window overlay looks like a black square
          behind the rounded shell). */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 flex max-h-[min(660px,92vh)] w-full max-w-lg flex-col overflow-hidden",
          "rounded-2xl border border-[var(--pe-border)] bg-[var(--pe-bg-2)] shadow-2xl shadow-black/80",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--pe-border-soft)] px-5 py-3.5">
          <div className="flex items-center gap-2 text-[var(--pe-text-strong)]">
            <Settings2 className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-semibold tracking-tight">
              {t(currentLang, "settingsHeader")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-[var(--pe-border-soft)] bg-[var(--pe-input)] px-4 py-2">
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
                  ? "bg-cyan-400/15 text-[var(--pe-accent-strong)] border border-cyan-400/30"
                  : "text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)] border border-transparent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="custom-scroll flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* TAB 1: GENERAL & LANGUAGE */}
          {activeTab === "general" && (
            <>
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <Globe className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "languageLabel")}</span>
                </div>
                <Field label={t(currentLang, "languageDesc")}>
                  <select
                    value={draft.language}
                    onChange={(e) => update("language", e.target.value as Language)}
                    className={inputCls}
                  >
                    <option value="en" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇺🇸 English (Default)
                    </option>
                    <option value="es" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇪🇸 Español (España)
                    </option>
                    <option value="de" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇩🇪 Deutsch (German)
                    </option>
                    <option value="pt" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇵🇹 Português
                    </option>
                    <option value="fr" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇫🇷 Français
                    </option>
                  </select>
                </Field>
              </section>

              {/* Appearance */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <Sun className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "themeLabel")}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => update("theme", "dark")}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-medium transition select-none",
                      (draft.theme || "dark") === "dark"
                        ? "border-cyan-400/40 bg-cyan-400/10 text-[var(--pe-accent-strong)]"
                        : "border-[var(--pe-border)] bg-[var(--pe-input)] text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)]",
                    )}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    {t(currentLang, "themeDark")}
                  </button>
                  <button
                    type="button"
                    onClick={() => update("theme", "system")}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-medium transition select-none",
                      (draft.theme || "dark") === "system"
                        ? "border-cyan-400/40 bg-cyan-400/10 text-[var(--pe-accent-strong)]"
                        : "border-[var(--pe-border)] bg-[var(--pe-input)] text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)]",
                    )}
                  >
                    <Monitor className="h-3.5 w-3.5" />
                    {t(currentLang, "themeSystem")}
                  </button>
                  <button
                    type="button"
                    onClick={() => update("theme", "light")}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-medium transition select-none",
                      draft.theme === "light"
                        ? "border-cyan-400/40 bg-cyan-400/10 text-[var(--pe-accent-strong)]"
                        : "border-[var(--pe-border)] bg-[var(--pe-input)] text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)]",
                    )}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    {t(currentLang, "themeLight")}
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                  {t(currentLang, "themeDesc")}
                </p>
              </section>

              <section className="space-y-3 pt-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                  {t(currentLang, "generationLimits")}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={`${t(currentLang, "temperature")} | ${draft.temperature.toFixed(2)}`}
                  >
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
                  <Field label={t(currentLang, "maxTokens")}>
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
                {/* Advanced Ollama/LLM parameters */}
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <Field
                    label={`${t(currentLang, "topP")} | ${(draft.topP ?? 0.9).toFixed(2)}`}
                  >
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draft.topP ?? 0.9}
                      onChange={(e) =>
                        update("topP", parseFloat(e.target.value))
                      }
                      className="w-full accent-cyan-400"
                    />
                  </Field>
                  <Field
                    label={`${t(currentLang, "topK")} | ${draft.topK ?? 40}`}
                  >
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={draft.topK ?? 40}
                      onChange={(e) =>
                        update("topK", parseInt(e.target.value || "40", 10))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field
                    label={`${t(currentLang, "repeatPenalty")} | ${(draft.repeatPenalty ?? 1.1).toFixed(2)}`}
                  >
                    <input
                      type="range"
                      min={1}
                      max={2}
                      step={0.05}
                      value={draft.repeatPenalty ?? 1.1}
                      onChange={(e) =>
                        update("repeatPenalty", parseFloat(e.target.value))
                      }
                      className="w-full accent-cyan-400"
                    />
                  </Field>
                </div>
              </section>

              {/* Shortcut info */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <Settings2 className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "globalHotkeyLabel")}</span>
                </div>
                <input
                  value={shortcutDraft}
                  onChange={(e) => setShortcutDraft(e.target.value)}
                  className={inputCls}
                  placeholder="Alt+Space"
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="text-[10px] text-[var(--pe-text-muted)] leading-relaxed">
                  {t(currentLang, "shortcutSyntaxHint")}
                </p>
                <p className="text-[10px] text-[var(--pe-text-muted)] leading-relaxed">
                  {t(currentLang, "escHidesWindow")}{" "}
                  <span className="text-[var(--pe-text-faint)]">|</span>{" "}
                  {t(currentLang, "runsInTray")}
                </p>
              </section>

              {/* Startup: launch SpotAI with Windows */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <Rocket className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "startupLabel")}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autostartEnabled}
                  onClick={() => toggleAutostart(!autostartEnabled)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--pe-border)] bg-[var(--pe-input)] px-3.5 py-2.5 text-left transition hover:bg-[var(--pe-hover)]"
                >
                  <span>
                    <span className="block text-[12px] font-medium text-[var(--pe-text)]">
                      {t(currentLang, "startupLabel")}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                      {t(currentLang, "startupDesc")}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      autostartEnabled ? "bg-cyan-500/80" : "bg-[var(--pe-input-hover)]",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        autostartEnabled ? "translate-x-[18px]" : "translate-x-[2px]",
                      )}
                    />
                  </span>
                </button>
              </section>

              {/* Quick-action behavior: auto-insert or copy-only */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "quickActionLabel")}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.autoInsertQuickActions !== false}
                  onClick={() => update("autoInsertQuickActions", draft.autoInsertQuickActions === false)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--pe-border)] bg-[var(--pe-input)] px-3.5 py-2.5 text-left transition hover:bg-[var(--pe-hover)]"
                >
                  <span>
                    <span className="block text-[12px] font-medium text-[var(--pe-text)]">
                      {t(currentLang, "autoInsertQuickActions")}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                      {t(currentLang, "quickActionDesc")}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      draft.autoInsertQuickActions !== false
                        ? "bg-cyan-500/80"
                        : "bg-[var(--pe-input-hover)]",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        draft.autoInsertQuickActions !== false
                          ? "translate-x-[18px]"
                          : "translate-x-[2px]",
                      )}
                    />
                  </span>
                </button>
              </section>

              {/* Updates */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "checkUpdates")}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCheckUpdates()}
                    disabled={updateState === "checking"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-3 py-1.5 text-[11px] text-[var(--pe-text)] transition hover:bg-[var(--pe-hover)] disabled:opacity-50"
                  >
                    {updateState === "checking" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {updateState === "checking"
                      ? t(currentLang, "checkingUpdates")
                      : t(currentLang, "checkUpdates")}
                  </button>
                  {updateState === "available" && foundUpdate && (
                    <button
                      type="button"
                      onClick={() => void installFoundUpdate()}
                      disabled={installing}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/90 px-3 py-1.5 text-[11px] font-medium text-zinc-950 transition hover:bg-cyan-400 disabled:opacity-60"
                    >
                      {installing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      {t(currentLang, "installRestart")} v{foundUpdate.version}
                    </button>
                  )}
                </div>
                {updateState === "uptodate" && (
                  <p className="text-[11px] text-[var(--pe-emerald-strong)]">{t(currentLang, "upToDate")}</p>
                )}
                {updateState === "failed" && (
                  <p className="text-[11px] text-[var(--pe-rose-strong)]">{t(currentLang, "updateFailed")}</p>
                )}
              </section>

              {/* Voice input */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <Mic className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "voiceEngine")}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.voiceEngine !== "whisper"}
                  onClick={() =>
                    update(
                      "voiceEngine",
                      draft.voiceEngine === "whisper" ? "native" : "whisper",
                    )
                  }
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--pe-border)] bg-[var(--pe-input)] px-3.5 py-2.5 text-left transition hover:bg-[var(--pe-hover)]"
                >
                  <span>
                    <span className="block text-[12px] font-medium text-[var(--pe-text)]">
                      {draft.voiceEngine !== "whisper"
                        ? t(currentLang, "voiceNative")
                        : t(currentLang, "voiceWhisper")}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                      {draft.voiceEngine !== "whisper"
                        ? t(currentLang, "voiceNativeDesc")
                        : t(currentLang, "voiceWhisperDesc")}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      draft.voiceEngine === "whisper"
                        ? "bg-violet-500/80"
                        : "bg-[var(--pe-input-hover)]",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        draft.voiceEngine === "whisper"
                          ? "translate-x-[18px]"
                          : "translate-x-[2px]",
                      )}
                    />
                  </span>
                </button>
                <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                  {t(currentLang, "voiceEngineDesc")}{" "}
                  <kbd className="rounded border border-[var(--pe-border)] bg-[var(--pe-input)] px-1 py-0.5 font-mono">
                    Alt+V
                  </kbd>{" "}
                  {t(currentLang, "voiceInputStatus")}
                </p>

                {/* Whisper recognition language (auto-detection on the tiny
                    model often assumes English and transcribes nonsense, so
                    the user can pin their language here) */}
                <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3.5">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--pe-violet-strong)]">
                    <Languages className="h-3.5 w-3.5" />
                    {t(currentLang, "voiceLanguage")}
                  </span>
                  <select
                    value={draft.voiceLanguage || "auto"}
                    onChange={(e) => update("voiceLanguage", e.target.value)}
                    className={inputCls}
                  >
                    <option value="auto" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      ✨ {t(currentLang, "voiceLangAuto")}
                    </option>
                    <option value="en" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇺🇸 English
                    </option>
                    <option value="es" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇪🇸 Español
                    </option>
                    <option value="de" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇩🇪 Deutsch
                    </option>
                    <option value="pt" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇵🇹 Português
                    </option>
                    <option value="fr" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      🇫🇷 Français
                    </option>
                  </select>
                  <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                    {t(currentLang, "voiceLanguageDesc")}
                  </p>
                </div>

                {/* Microphone permission warning (native recognizer blocked) */}
                {micPermissionDenied && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--pe-amber-strong)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-[var(--pe-amber-strong)]">
                        {t(currentLang, "micPermissionTitle")}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--pe-text-soft)]">
                        {t(currentLang, "micPermissionDesc")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={dismissMicPermission}
                      aria-label={t(currentLang, "dismiss")}
                      className="shrink-0 rounded-md p-1 text-[var(--pe-text-muted)] transition hover:bg-amber-500/15 hover:text-[var(--pe-amber-strong)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Microphone picker */}
                <div className="space-y-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--pe-accent-strong)]">
                      <Mic className="h-3.5 w-3.5" />
                      {t(currentLang, "micLabel")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadMics()}
                      disabled={micsLoading}
                      title={t(currentLang, "refreshMics")}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)] disabled:opacity-50"
                    >
                      <RefreshCw
                        className={cn("h-3 w-3", micsLoading && "animate-spin")}
                      />
                      {t(currentLang, "refresh")}
                    </button>
                  </div>
                  <select
                    value={draft.selectedMic || ""}
                    onChange={(e) => update("selectedMic", e.target.value)}
                    disabled={micsLoading}
                    className={inputCls}
                  >
                    <option value="" className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]">
                      {t(currentLang, "defaultMicrophone")}
                    </option>
                    {mics.map((mic) => (
                      <option
                        key={mic.id}
                        value={mic.name}
                        className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]"
                      >
                        {mic.name}
                        {mic.isDefault ? ` (${t(currentLang, "micDefaultTag")})` : ""}
                      </option>
                    ))}
                    {draft.selectedMic &&
                      !mics.some((m) => m.name === draft.selectedMic) && (
                        <option
                          value={draft.selectedMic}
                          className="bg-[var(--pe-bg-2)] text-[var(--pe-text-strong)]"
                        >
                          {draft.selectedMic}
                        </option>
                      )}
                  </select>
                  {micsLoading ? (
                    <p className="flex items-center gap-1.5 text-[10px] text-[var(--pe-text-muted)]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t(currentLang, "scanningMics")}
                    </p>
                  ) : (
                    <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                      {mics.length > 0
                        ? t(currentLang, "micDesc")
                        : t(currentLang, "noMicrophones")}
                    </p>
                  )}
                  {micsError && mics.length === 0 && (
                    <p className="break-words text-[10px] text-[var(--pe-rose-strong)]">
                      {micsError}
                    </p>
                  )}
                </div>

                {/* Whisper install status / download */}
                {draft.voiceEngine === "whisper" && (
                  <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3.5">
                    {/* Model picker: bigger models transcribe more accurately */}
                    <div className="space-y-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--pe-violet-strong)]">
                        <Cpu className="h-3.5 w-3.5" />
                        {t(currentLang, "whisperModel")}
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {WHISPER_MODELS.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => void handleWhisperModelChange(model.id)}
                            disabled={whisperStatus.installing || !!whisperProgress}
                            title={`${model.label} · ${model.sizeMb} MB`}
                            className={cn(
                              "rounded-lg border px-2 py-1.5 text-left transition select-none",
                              (draft.whisperModel || "tiny") === model.id
                                ? "border-violet-400/40 bg-violet-400/10 text-[var(--pe-violet-strong)]"
                                : "border-[var(--pe-border)] bg-[var(--pe-input)] text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)]",
                            )}
                          >
                            <span className="block text-[11px] font-medium">
                              {model.label}
                            </span>
                            <span className="block text-[9px] text-[var(--pe-text-muted)]">
                              {model.sizeMb} MB
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                        {t(currentLang, "whisperModelDesc")}
                      </p>
                    </div>

                    {whisperStatus.installing || whisperProgress ? (
                      <>
                        <div className="flex items-center gap-2 text-[11px] text-[var(--pe-violet-strong)]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {whisperProgress
                            ? t(currentLang, "whisperInstalling").replace(
                                "{0}",
                                t(
                                  currentLang,
                                  whisperProgress.phase === "binary"
                                    ? "whisperPhaseBinary"
                                    : "whisperPhaseModel",
                                ),
                              )
                            : t(currentLang, "whisperStarting")}
                        </div>
                        {whisperProgress && (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--pe-hover)]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400 transition-all duration-200"
                              style={{
                                width: `${
                                  whisperProgress.total > 0
                                    ? Math.min(
                                        100,
                                        (whisperProgress.received /
                                          whisperProgress.total) *
                                          100,
                                      )
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        )}
                        <p className="text-[10px] text-[var(--pe-text-muted)]">
                          {t(currentLang, "whisperInstallHint")}
                        </p>
                      </>
                    ) : whisperStatus.installed ? (
                      <>
                        <div className="flex items-center gap-2 text-[11px] text-[var(--pe-emerald-strong)]">
                          <Check className="h-3.5 w-3.5" />
                          {t(currentLang, "whisperDownloaded")}
                          <span className="font-medium">
                            {WHISPER_MODELS.find(
                              (m) => m.id === (whisperStatus.activeModel || "tiny"),
                            )?.label ?? "Tiny"}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--pe-text-muted)]">
                            {formatBytes(whisperStatus.modelSize)}
                          </span>
                        </div>
                        <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                          {t(currentLang, "whisperReadyHint")}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                          {t(currentLang, "whisperNotInstalled")}
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleInstallWhisper()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/90 px-3 py-1.5 text-[11px] font-medium text-zinc-950 transition hover:bg-violet-400"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t(currentLang, "downloadWhisper")}
                        </button>
                      </>
                    )}
                    {whisperError && (
                      <p className="break-words text-[11px] text-[var(--pe-rose-strong)]">
                        {t(currentLang, "whisperDownloadFailed")}: {whisperError}
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* System prompt */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "systemPromptLabel")}</span>
                </div>
                <Field label={t(currentLang, "systemPromptHelp")}>
                  <textarea
                    value={draft.systemPrompt || ""}
                    onChange={(e) => update("systemPrompt", e.target.value)}
                    rows={3}
                    className={cn(inputCls, "resize-none")}
                    spellCheck={false}
                  />
                </Field>
              </section>

              {/* Data & backups */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-soft)]">
                  <Download className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{t(currentLang, "exportSettings")}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleExportSettings()}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-3 py-2 text-[11px] text-[var(--pe-text)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text-strong)]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t(currentLang, "exportSettings")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleImportSettings()}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-3 py-2 text-[11px] text-[var(--pe-text)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text-strong)]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {t(currentLang, "importSettings")}
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                  {t(currentLang, "exportSettingsDesc")}
                </p>
              </section>

              {/* Danger zone */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-rose-strong)]">
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t(currentLang, "clearData")}</span>
                </div>
                <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                  {t(currentLang, "clearDataDesc")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleClearData("history")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-[var(--pe-rose-strong)] transition hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t(currentLang, "clearPromptHistory")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleClearData("conversations")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-[var(--pe-rose-strong)] transition hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t(currentLang, "clearConversations")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleClearData("keys")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-[var(--pe-rose-strong)] transition hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t(currentLang, "clearSavedKeys")}
                  </button>
                </div>
                {dataMsg && (
                  <p className="text-[11px] text-[var(--pe-emerald-strong)]">{dataMsg}</p>
                )}
              </section>
            </>
          )}

          {/* TAB 2: AI PROVIDERS & KEYS */}
          {activeTab === "providers" && (
            <>
              {/* Local engines */}
              <section className="space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                  {t(currentLang, "localEngines")}
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
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-2.5 text-[11px] text-[var(--pe-text)] transition hover:bg-[var(--pe-hover)]"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t(currentLang, "ping")}
                    </button>
                  </div>
                  {health && (
                    <p
                      className={cn(
                        "mt-1.5 text-[11px]",
                        health.ollama ? "text-[var(--pe-emerald-strong)]" : "text-[var(--pe-text-muted)]",
                      )}
                    >
                      {health.ollama
                        ? `${t(currentLang, "online")}${health.ollamaVersion ? ` | v${health.ollamaVersion}` : ""}`
                        : t(currentLang, "offlineStartOllama")}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-[var(--pe-text-muted)] leading-normal">
                    {t(currentLang, "ollamaHostHelp")}
                  </p>
                </Field>

                <Field label={t(currentLang, "lmStudioHost")}>
                  <input
                    value={draft.lmstudioHost}
                    onChange={(e) => update("lmstudioHost", e.target.value)}
                    className={inputCls}
                    placeholder="http://127.0.0.1:1234"
                    spellCheck={false}
                  />
                </Field>
              </section>

              {/* Ollama model manager */}
              <section className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                    <Box className="h-3.5 w-3.5 text-[var(--pe-violet-strong)]" />
                    {t(currentLang, "ollamaManager")}
                  </h3>
                  <button
                    type="button"
                    onClick={() => void loadOllamaPs()}
                    className="inline-flex items-center gap-1 rounded-lg p-1 text-[10px] text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t(currentLang, "refresh")}
                  </button>
                </div>

                {/* Loaded models (RAM/VRAM) */}
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--pe-text-muted)]">
                    <Cpu className="h-3 w-3" />
                    {t(currentLang, "loadedModels")}
                  </p>
                  {ollamaPs.length === 0 ? (
                    <p className="text-[11px] italic text-[var(--pe-text-faint)]">
                      {t(currentLang, "noLoadedModels")}
                    </p>
                  ) : (
                    ollamaPs.map((model) => (
                      <div
                        key={model.name}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[11px] text-[var(--pe-text)]">
                            {model.name}
                          </p>
                          <p className="text-[10px] text-[var(--pe-text-muted)]">
                            {formatBytes(model.size)}
                            {model.sizeVram > 0
                              ? ` · VRAM ${formatBytes(model.sizeVram)}`
                              : ` · ${t(currentLang, "cpuOnly")}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteModel(model.name)}
                          disabled={managerBusy}
                          className="shrink-0 rounded-md p-1 text-[var(--pe-text-muted)] transition hover:bg-rose-500/10 hover:text-[var(--pe-rose-strong)] disabled:opacity-40"
                          title={t(currentLang, "deleteModel")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Pull model */}
                <div className="flex gap-2">
                  <input
                    value={pullName}
                    onChange={(e) => setPullName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handlePullModel();
                      }
                    }}
                    placeholder={t(currentLang, "pullPlaceholder")}
                    className={inputCls}
                    spellCheck={false}
                    disabled={managerBusy}
                  />
                  <button
                    type="button"
                    onClick={() => void handlePullModel()}
                    disabled={managerBusy || !pullName.trim()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-500/90 px-3 text-[11px] font-medium text-zinc-950 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-[var(--pe-hover)] disabled:text-[var(--pe-text-faint)]"
                  >
                    {managerBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {t(currentLang, "pull")}
                  </button>
                </div>

                {managerMessage && (
                  <p className="text-[11px] text-[var(--pe-emerald-strong)]">
                    {managerMessage}
                  </p>
                )}
                {managerError && (
                  <p className="break-words text-[11px] text-[var(--pe-rose-strong)]">
                    {managerError}
                  </p>
                )}
              </section>

              {/* Cloud API keys */}
              <section className="space-y-3 pt-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                  {t(currentLang, "cloudApiKeys")}
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
                            ? `${t(currentLang, "savedSecurely")} (${keyStatus[id]})`
                            : `${t(currentLang, "enterApiKey")} (${label})`
                        }
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        aria-label={show[id] ? t(currentLang, "hideKey") : t(currentLang, "showKey")}
                        onClick={() =>
                          setShow((s) => ({ ...s, [id]: !s[id] }))
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--pe-text-muted)] hover:text-[var(--pe-text)]"
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
                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-[var(--pe-text-muted)] transition hover:text-[var(--pe-rose-strong)]"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t(currentLang, "removeSavedKey")}
                      </button>
                    )}
                  </Field>
                ))}
              </section>

              {/* Custom OpenAI-compatible providers */}
              <section className="space-y-3 pt-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                  {t(currentLang, "customProviders")}
                </h3>
                <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                  {t(currentLang, "customProviderDesc")}
                </p>

                {/* Form */}
                <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[var(--pe-accent-strong)]">
                      {editingCustomId
                        ? t(currentLang, "saveProvider")
                        : t(currentLang, "addProvider")}
                    </span>
                    {editingCustomId && (
                      <button
                        type="button"
                        onClick={resetCustomForm}
                        className="rounded-md px-2 py-1 text-[10px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
                      >
                        {t(currentLang, "cancelButton")}
                      </button>
                    )}
                  </div>
                  <Field label={t(currentLang, "providerName")}>
                    <input
                      value={customForm.name}
                      onChange={(e) => setCustomForm((f) => ({ ...f, name: e.target.value }))}
                      className={inputCls}
                      placeholder="OpenRouter"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={t(currentLang, "baseUrlLabel")}>
                    <input
                      value={customForm.baseUrl}
                      onChange={(e) => setCustomForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      className={inputCls}
                      placeholder="https://openrouter.ai/api/v1"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={t(currentLang, "customDefaultModelLabel")}>
                    <input
                      value={customForm.defaultModel}
                      onChange={(e) =>
                        setCustomForm((f) => ({ ...f, defaultModel: e.target.value }))
                      }
                      className={inputCls}
                      placeholder="anthropic/claude-3.5-sonnet"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={t(currentLang, "providerApiKey")}>
                    <div className="relative">
                      <input
                        type={customShowKey ? "text" : "password"}
                        value={customKey}
                        onChange={(e) => setCustomKey(e.target.value)}
                        className={cn(inputCls, "pr-9")}
                        placeholder={
                          editingCustomId && customKeyStatus[editingCustomId]
                            ? t(currentLang, "savedSecurely")
                            : undefined
                        }
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        aria-label={
                          customShowKey ? t(currentLang, "hideKey") : t(currentLang, "showKey")
                        }
                        onClick={() => setCustomShowKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--pe-text-muted)] hover:text-[var(--pe-text)]"
                      >
                        {customShowKey ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </Field>
                  <button
                    type="button"
                    disabled={!customForm.name.trim() || !customForm.baseUrl.trim()}
                    onClick={() => void saveCustomProvider()}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition select-none",
                      customForm.name.trim() && customForm.baseUrl.trim()
                        ? "bg-cyan-500/90 text-zinc-950 hover:bg-cyan-400"
                        : "bg-[var(--pe-hover)] text-[var(--pe-text-faint)] cursor-not-allowed",
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {editingCustomId ? t(currentLang, "saveProvider") : t(currentLang, "addProvider")}
                  </button>
                </div>

                {/* List */}
                <div className="space-y-2">
                  {(draft.customProviders || []).length === 0 ? (
                    <p className="text-[11px] italic text-[var(--pe-text-muted)]">
                      {t(currentLang, "noCustomProviders")}
                    </p>
                  ) : (
                    (draft.customProviders || []).map((cp) => (
                      <div
                        key={cp.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-[var(--pe-border)] bg-[var(--pe-input)] p-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Cloud className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                            <span className="text-[12px] font-medium text-[var(--pe-text)]">
                              {cp.name}
                            </span>
                          </div>
                          <p className="truncate font-mono text-[10px] text-[var(--pe-text-muted)]">
                            {cp.baseUrl}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--pe-text-muted)]">
                            <span className="rounded-full bg-[var(--pe-input)] px-1.5 py-0.5">
                              {cp.defaultModel || "—"}
                            </span>
                            {customKeyStatus[cp.id] ? (
                              <>
                                <span className="text-[var(--pe-emerald-strong)]/80">
                                  {customKeyStatus[cp.id]}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void removeCustomKey(cp)}
                                  className="text-[var(--pe-text-muted)] transition hover:text-[var(--pe-rose-strong)]"
                                >
                                  {t(currentLang, "removeSavedKey")}
                                </button>
                              </>
                            ) : (
                              <span className="text-[var(--pe-text-faint)]">{t(currentLang, "noKey")}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEditCustom(cp)}
                            title={t(currentLang, "editProvider")}
                            className="rounded-lg p-1.5 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-accent-strong)]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeCustomProvider(cp)}
                            title={t(currentLang, "deleteProvider")}
                            className="rounded-lg p-1.5 text-[var(--pe-text-muted)] transition hover:bg-rose-500/10 hover:text-[var(--pe-rose-strong)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          )}

          {/* TAB 3: CUSTOM PROMPT BUTTONS */}
          {activeTab === "customButtons" && (
            <section className="space-y-4">
              <div>
                <h3 className="text-[12px] font-semibold text-[var(--pe-text)]">
                  {t(currentLang, "customButtonsTitle")}
                </h3>
                <p className="text-[11px] leading-relaxed text-[var(--pe-text-muted)] mt-0.5">
                  {t(currentLang, "customButtonsDesc")}
                </p>
              </div>

              {/* Form to add new button */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3.5 space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--pe-amber-strong)]">
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
                      : "bg-[var(--pe-hover)] text-[var(--pe-text-faint)] cursor-not-allowed",
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t(currentLang, "addCustomButton")}</span>
                </button>
              </div>

              {/* Existing Custom Buttons List */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                  {t(currentLang, "activeButtons")} ({(draft.customActions || []).length})
                </h4>
                {(draft.customActions || []).length === 0 ? (
                  <p className="text-[11px] text-[var(--pe-text-muted)] italic">
                    {t(currentLang, "noCustomButtons")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {draft.customActions.map((btn) => (
                      <div
                        key={btn.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-[var(--pe-border)] bg-[var(--pe-input)] p-3"
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-medium text-[var(--pe-amber-strong)]">
                              {btn.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--pe-text-soft)] font-mono leading-relaxed line-clamp-2">
                            {btn.prompt}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomButton(btn.id)}
                          className="rounded-lg p-1.5 text-[var(--pe-text-muted)] hover:bg-rose-500/10 hover:text-[var(--pe-rose-strong)] transition"
                          title={t(currentLang, "deleteButton")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Prompt Library */}
              <section className="space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--pe-violet-strong)]">
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>{t(currentLang, "templatesLabel")}</span>
                </div>
                <p className="text-[10px] leading-relaxed text-[var(--pe-text-muted)]">
                  {t(currentLang, "templatesDesc")}
                </p>

                {/* Add form */}
                <div className="space-y-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3.5">
                  <div className="text-[11px] font-medium text-[var(--pe-violet-strong)]">
                    {t(currentLang, "addTemplate")}
                  </div>
                  <input
                    type="text"
                    value={templateLabel}
                    onChange={(e) => setTemplateLabel(e.target.value)}
                    placeholder={t(currentLang, "templateLabelPlaceholder")}
                    className={inputCls}
                  />
                  <textarea
                    value={templatePrompt}
                    onChange={(e) => setTemplatePrompt(e.target.value)}
                    placeholder={t(currentLang, "templatePromptPlaceholder")}
                    rows={2}
                    className={cn(inputCls, "resize-none")}
                  />
                  <button
                    type="button"
                    onClick={handleAddTemplate}
                    disabled={!templateLabel.trim() || !templatePrompt.trim()}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition select-none",
                      templateLabel.trim() && templatePrompt.trim()
                        ? "bg-violet-500/90 text-zinc-950 hover:bg-violet-400"
                        : "bg-[var(--pe-hover)] text-[var(--pe-text-faint)] cursor-not-allowed",
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{t(currentLang, "addTemplate")}</span>
                  </button>
                </div>

                {/* Template list */}
                <div className="space-y-2">
                  {(draft.promptTemplates || []).length === 0 ? (
                    <p className="text-[11px] italic text-[var(--pe-text-muted)]">
                      {t(currentLang, "noTemplates")}
                    </p>
                  ) : (
                    (draft.promptTemplates || []).map((tpl) => (
                      <div
                        key={tpl.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-[var(--pe-border)] bg-[var(--pe-input)] p-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <span className="rounded-full bg-violet-400/20 px-2 py-0.5 text-[10px] font-medium text-[var(--pe-violet-strong)]">
                            {tpl.label}
                          </span>
                          <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-[var(--pe-text-soft)]">
                            {tpl.prompt}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(tpl.id)}
                          className="rounded-lg p-1.5 text-[var(--pe-text-muted)] transition hover:bg-rose-500/10 hover:text-[var(--pe-rose-strong)]"
                          title={t(currentLang, "deleteTemplate")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleRestoreTemplates}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-3 py-1.5 text-[11px] text-[var(--pe-text)] transition hover:bg-[var(--pe-hover)]"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t(currentLang, "restoreDefaults")}
                </button>
              </section>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--pe-border-soft)] px-5 py-3">
          <div className="flex items-center gap-2 text-[11px] text-[var(--pe-text-muted)]">
            <span className="font-medium text-[var(--pe-text)]">SpotAI v{APP_VERSION}</span>
            <span className="text-[var(--pe-text-faint)]">•</span>
            <button
              type="button"
              onClick={() => void openExternalUrl("https://github.com/jaimitus/SpotAI")}
              className="inline-flex items-center gap-1 text-cyan-400 hover:text-[var(--pe-accent-strong)] hover:underline transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t(currentLang, "githubRepo")}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {saveError && (
              <p className="max-w-64 text-[10px] text-[var(--pe-rose-strong)]">
                {saveError}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
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
      <span className="text-[11px] font-medium text-[var(--pe-text-soft)]">{label}</span>
      {children}
    </label>
  );
}

const inputCls = cn(
  "w-full rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-3 py-2",
  "text-[12px] text-[var(--pe-text)] placeholder:text-[var(--pe-text-faint)]",
  "outline-none transition focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-400/20",
);
