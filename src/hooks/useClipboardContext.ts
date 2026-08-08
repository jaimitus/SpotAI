import { useCallback, useEffect, useState } from "react";
import { getClipboardText, listenCapturedContext } from "../lib/tauri";

const MAX_CONTEXT_CHARS = 12_000;

export interface ClipboardContext {
  contextText: string;
  setContextText: (text: string) => void;
  clearContext: () => void;
  refresh: () => Promise<void>;
  truncated: boolean;
}

export function useClipboardContext(): ClipboardContext {
  const [contextText, setContextText] = useState("");
  const [truncated, setTruncated] = useState(false);

  const applyContext = useCallback((value: string) => {
    const text = value.trim();
    if (text.length < 2) return;
    setContextText(text.slice(0, MAX_CONTEXT_CHARS));
    setTruncated(text.length > MAX_CONTEXT_CHARS);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyContext(await getClipboardText());
    } catch {
      // Clipboard access can be temporarily unavailable while another app owns it.
    }
  }, [applyContext]);

  const clearContext = useCallback(() => {
    setContextText("");
    setTruncated(false);
  }, []);

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let mounted = true;
    void listenCapturedContext(applyContext).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [applyContext, refresh]);

  return { contextText, setContextText, clearContext, refresh, truncated };
}