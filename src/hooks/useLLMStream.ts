import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelStream,
  listenTokenEvents,
  sendPromptStream,
} from "../lib/tauri";
import type { PromptRequest, StreamStatus, TokenEvent } from "../types";

type StreamRequest = Omit<PromptRequest, "requestId">;

export interface UseLLMStreamResult {
  response: string;
  status: StreamStatus;
  error: string | null;
  start: (request: StreamRequest) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
}

export function useLLMStream(): UseLLMStreamResult {
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const bufferRef = useRef("");
  const statusRef = useRef<StreamStatus>("idle");
  const activeRequestRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);

  const applyToken = useCallback((event: TokenEvent) => {
    if (event.requestId !== activeRequestRef.current) return;
    if (event.error) {
      setError(event.error);
      setStatus("error");
      statusRef.current = "error";
      return;
    }
    if (event.token) {
      bufferRef.current += event.token;
      setResponse(bufferRef.current);
    }
    if (event.done) {
      setStatus("done");
      statusRef.current = "done";
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    void listenTokenEvents((event) => {
      if (mounted) applyToken(event);
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [applyToken]);

  const start = useCallback(async (request: StreamRequest) => {
    const requestId = `${Date.now()}-${++sequenceRef.current}`;
    activeRequestRef.current = requestId;
    bufferRef.current = "";
    setResponse("");
    setError(null);
    setStatus("streaming");
    statusRef.current = "streaming";

    try {
      await sendPromptStream({ ...request, requestId });
      if (
        activeRequestRef.current === requestId &&
        statusRef.current === "streaming"
      ) {
        setStatus("done");
        statusRef.current = "done";
      }
    } catch (cause) {
      if (activeRequestRef.current !== requestId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
      statusRef.current = "error";
    }
  }, []);

  const stop = useCallback(async () => {
    await cancelStream();
    if (statusRef.current === "streaming") {
      setStatus("done");
      statusRef.current = "done";
    }
  }, []);

  const reset = useCallback(() => {
    activeRequestRef.current = null;
    bufferRef.current = "";
    setResponse("");
    setError(null);
    setStatus("idle");
    statusRef.current = "idle";
  }, []);

  return { response, status, error, start, stop, reset };
}