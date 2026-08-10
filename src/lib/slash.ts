import type {
  ActionChipId,
  CustomAction,
  Language,
  PromptTemplate,
  SystemActionId,
} from "../types";
import { t, type TranslationKey } from "./i18n";
import { ACTION_CHIPS } from "./prompts";

export interface SlashAction {
  key: string;
  label: string;
  icon: string;
  kind: "chip" | "custom" | "system" | "template";
  chipId?: ActionChipId;
  custom?: CustomAction;
  template?: PromptTemplate;
  systemId?: SystemActionId;
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

/** System actions available from the `/` palette. */
export const SYSTEM_SLASH_ACTIONS: {
  id: SystemActionId;
  labelKey: TranslationKey;
  icon: string;
}[] = [
  { id: "new", labelKey: "systemNewChat", icon: "message" },
  { id: "theme", labelKey: "systemToggleTheme", icon: "sparkles" },
  { id: "capture", labelKey: "systemCapture", icon: "search" },
  { id: "incognito", labelKey: "systemIncognito", icon: "wand" },
  { id: "settings", labelKey: "systemSettings", icon: "wrench" },
  { id: "hide", labelKey: "systemHide", icon: "list" },
  { id: "clear", labelKey: "systemClear", icon: "code" },
];

/**
 * Builds the command palette entries for a prompt like "/sum ...". Returns an
 * empty list when the prompt does not start with "/". With no query, every
 * built-in chip, custom action, prompt template and system action is listed.
 */
export function buildSlashActions(
  prompt: string,
  customActions: CustomAction[],
  promptTemplates: PromptTemplate[],
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
    ...promptTemplates.map((template) => ({
      key: `template:${template.id}`,
      label: template.label,
      icon: "wand",
      kind: "template" as const,
      template,
    })),
    ...SYSTEM_SLASH_ACTIONS.map((system) => ({
      key: `system:${system.id}`,
      label: t(lang, system.labelKey),
      icon: system.icon,
      kind: "system" as const,
      systemId: system.id,
    })),
  ];
  if (!query) return all;
  return all.filter(
    (action) =>
      action.label.toLowerCase().includes(query) ||
      action.key.toLowerCase().includes(query),
  );
}
