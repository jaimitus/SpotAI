import type { ChatMessage, Conversation } from "../types";

const STORAGE_KEY = "spotai.conversations.v2";
const ACTIVE_KEY = "spotai.active-conversation.v1";
const LEGACY_CONVERSATION_KEY = "spotai.conversation.v1";
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 40;
const MAX_CHARS = 80_000;

export function createConversationId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Auto-title from the first user prompt, truncated to a compact label. */
export function autoTitle(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return "";
  const clean = first.content.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

/** Pinned conversations first, then most recently updated. */
function byPinned(a: Conversation, b: Conversation): number {
  const aPinned = a.pinned ? 1 : 0;
  const bPinned = b.pinned ? 1 : 0;
  if (aPinned !== bPinned) return bPinned - aPinned;
  return b.updatedAt - a.updatedAt;
}

/** Keeps the newest messages within both a message and a character budget. */
export function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let total = 0;
  for (const message of [...messages].reverse()) {
    if (kept.length >= MAX_MESSAGES) break;
    if (total + message.content.length > MAX_CHARS) break;
    total += message.content.length;
    kept.push(message);
  }
  return kept.reverse();
}

export interface ConversationsState {
  conversations: Conversation[];
  activeId: string | null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    item.content.trim().length > 0
  );
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ChatMessage | null => (isChatMessage(item) ? item : null))
    .filter((item): item is ChatMessage => item !== null);
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.updatedAt === "number" &&
    Array.isArray(item.messages)
  );
}

/** Migrates the pre-v1.3 single-conversation format into the list format. */
function migrateLegacy(): Conversation[] {
  try {
    const raw = localStorage.getItem(LEGACY_CONVERSATION_KEY);
    if (!raw) return [];
    const messages = parseMessages(JSON.parse(raw));
    if (messages.length === 0) return [];
    localStorage.removeItem(LEGACY_CONVERSATION_KEY);
    const now = Date.now();
    return [
      {
        id: createConversationId(),
        title: autoTitle(messages) || "New chat",
        createdAt: now,
        updatedAt: now,
        messages: trimMessages(messages),
      },
    ];
  } catch {
    return [];
  }
}

/** Loads the conversation list (with legacy migration) and the active id. */
export function loadConversationsState(): ConversationsState {
  let conversations: Conversation[] = [];
  let migrated = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      conversations = parsed
        .filter(isConversation)
        .map((conversation) => ({
          ...conversation,
          messages: trimMessages(conversation.messages),
        }))
        .sort(byPinned)
        .slice(0, MAX_CONVERSATIONS);
    } else {
      const legacy = migrateLegacy();
      if (legacy.length > 0) {
        conversations = legacy;
        migrated = true;
      }
    }
  } catch {
    conversations = [];
  }

  let activeId: string | null = null;
  try {
    const stored = localStorage.getItem(ACTIVE_KEY);
    if (
      stored &&
      conversations.some((conversation) => conversation.id === stored)
    ) {
      activeId = stored;
    }
  } catch {
    activeId = null;
  }
  if (migrated && conversations.length > 0 && !activeId) {
    activeId = conversations[0].id;
  }
  return { conversations, activeId };
}

/** Inserts or updates a conversation, keeping the list sorted by recency. */
export function upsertConversation(
  conversations: Conversation[],
  next: Conversation,
): Conversation[] {
  const without = conversations.filter((item) => item.id !== next.id);
  return [next, ...without].sort(byPinned).slice(0, MAX_CONVERSATIONS);
}

/**
 * Toggles the pinned flag and immediately re-floats the pinned conversations to
 * the top, so the UI reflects the new state without waiting for the next
 * message update.
 */
export function togglePinned(
  conversations: Conversation[],
  id: string,
): Conversation[] {
  return conversations
    .map((item) =>
      item.id === id ? { ...item, pinned: !item.pinned } : item,
    )
    .sort(byPinned);
}

export function removeConversation(
  conversations: Conversation[],
  id: string,
): Conversation[] {
  return conversations.filter((item) => item.id !== id);
}

export function renameConversation(
  conversations: Conversation[],
  id: string,
  title: string,
): Conversation[] {
  const trimmed = title.trim();
  return conversations.map((item) =>
    item.id === id
      ? {
          ...item,
          title: trimmed || autoTitle(item.messages) || "New chat",
          renamed: true,
        }
      : item,
  );
}

export function persistConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // Persistence is best-effort; the overlay must still work.
  }
}

export function persistActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Best-effort.
  }
}
