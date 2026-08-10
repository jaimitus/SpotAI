import { useCallback, useEffect, useState } from "react";
import { getClipboardText, listenCapturedContext } from "../lib/tauri";
import { classifyContext } from "../lib/context";
import type { ContextKind } from "../types";

const MAX_CONTEXT_CHARS = 12_000;

export interface ClipboardContext {
  contextText: string;
  setContextText: (text: string) => void;
  /** Replaces the context with manually pasted/typed text (updates the
   *  capture timestamp like a clipboard capture would). */
  setManualContext: (text: string) => void;
  clearContext: () => void;
  /** Re-reads the clipboard. Resolves `true` when the read succeeded (even if
   *  the clipboard was empty), `false` when access was denied/unavailable. */
  refresh: () => Promise<boolean>;
  /** Timestamp (ms) of the last capture, or `null` when nothing is captured. */
  capturedAt: number | null;
  truncated: boolean;
  kind: ContextKind;
}

export function useClipboardContext(): ClipboardContext {
  const [contextText, setContextText] = useState("");
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [kind, setKind] = useState<ContextKind>("empty");

  const applyContext = useCallback((value: string) => {
    const text = value.trim();
    if (text.length < 2) {
      setContextText("");
      setCapturedAt(null);
      setTruncated(false);
      setKind("empty");
      return;
    }
    setContextText(text.slice(0, MAX_CONTEXT_CHARS));
    setCapturedAt(Date.now());
    setTruncated(text.length > MAX_CONTEXT_CHARS);
    setKind(classifyContext(text));
  }, []);

  const setManualContext = useCallback(
    (text: string) => applyContext(text),
    [applyContext],
  );

  const refresh = useCallback(async () => {
    try {
      applyContext(await getClipboardText());
      return true;
    } catch {
      // Clipboard access can be temporarily unavailable while another app owns it.
      return false;
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

  return {
    contextText,
    setContextText,
    setManualContext,
    clearContext,
    refresh,
    capturedAt,
    truncated,
    kind,
  };
}