import { ChevronDown, Cloud, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROVIDER_META } from "../lib/prompts";
import type { ModelInfo, ProviderId } from "../types";
import { cn } from "../utils/cn";

interface ProviderBadgeProps {
  provider: ProviderId;
  model: string;
  models: ModelInfo[];
  ollamaOnline?: boolean;
  onChange: (provider: ProviderId, model: string) => void;
}

const PROVIDER_ORDER: ProviderId[] = [
  "ollama",
  "lmstudio",
  "anthropic",
  "openai",
  "groq",
  "deepseek",
];

export function ProviderBadge({
  provider,
  model,
  models,
  ollamaOnline,
  onChange,
}: ProviderBadgeProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const meta = PROVIDER_META[provider] ?? PROVIDER_META.ollama;
  const shortModel = model.includes(":")
    ? model.split(":")[0]
    : model.replace(/-latest$/, "");

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

  const modelsFor = (p: string) => models.filter((m) => m.provider === p);

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
        {meta.mode === "local" ? (
          <Zap className="h-3 w-3 text-cyan-400" strokeWidth={2.5} />
        ) : (
          <Cloud className="h-3 w-3 text-amber-400" strokeWidth={2.5} />
        )}
        <span className="text-zinc-400">{meta.label}</span>
        <span className="text-zinc-600">|</span>
        <span className="max-w-[120px] truncate text-zinc-200">
          {shortModel || "Select model"}
        </span>
        {provider === "ollama" && (
          <span
            className={cn(
              "ml-0.5 h-1.5 w-1.5 rounded-full",
              ollamaOnline ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-zinc-600",
            )}
            title={ollamaOnline ? "Ollama online" : "Ollama offline"}
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
          <div className="max-h-80 overflow-y-auto p-1.5 custom-scroll">
            {PROVIDER_ORDER.map((p) => {
              const pMeta = PROVIDER_META[p];
              const list = modelsFor(p);
              if (list.length === 0 && p !== "ollama" && p !== "lmstudio") {
                // still show cloud providers with empty list message
              }
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
                      {pMeta.mode}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[11px] text-zinc-600">
                      {p === "ollama"
                        ? "No local models. Is Ollama running?"
                        : "Configure in Settings"}
                    </div>
                  ) : (
                    list.map((m) => {
                      const selected = provider === p && model === m.id;
                      return (
                        <button
                          key={`${p}-${m.id}`}
                          type="button"
                          onClick={() => {
                            onChange(p, m.id);
                            setOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors",
                            selected
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
                          <span className="truncate">{m.name || m.id}</span>
                        </button>
                      );
                    })
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
