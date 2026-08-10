import { ChevronDown, Cloud, RefreshCw, Search, Zap } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { t } from "../lib/i18n";
import { PROVIDER_META } from "../lib/prompts";
import type { CustomProvider, Language, ModelInfo, ProviderId } from "../types";
import { cn } from "../utils/cn";

interface ProviderBadgeProps {
  provider: string;
  model: string;
  models: ModelInfo[];
  customProviders?: CustomProvider[];
  ollamaOnline?: boolean;
  lang?: Language;
  onRefresh?: () => void;
  onChange: (provider: string, model: string) => void;
}

const PROVIDER_ORDER: ProviderId[] = [
  "ollama",
  "lmstudio",
  "anthropic",
  "openai",
  "groq",
  "deepseek",
];

interface FlatItem {
  provider: string;
  model: ModelInfo;
  refIndex: number;
}

/**
 * Raycast-style subsequence scorer: returns a positive score when every query
 * character appears in order inside `target`, or -1 when it does not. Earlier
 * matches, consecutive runs and shorter targets score higher, so typo-tolerant
 * queries still rank the intended model first.
 */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  let queryIndex = 0;
  let lastMatch = -2;
  let score = 0;
  for (let targetIndex = 0; targetIndex < target.length && queryIndex < query.length; targetIndex++) {
    if (target[targetIndex] === query[queryIndex]) {
      queryIndex++;
      score += targetIndex === 0 ? 10 : targetIndex === lastMatch + 1 ? 3 : 1;
      lastMatch = targetIndex;
    }
  }
  if (queryIndex < query.length) return -1;
  return score - Math.abs(target.length - query.length);
}

function formatModelSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function ModelItem({
  model,
  selected,
  highlighted,
  onHighlight,
  registerRef,
  onSelect,
}: {
  model: ModelInfo;
  selected: boolean;
  highlighted: boolean;
  onHighlight: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
  onSelect: () => void;
}) {
  return (
    <button
      ref={registerRef}
      type="button"
      onMouseEnter={onHighlight}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors",
        highlighted || selected
          ? "bg-cyan-400/10 text-[var(--pe-accent-strong)]"
          : "text-[var(--pe-text)] hover:bg-[var(--pe-hover)]",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          selected ? "bg-cyan-400" : "bg-zinc-600",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{model.name || model.id}</span>
      {formatModelSize(model.size) && (
        <span className="shrink-0 font-mono text-[10px] text-[var(--pe-text-faint)]">
          {formatModelSize(model.size)}
        </span>
      )}
    </button>
  );
}

