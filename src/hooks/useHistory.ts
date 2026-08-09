import { useCallback, useEffect, useState } from "react";
import { addHistoryEntry, clearHistory, isTauri, listHistory } from "../lib/tauri";
import type { HistoryEntry } from "../types";

interface UseHistoryResult {
  entries: HistoryEntry[];
  ready: boolean;
  add: (entry: Omit<HistoryEntry, "id" | "timestamp">) => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Loads the prompt history once on mount and exposes helpers to append a
 * new entry or clear the entire log. The hook is intentionally simple: we
 * mirror the backend's order (newest last) so consumers can render the
 * list with `entries.slice().reverse()` without surprises.
 */
export function useHistory(): UseHistoryResult {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    listHistory()
      .then((snapshot) => {
        if (cancelled) return;
        setEntries(snapshot.entries ?? []);
        setReady(true);
      })
      .catch((cause) => {
        // Non-fatal: the user can still send prompts even if the history
        // store is unreachable.
        // eslint-disable-next-line no-console
        console.warn("[spotai] failed to load history", cause);
        if (cancelled) return;
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback(
    async (entry: Omit<HistoryEntry, "id" | "timestamp">) => {
      if (!isTauri()) {
        // In web/dev mode we still keep the in-memory list so the UI
        // behaves consistently, but we never try to persist it.
        const local: HistoryEntry = {
          id: `local-${Date.now()}`,
          timestamp: Date.now(),
          ...entry,
        };
        setEntries((current) => [...current, local]);
        return;
      }
      try {
        const stored = await addHistoryEntry({
          id: makeId(),
          timestamp: Date.now(),
          ...entry,
        });
        setEntries((current) => [...current, stored]);
      } catch (cause) {
        // eslint-disable-next-line no-console
        console.warn("[spotai] failed to persist history entry", cause);
      }
    },
    [],
  );

  const clear = useCallback(async () => {
    if (isTauri()) {
      try {
        await clearHistory();
      } catch (cause) {
        // eslint-disable-next-line no-console
        console.warn("[spotai] failed to clear history", cause);
      }
    }
    setEntries([]);
  }, []);

  return { entries, ready, add, clear };
}

function makeId(): string {
  // `crypto.randomUUID` is available in modern WebViews and Tauri uses a
  // recent enough Chromium / WebKit. Fall back to a time-based id if the
  // runtime does not expose it.
  const cryptoObj = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
