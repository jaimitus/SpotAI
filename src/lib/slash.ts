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
  /** Stable English keywords (`/new`, `/theme`, …) usable without the palette. */
  keywords?: string[];
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

/**
 * System actions available from the `/` palette. Labels are intentionally
 * fixed in English (Raycast/Slack style) so slash commands work the same in
 * every UI language — the app is international, the commands are universal.
 */
export const SYSTEM_SLASH_ACTIONS: {
  id: SystemActionId;
  label: string;
  icon: string;
}[] = [
  { id: "new", label: "New chat", icon: "message" },
  { id: "theme", label: "Toggle theme", icon: "sparkles" },
  { id: "capture", label: "Capture screen region", icon: "search" },
  { id: "incognito", label: "Toggle incognito", icon: "wand" },
  { id: "settings", label: "Open settings", icon: "wrench" },
  { id: "hide", label: "Hide window", icon: "list" },
  { id: "clear", label: "Clear conversation", icon: "code" },
  { id: "exec", label: "Run shell command", icon: "terminal" },
  { id: "rag", label: "Ask your files (RAG)", icon: "database" },
];

/**
 * Single source of truth for the slash query: everything after the leading "/"
 * up to the first whitespace, lowercased ("/New text" → "new"). Both the
 * palette builder and the keyboard handlers must derive the query this way so
 * they never disagree.
 */
export function getSlashQuery(prompt: string): string {
  const match = prompt.match(/^\/(\S*)/);
  return match ? match[1].toLowerCase() : "";
}

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
  if (!prompt.startsWith("/")) return [];
  const query = getSlashQuery(prompt);

  const all: SlashAction[] = [
    ...ACTION_CHIPS.map((chip) => ({
      key: `chip:${chip.id}`,
      label: t(lang, CHIP_I18N_KEYS[chip.id]),
      icon: chip.icon,
      kind: "chip" as const,
      keywords: [chip.id],
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
      label: system.label,
      icon: system.icon,
      kind: "system" as const,
      keywords: [system.id],
      systemId: system.id,
    })),
  ];
  if (!query) return all;

  // Prioritize an exact keyword match (e.g. "/new") so the command can be
  // typed and run without browsing the palette; partial label/key matches
  // still work for the fuzzy palette search.
  const exact = all.filter((action) =>
    (action.keywords ?? []).some((keyword) => keyword === query),
  );
  const fuzzy = all.filter(
    (action) =>
      !(action.keywords ?? []).some((keyword) => keyword === query) &&
      (action.label.toLowerCase().includes(query) ||
        action.key.toLowerCase().includes(query)),
  );
  return [...exact, ...fuzzy];
}
