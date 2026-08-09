import { Clock, History, Loader2, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../lib/i18n";
import type { HistoryEntry, Language } from "../types";
import { cn } from "../utils/cn";

interface HistoryPanelProps {
  open: boolean;
  entries: HistoryEntry[];
  lang: Language;
  onClose: () => void;
  onRestore: (entry: HistoryEntry) => void;
  onShowResponse: (entry: HistoryEntry) => void;
  onClear: () => void;
  busy?: boolean;
}

/**
 * Translucent modal overlay that lists the user's previous prompts. The
 * panel is rendered in place of the chat response so the floating window
 * never grows; if there is no history yet we show an empty state.
 *
 * Keyboard:
 *   - Esc: close
 *   - Enter: restore the highlighted entry
 *   - Shift+Enter: show the entry's response preview in the main panel
 */
export function HistoryPanel({
  open,
  entries,
  lang,
  onClose,
  onRestore,
  onShowResponse,
  onClear,
  busy,
}: HistoryPanelProps) {
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);

  const reversed = useMemo(() => entries.slice().reverse(), [entries]);
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return reversed;
    return reversed.filter(
      (entry) =>
        entry.prompt.toLowerCase().includes(needle) ||
        entry.responsePreview.toLowerCase().includes(needle) ||
        entry.model.toLowerCase().includes(needle),
    );
  }, [reversed, filter]);

  // Reset highlight whenever the visible list changes shape.
  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(filtered.length - 1, h + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Enter" && filtered[highlight]) {
        e.preventDefault();
        if (e.shiftKey) {
          onShowResponse(filtered[highlight]);
        } else {
          onRestore(filtered[highlight]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, highlight, onClose, onRestore, onShowResponse]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(lang, "historyPanelTitle")}
      className="absolute inset-0 z-30 flex flex-col rounded-xl bg-[#07090e]/95 backdrop-blur-md"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] text-zinc-200">
          <History className="h-3.5 w-3.5 text-cyan-400" />
          <span className="font-medium tracking-tight">
            {t(lang, "historyPanelTitle")}
          </span>
          <span className="text-[10px] text-zinc-500">
            ({entries.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t(lang, "historyClearConfirm"))) {
                  void onClear();
                }
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-rose-300"
              title={t(lang, "historyClearTitle")}
            >
              <Trash2 className="h-3 w-3" />
              {t(lang, "historyClearLabel")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title={t(lang, "hideTitle")}
            className="rounded-md p-1 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="border-b border-white/[0.05] px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 focus-within:border-cyan-400/40">
          <Search className="h-3 w-3 text-zinc-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t(lang, "historyFilterPlaceholder")}
            className="flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
            spellCheck={false}
          />
        </div>
      </div>

      {/* List */}
      <div className="custom-scroll min-h-0 flex-1 overflow-y-auto">
        {busy ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t(lang, "historyLoading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-zinc-500">
            <Clock className="h-6 w-6 text-zinc-600" />
            <p className="text-[12px]">
              {entries.length === 0
                ? t(lang, "historyEmpty")
                : t(lang, "historyNoMatches")}
            </p>
          </div>
        ) : (
          <ul className="space-y-1 p-2">
            {filtered.map((entry, index) => (
              <HistoryItem
                key={entry.id}
                entry={entry}
                active={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onRestore={() => onRestore(entry)}
                onShowResponse={() => onShowResponse(entry)}
                lang={lang}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer hints */}
      <div className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-zinc-500">
        <span>
          <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
            ↑↓
          </kbd>{" "}
          {t(lang, "historyNavHint")}
          <span className="mx-1.5 text-zinc-700">|</span>
          <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
            Enter
          </kbd>{" "}
          {t(lang, "historyRestoreHint")}
          <span className="mx-1.5 text-zinc-700">|</span>
          <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
            Shift+Enter
          </kbd>{" "}
          {t(lang, "historyShowResponseHint")}
          <span className="mx-1.5 text-zinc-700">|</span>
          <kbd className="rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 font-mono">
            Esc
          </kbd>{" "}
          {t(lang, "historyCloseHint")}
        </span>
      </div>
    </div>
  );
}

interface HistoryItemProps {
  entry: HistoryEntry;
  active: boolean;
  lang: Language;
  onRestore: () => void;
  onShowResponse: () => void;
  onMouseEnter: () => void;
}

function HistoryItem({
  entry,
  active,
  onRestore,
  onShowResponse,
  onMouseEnter,
  lang: _lang,
}: HistoryItemProps) {
  const time = useMemo(() => formatTimestamp(entry.timestamp), [entry.timestamp]);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onMouseEnter={onMouseEnter}
        onClick={onRestore}
        className={cn(
          "group cursor-pointer rounded-lg border px-3 py-2 transition-all",
          active
            ? "border-cyan-400/40 bg-cyan-400/10"
            : "border-transparent hover:border-white/10 hover:bg-white/[0.04]",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[12px] leading-snug text-zinc-200">
              {entry.prompt}
            </p>
            {entry.responsePreview && (
              <p className="mt-1 line-clamp-1 text-[11px] text-zinc-500">
                {entry.responsePreview}
              </p>
            )}
            <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
              <span>{time}</span>
              <span className="text-zinc-700">•</span>
              <span className="truncate">{entry.model}</span>
              {entry.contextPreview && (
                <>
                  <span className="text-zinc-700">•</span>
                  <span className="truncate italic">
                    ctx: {entry.contextPreview}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRestore();
              }}
              className="rounded-md p-1 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-cyan-300"
              title="Restore prompt"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowResponse();
              }}
              className="rounded-md p-1 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-amber-300"
              title="Show response preview"
            >
              <span className="text-[10px] font-mono">⇧↵</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function formatTimestamp(ms: number): string {
  if (!ms) return "";
  const date = new Date(ms);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) return time;
  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${time}`;
}