export function ProviderBadge({
  provider,
  model,
  models,
  customProviders = [],
  ollamaOnline,
  lang = "en",
  onRefresh,
  onChange,
}: ProviderBadgeProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isCustom = provider.startsWith("custom:");
  const customMeta = isCustom
    ? customProviders.find((cp) => provider === `custom:${cp.id}`)
    : undefined;
  const meta = isCustom ? PROVIDER_META.ollama : PROVIDER_META[provider] ?? PROVIDER_META.ollama;
  const badgeLabel = customMeta?.name ?? meta.label;
  const badgeIsCloud = isCustom || meta.mode !== "local";
  const shortModel = model.includes(":")
    ? model.split(":")[0]
    : model.replace(/-latest$/, "");

  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return models;
    return models
      .map((m) => ({
        model: m,
        score: Math.max(
          fuzzyScore(normalizedQuery, m.name.toLowerCase()),
          fuzzyScore(normalizedQuery, m.id.toLowerCase()),
        ),
      }))
      .filter((entry): entry is { model: ModelInfo; score: number } => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.model);
  }, [models, normalizedQuery]);

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];
    let refIndex = 0;
    for (const p of PROVIDER_ORDER) {
      for (const m of filteredModels) {
        if (m.provider === p) items.push({ provider: p, model: m, refIndex: refIndex++ });
      }
    }
    for (const cp of customProviders) {
      const key = `custom:${cp.id}`;
      for (const m of filteredModels) {
        if (m.provider === key) items.push({ provider: key, model: m, refIndex: refIndex++ });
      }
    }
    return items;
  }, [filteredModels, customProviders]);

  // Reset search state and focus the search box when the dropdown opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlighted(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    itemRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const moveHighlight = (delta: number) => {
    if (flatItems.length === 0) return;
    setHighlighted((current) => (current + delta + flatItems.length) % flatItems.length);
  };

  const selectItem = (item: FlatItem) => {
    onChange(item.provider, item.model.id);
    setOpen(false);
  };

  const selectHighlighted = () => {
    const item = flatItems[highlighted];
    if (item) selectItem(item);
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectHighlighted();
    }
  };

  const modelsFor = (p: string) => filteredModels.filter((m) => m.provider === p);

  const renderModelList = (p: string, list: ModelInfo[]) =>
    list.map((m) => {
      const item = flatItems.find(
        (candidate) => candidate.provider === p && candidate.model.id === m.id,
      );
      const refIndex = item?.refIndex ?? 0;
      return (
        <ModelItem
          key={`${p}-${m.id}`}
          model={m}
          selected={provider === p && model === m.id}
          highlighted={highlighted === refIndex}
          onHighlight={() => setHighlighted(refIndex)}
          registerRef={(el) => {
            itemRefs.current[refIndex] = el;
          }}
          onSelect={() => {
            onChange(p, m.id);
            setOpen(false);
          }}
        />
      );
    });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all",
          "border-[var(--pe-border)] bg-[var(--pe-input)] text-[var(--pe-text)] hover:border-[var(--pe-border)] hover:bg-[var(--pe-hover)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50",
        )}
      >
        {badgeIsCloud ? (
          <Cloud className="h-3 w-3 text-amber-400" strokeWidth={2.5} />
        ) : (
          <Zap className="h-3 w-3 text-cyan-400" strokeWidth={2.5} />
        )}
        <span className="text-[var(--pe-text-soft)]">{badgeLabel}</span>
        <span className="text-[var(--pe-text-faint)]">|</span>
        <span className="max-w-[120px] truncate text-[var(--pe-text)]">
          {shortModel || t(lang, "selectModel")}
        </span>
        {provider === "ollama" && (
          <span
            className={cn(
              "ml-0.5 h-1.5 w-1.5 rounded-full",
              ollamaOnline ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-zinc-600",
            )}
            title={ollamaOnline ? t(lang, "ollamaOnline") : t(lang, "ollamaOffline")}
          />
        )}
        <ChevronDown
          className={cn(
            "h-3 w-3 text-[var(--pe-text-muted)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            "pe-pop absolute right-0 top-[calc(100%+6px)] z-50 w-72 overflow-hidden rounded-xl border border-[var(--pe-border)]",
            "bg-[var(--pe-bg-2)] shadow-2xl shadow-black/50 backdrop-blur-xl",
          )}
        >
          {/* Header: search + refresh */}
          <div className="flex items-center gap-1.5 border-b border-[var(--pe-border-soft)] px-2.5 py-2">
            <Search className="h-3 w-3 shrink-0 text-[var(--pe-text-muted)]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={t(lang, "searchModels")}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--pe-text)] outline-none placeholder:text-[var(--pe-text-faint)]"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => onRefresh?.()}
              title={t(lang, "refreshModels")}
              aria-label={t(lang, "refreshModels")}
              className="rounded-md p-1 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-accent-strong)]"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5 custom-scroll">
            {flatItems.length === 0 && (
              <div className="px-2.5 py-2 text-[11px] text-[var(--pe-text-faint)]">
                {t(lang, "noMatchingModels")}
              </div>
            )}
            {PROVIDER_ORDER.map((p) => {
              const pMeta = PROVIDER_META[p];
              const list = modelsFor(p);
              if (list.length === 0 && normalizedQuery) return null;
              return (
                <div key={p} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                    {pMeta.mode === "local" ? (
                      <Zap className="h-3 w-3" style={{ color: pMeta.color }} />
                    ) : (
                      <Cloud className="h-3 w-3" style={{ color: pMeta.color }} />
                    )}
                    {pMeta.label}
                    <span className="ml-auto font-normal normal-case tracking-normal text-[var(--pe-text-faint)]">
                      {pMeta.mode === "local" ? t(lang, "local") : t(lang, "cloud")}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[11px] text-[var(--pe-text-faint)]">
                      {p === "ollama" ? t(lang, "noLocalModels") : t(lang, "configureInSettings")}
                    </div>
                  ) : (
                    renderModelList(p, list)
                  )}
                </div>
              );
            })}
            {customProviders.map((cp) => {
              const key = `custom:${cp.id}`;
              const list = modelsFor(key);
              if (list.length === 0 && normalizedQuery) return null;
              return (
                <div key={key} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--pe-text-muted)]">
                    <Cloud className="h-3 w-3" style={{ color: "#60a5fa" }} />
                    {cp.name}
                    <span className="ml-auto font-normal normal-case tracking-normal text-[var(--pe-text-faint)]">
                      {t(lang, "cloud")}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[11px] text-[var(--pe-text-faint)]">
                      {t(lang, "configureInSettings")}
                    </div>
                  ) : (
                    renderModelList(key, list)
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
