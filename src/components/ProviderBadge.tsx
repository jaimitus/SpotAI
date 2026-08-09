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
          ? "bg-cyan-400/10 text-cyan-200"
          : "text-zinc-300 hover:bg-white/[0.05]",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          selected ? "bg-cyan-400" : "bg-zinc-600",
        )}
      />
      <span className="truncate">{model.name || model.id}</span>
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
  const filteredModels = useMemo(
    () =>
      normalizedQuery
        ? models.filter(
            (m) =>
              m.name.toLowerCase().includes(normalizedQuery) ||
              m.id.toLowerCase().includes(normalizedQuery),
          )
        : models,
    [models, normalizedQuery],
  );

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
          "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20 hover:bg-white/[0.07]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50",
        )}
      >
        {badgeIsCloud ? (
          <Cloud className="h-3 w-3 text-amber-400" strokeWidth={2.5} />
        ) : (
          <Zap className="h-3 w-3 text-cyan-400" strokeWidth={2.5} />
        )}
        <span className="text-zinc-400">{badgeLabel}</span>
        <span className="text-zinc-600">|</span>
        <span className="max-w-[120px] truncate text-zinc-200">
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
            "h-3 w-3 text-zinc-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50 w-72 overflow-hidden rounded-xl border border-white/10",
            "bg-[#0c0e14]/95 shadow-2xl shadow-black/50 backdrop-blur-xl",
          )}
        >
          {/* Header: search + refresh */}
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-2">
            <Search className="h-3 w-3 shrink-0 text-zinc-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={t(lang, "searchModels")}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => onRefresh?.()}
              title={t(lang, "refreshModels")}
              aria-label={t(lang, "refreshModels")}
              className="rounded-md p-1 text-zinc-500 transition hover:bg-white/5 hover:text-cyan-300"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5 custom-scroll">
            {flatItems.length === 0 && (
              <div className="px-2.5 py-2 text-[11px] text-zinc-600">
                {t(lang, "noMatchingModels")}
              </div>
            )}
            {PROVIDER_ORDER.map((p) => {
              const pMeta = PROVIDER_META[p];
              const list = modelsFor(p);
              if (list.length === 0 && normalizedQuery) return null;
              return (
                <div key={p} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {pMeta.mode === "local" ? (
                      <Zap className="h-3 w-3" style={{ color: pMeta.color }} />
                    ) : (
                      <Cloud className="h-3 w-3" style={{ color: pMeta.color }} />
                    )}
                    {pMeta.label}
                    <span className="ml-auto font-normal normal-case tracking-normal text-zinc-600">
                      {pMeta.mode === "local" ? t(lang, "local") : t(lang, "cloud")}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[11px] text-zinc-600">
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
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Cloud className="h-3 w-3" style={{ color: "#60a5fa" }} />
                    {cp.name}
                    <span className="ml-auto font-normal normal-case tracking-normal text-zinc-600">
                      {t(lang, "cloud")}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[11px] text-zinc-600">
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
