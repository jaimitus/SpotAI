import {
  Braces,
  Languages,
  ListTree,
  MessageSquareText,
  Search,
  Sparkles,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { t } from "../lib/i18n";
import type { SlashAction } from "../lib/slash";
import type { Language } from "../types";
import { cn } from "../utils/cn";

const ICONS: Record<string, LucideIcon> = {
  search: Search,
  wrench: Wrench,
  code: Braces,
  list: ListTree,
  languages: Languages,
  wand: WandSparkles,
  message: MessageSquareText,
  sparkles: Sparkles,
};

interface SlashMenuProps {
  actions: SlashAction[];
  activeIndex: number;
  lang: Language;
  onHover: (index: number) => void;
  onPick: (action: SlashAction) => void;
}

export function SlashMenu({
  actions,
  activeIndex,
  lang,
  onHover,
  onPick,
}: SlashMenuProps) {
  return (
    <div className="pe-pop absolute left-3 right-3 top-full z-40 mt-1 overflow-hidden rounded-xl border border-[var(--pe-border)] bg-[var(--pe-bg-2)] shadow-2xl shadow-black/60 backdrop-blur-xl">
      <div className="custom-scroll max-h-56 overflow-y-auto p-1.5">
        <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--pe-text-muted)]">
          {t(lang, "slashHint")}
        </div>
        {actions.length === 0 ? (
          <div className="px-2.5 py-2 text-[11px] text-[var(--pe-text-faint)]">
            {t(lang, "noCommands")}
          </div>
        ) : (
          <div className="pb-1">
            {actions.map((action, index) => {
              const Icon = ICONS[action.icon] || Sparkles;
              const accent =
                action.kind === "custom" || action.kind === "template"
                  ? "amber"
                  : action.kind === "system"
                    ? "violet"
                    : "cyan";
              return (
                <button
                  key={action.key}
                  type="button"
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onPick(action)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors",
                    index === activeIndex
                      ? accent === "amber"
                        ? "bg-amber-400/10 text-[var(--pe-amber-strong)]"
                        : accent === "violet"
                          ? "bg-violet-400/10 text-[var(--pe-violet-strong)]"
                          : "bg-cyan-400/10 text-[var(--pe-accent-strong)]"
                      : "text-[var(--pe-text)] hover:bg-[var(--pe-hover)]",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      accent === "amber"
                        ? "text-amber-400"
                        : accent === "violet"
                          ? "text-violet-400"
                          : "text-cyan-400",
                    )}
                  />
                  <span className="min-w-0 truncate">{action.label}</span>
                  {action.keywords?.[0] && (
                    <kbd className="ml-auto shrink-0 rounded border border-[var(--pe-border)] bg-[var(--pe-hover)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--pe-text-muted)]">
                      /{action.keywords[0]}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
