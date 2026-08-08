import {
  Braces,
  Languages,
  ListTree,
  MessageSquareText,
  Search,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { ACTION_CHIPS } from "../lib/prompts";
import type { ActionChipId } from "../types";
import { cn } from "../utils/cn";

interface ActionChipsProps {
  active?: ActionChipId | null;
  disabled?: boolean;
  onSelect: (id: ActionChipId) => void;
  compact?: boolean;
}

const ICONS = {
  search: Search,
  wrench: Wrench,
  code: Braces,
  list: ListTree,
  languages: Languages,
  wand: WandSparkles,
  message: MessageSquareText,
};

export function ActionChips({
  active,
  disabled,
  onSelect,
  compact,
}: ActionChipsProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        compact ? "px-1" : "px-0",
      )}
    >
      {ACTION_CHIPS.map((chip) => {
        const isActive = active === chip.id;
        const Icon = ICONS[chip.icon];
        return (
          <button
            key={chip.id}
            type="button"
            disabled={disabled}
            title={chip.description}
            onClick={() => onSelect(chip.id)}
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide transition-all duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isActive
                ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200",
            )}
          >
            <Icon className="h-3 w-3 opacity-90" />
            <span>{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
