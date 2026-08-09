import { useCallback, useEffect, useState } from "react";
import { getClipboardText, listenCapturedContext } from "../lib/tauri";
import { classifyContext } from "../lib/context";
import type { ContextKind } from "../types";

const MAX_CONTEXT_CHARS = 12_000;

export interface ClipboardContext {
  contextText: string;
  setContextText: (text: string) => void;
  clearContext: () => void;
  refresh: () => Promise<void>;
  truncated: boolean;
  kind: ContextKind;
}

export function useClipboardContext(): ClipboardContext {
  const [contextText, setContextText] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [kind, setKind] = useState<ContextKind>("empty");

  const applyContext = useCallback((value: string) => {
    const text = value.trim();
    if (text.length < 2) {
      setContextText("");
      setTruncated(false);
      setKind("empty");
      return;
    }
    setContextText(text.slice(0, MAX_CONTEXT_CHARS));
    setTruncated(text.length > MAX_CONTEXT_CHARS);
    setKind(classifyContext(text));
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
    setKind("empty");
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

  return { contextText, setContextText, clearContext, refresh, truncated, kind };
}