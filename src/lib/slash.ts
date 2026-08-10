import type { ActionChipId, CustomAction, Language } from "../types";
import { t, type TranslationKey } from "./i18n";
import { ACTION_CHIPS } from "./prompts";

export interface SlashAction {
  key: string;
  label: string;
  icon: string;
  kind: "chip" | "custom";
  chipId?: ActionChipId;
  custom?: CustomAction;
}

const CHIP_I18N_KEYS: Record<ActionChipId, TranslationKey> = {
  explain: "explain",
  refactor: "refactor",
  summarize: "summarize",
  fix: "fixBugs",
  translate: "translate",
  improve: "improve",
  comment: "comment",
};

/**
 * Builds the command palette entries for a prompt like "/sum ...". Returns an
 * empty list when the prompt does not start with "/". With no query, every
 * built-in chip and custom action is listed.
 */
export function buildSlashActions(
  prompt: string,
  customActions: CustomAction[],
  lang: Language,
): SlashAction[] {
  const match = prompt.match(/^\/(\S*)/);
  if (!match) return [];
  const query = match[1].toLowerCase();

  const all: SlashAction[] = [
    ...ACTION_CHIPS.map((chip) => ({
      key: `chip:${chip.id}`,
      label: t(lang, CHIP_I18N_KEYS[chip.id]),
      icon: chip.icon,
      kind: "chip" as const,
      chipId: chip.id,
    })),
    ...customActions.map((custom) => ({
      key: `custom:${custom.id}`,
      label: custom.label,
      icon: custom.icon ?? "sparkles",
      kind: "custom" as const,
      custom,
    })),
  ];
  if (!query) return all;
  return all.filter(
    (action) =>
      action.label.toLowerCase().includes(query) ||
      action.key.toLowerCase().includes(query),
  );
}
