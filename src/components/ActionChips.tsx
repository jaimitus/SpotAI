import {
  Braces,
  Languages,
  ListTree,
  MessageSquareText,
  Search,
  Sparkles,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { t } from "../lib/i18n";
import { ACTION_CHIPS } from "../lib/prompts";
import type { ActionChipId, ContextKind, CustomAction, Language } from "../types";
import { cn } from "../utils/cn";

interface ActionChipsProps {
  active?: string | null;
  disabled?: boolean;
  onSelect: (id: ActionChipId) => void;
  onSelectCustom?: (customAction: CustomAction) => void;
  customActions?: CustomAction[];
  lang?: Language;
  compact?: boolean;
  contextKind?: ContextKind;
}

const ICONS = {
  search: Search,
  wrench: Wrench,
  code: Braces,
  list: ListTree,
  languages: Languages,
  wand: WandSparkles,
  message: MessageSquareText,
  sparkles: Sparkles,
};

const CHIP_I18N_KEYS: Record<ActionChipId, keyof typeof import("../lib/i18n").translations["en"]> = {
  explain: "explain",
  refactor: "refactor",
  summarize: "summarize",
  fix: "fixBugs",
  translate: "translate",
  improve: "improve",
  comment: "comment",
};

export function ActionChips({
  active,
  disabled,
  onSelect,
  onSelectCustom,
  customActions = [],
  lang = "en",
  compact,
  contextKind = "empty",
}: ActionChipsProps) {
  const priority: Record<ContextKind, ActionChipId[]> = {
    empty: ["explain", "fix", "refactor", "summarize", "translate", "improve", "comment"],
    text: ["summarize", "improve", "translate", "explain", "comment", "fix", "refactor"],
    code: ["explain", "fix", "refactor", "comment", "summarize", "improve", "translate"],
    error: ["fix", "explain", "refactor", "summarize", "comment", "improve", "translate"],
    json: ["explain", "fix", "refactor", "summarize", "comment", "improve", "translate"],
    url: ["summarize", "explain", "translate", "improve", "fix", "refactor", "comment"],
  };
  const orderedChips = [...ACTION_CHIPS].sort(
    (a, b) => priority[contextKind].indexOf(a.id) - priority[contextKind].indexOf(b.id),
  );

  return (
    <div
      className={cn(
        "custom-scroll flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5",
        compact ? "px-1" : "px-0",
      )}
    >
      {/* Standard built-in chips */}
      {orderedChips.map((chip) => {
        const isActive = active === chip.id;
        const Icon = ICONS[chip.icon] || Sparkles;
        const translatedLabel = t(lang, CHIP_I18N_KEYS[chip.id] || "explain");

        return (
          <button
            key={chip.id}
            type="button"
            disabled={disabled}
            title={chip.description}
            onClick={() => onSelect(chip.id)}
            className={cn(
              "group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide transition-all duration-150 select-none",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isActive
                ? "border-cyan-400/50 bg-cyan-400/15 text-[var(--pe-accent-strong)] shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                : "border-[var(--pe-border)] bg-[var(--pe-input)] text-[var(--pe-text-soft)] hover:border-[var(--pe-border)] hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]",
            )}
          >
            <Icon className="h-3 w-3 opacity-90 text-cyan-400" />
            <span>{translatedLabel}</span>
          </button>
        );
      })}

      {/* User Custom Action Buttons */}
      {customActions.map((custom) => {
        const isActive = active === custom.id;
        const Icon = (custom.icon && ICONS[custom.icon]) || Sparkles;

        return (
          <button
            key={custom.id}
            type="button"
            disabled={disabled}
            title={custom.prompt}
            onClick={() => {
              if (onSelectCustom) {
                onSelectCustom(custom);
              }
            }}
            className={cn(
              "group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide transition-all duration-150 select-none",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isActive
                ? "border-amber-400/50 bg-amber-400/15 text-[var(--pe-amber-strong)] shadow-[0_0_12px_rgba(251,191,36,0.15)]"
                : "border-amber-500/20 bg-amber-500/[0.05] text-[var(--pe-amber-strong)] hover:border-amber-400/40 hover:bg-amber-500/10 hover:text-[var(--pe-amber-strong)]",
            )}
          >
            <Icon className="h-3 w-3 text-amber-400 opacity-90" />
            <span>{custom.label}</span>
          </button>
        );
      })}
    </div>
  );
}
