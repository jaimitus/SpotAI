import {
  History,
  MessageSquarePlus,
  Pencil,
  Pin,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../lib/i18n";
import type { Conversation, Language } from "../types";
import { cn } from "../utils/cn";

interface ChatsMenuProps {
  conversations: Conversation[];
  activeId: string | null;
  lang: Language;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onNewChat: () => void;
}

function relativeTime(timestamp: number, lang: Language): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.round(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(minutes) < 1) return formatter.format(0, "minute");
  if (Math.abs(minutes) < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(-days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(-months, "month");
  return formatter.format(-Math.round(months / 12), "year");
}

export function ChatsMenu({
  conversations,
  activeId,
  lang,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onNewChat,
}: ChatsMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // Search matches titles AND message contents, so past answers are findable.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(q) ||
        conversation.messages.some((message) =>
          message.content.toLowerCase().includes(q),
        ),
    );
  }, [conversations, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRenamingId(null);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (renamingId) {
      const conversation = conversations.find((item) => item.id === renamingId);
      setRenameDraft(conversation?.title ?? "");
      requestAnimationFrame(() => {
        renameRef.current?.focus();
        renameRef.current?.select();
      });
    }
  }, [renamingId, conversations]);

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

  const commitRename = () => {
    if (renamingId) onRename(renamingId, renameDraft);
    setRenamingId(null);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t(lang, "chats")}
        aria-label={t(lang, "chats")}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
      >
        <History className="h-3 w-3" />
      </button>

      {open && (
        <div className="pe-pop absolute right-0 top-[calc(100%+6px)] z-50 flex w-72 flex-col overflow-hidden rounded-xl border border-[var(--pe-border)] bg-[var(--pe-bg-2)] shadow-2xl shadow-black/60 backdrop-blur-xl">
          {/* Header: search + new chat */}
          <div className="flex items-center gap-1.5 border-b border-[var(--pe-border-soft)] px-2.5 py-2">
            <Search className="h-3 w-3 shrink-0 text-[var(--pe-text-muted)]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, "searchChats")}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--pe-text)] outline-none placeholder:text-[var(--pe-text-faint)]"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => {
                onNewChat();
                setOpen(false);
              }}
              title={t(lang, "newChat")}
              className="rounded-md p-1 text-[var(--pe-text-muted)] transition hover:bg-cyan-400/10 hover:text-[var(--pe-accent-strong)]"
            >
              <MessageSquarePlus className="h-3 w-3" />
            </button>
          </div>

          {/* List */}
          <div className="custom-scroll max-h-64 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-[var(--pe-text-faint)]">
                {t(lang, "noChats")}
              </div>
            ) : (
              filtered.map((conversation) => {
                const isActive = conversation.id === activeId;
                const isRenaming = renamingId === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      isActive ? "bg-cyan-400/10" : "hover:bg-[var(--pe-input)]",
                    )}
                  >
                    {isRenaming ? (
                      <input
                        ref={renameRef}
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={commitRename}
                        className="min-w-0 flex-1 rounded-md border border-cyan-400/40 bg-[var(--pe-input)] px-1.5 py-0.5 text-[12px] text-[var(--pe-text-strong)] outline-none"
                        spellCheck={false}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(conversation.id);
                          setOpen(false);
                        }}
                        className="min-w-0 flex-1"
                      >
                        <span
                          className={cn(
                            "block truncate text-[12px]",
                            isActive ? "text-[var(--pe-accent-strong)]" : "text-[var(--pe-text)]",
                          )}
                        >
                          {conversation.title || "New chat"}
                        </span>
                        <span className="block text-[10px] text-[var(--pe-text-faint)]">
                          {conversation.messages.length} ·{" "}
                          {relativeTime(conversation.updatedAt, lang)}
                        </span>
                      </button>
                    )}
                    {!isRenaming && (
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => onTogglePin(conversation.id)}
                          title={t(lang, conversation.pinned ? "unpinChat" : "pinChat")}
                          className={cn(
                            "rounded p-1 transition",
                            conversation.pinned
                              ? "text-[var(--pe-accent-strong)]"
                              : "text-[var(--pe-text-muted)] hover:bg-[var(--pe-hover)] hover:text-[var(--pe-accent-strong)]",
                          )}
                        >
                          <Pin className={cn("h-3 w-3", conversation.pinned && "fill-current")} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(conversation.id)}
                          title={t(lang, "renameChat")}
                          className="rounded p-1 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-accent-strong)]"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDelete(conversation.id)}
                          title={t(lang, "deleteChat")}
                          className="rounded p-1 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-rose-strong)]"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
