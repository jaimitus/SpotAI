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
  /** True while the model is emitting reasoning tokens (thinking models) and
   *  no answer content has arrived yet. The UI shows a "Thinking…" indicator. */
  thinking: boolean;
  /** Reasoning/thinking text accumulated during the run (kept out of the
   *  answer). Surfaced only when the model finishes without a real answer so
   *  the user still sees something instead of a blank response. */
  reasoning: string;
  start: (request: StreamRequest) => Promise<string>;
  stop: () => Promise<void>;
  restore: (value: string) => void;
  reset: () => void;
}

// Batch tokens to reduce React state updates and improve streaming performance
const TOKEN_BATCH_SIZE = 3;

export function useLLMStream(): UseLLMStreamResult {
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const thinkingRef = useRef(false);
  const reasoningRef = useRef("");
  const bufferRef = useRef("");
  const tokenCountRef = useRef(0);
  const statusRef = useRef<StreamStatus>("idle");
  const activeRequestRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);

  const setThinkingState = useCallback((value: boolean) => {
    thinkingRef.current = value;
    setThinking(value);
  }, []);

  // Reasoning accumulates in a ref only (no React update per token): a long
  // thinking phase can emit hundreds of reasoning tokens and must not churn
  // the renderer. The value is flushed to state once, when the run finishes,
  // because it is only ever shown as a fallback for a model that ended without
  // an answer.
  const appendReasoning = useCallback((text: string) => {
    reasoningRef.current += text;
  }, []);

  const flushBuffer = useCallback(() => {
    if (bufferRef.current) {
      setResponse(bufferRef.current);
      tokenCountRef.current = 0;
    }
  }, []);

  const applyToken = useCallback(
    (event: TokenEvent) => {
      if (event.requestId !== activeRequestRef.current) return;
      if (event.error) {
        flushBuffer();
        setThinkingState(false);
        setError(event.error);
        setStatus("error");
        statusRef.current = "error";
        return;
      }
      if (event.reasoning) {
        // Reasoning token: the model is thinking, this is NOT part of the
        // answer (reasoning is intentionally not surfaced as response text).
        setThinkingState(true);
        appendReasoning(event.reasoning);
      }
      if (event.token) {
        setThinkingState(false);
        bufferRef.current += event.token;
        tokenCountRef.current++;
        // Batch multiple tokens before triggering a React update
        if (tokenCountRef.current >= TOKEN_BATCH_SIZE) {
          flushBuffer();
        }
      }
      if (event.done) {
        setThinkingState(false);
        // Flush the accumulated reasoning exactly once, at the end of the run
        // (used by the ResponsePanel fallback when no answer was produced).
        setReasoning(reasoningRef.current);
        flushBuffer();
        setStatus("done");
        statusRef.current = "done";
      }
    },
    [flushBuffer, setThinkingState, appendReasoning],
  );

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
    tokenCountRef.current = 0;
    reasoningRef.current = "";
    setReasoning("");
    setThinkingState(false);
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
      return bufferRef.current;
    } catch (cause) {
      if (activeRequestRef.current !== requestId) return "";
      setThinkingState(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
      statusRef.current = "error";
      return "";
    }
  }, [setThinkingState]);

  const stop = useCallback(async () => {
    await cancelStream();
    setThinkingState(false);
    if (statusRef.current === "streaming") {
      setStatus("done");
      statusRef.current = "done";
    }
  }, [setThinkingState]);

  const restore = useCallback(
    (value: string) => {
      activeRequestRef.current = null;
      bufferRef.current = value;
      reasoningRef.current = "";
      setReasoning("");
      setThinkingState(false);
      setResponse(value);
      setError(null);
      const restoredStatus: StreamStatus = value ? "done" : "idle";
      setStatus(restoredStatus);
      statusRef.current = restoredStatus;
    },
    [setThinkingState],
  );

  const reset = useCallback(() => {
    activeRequestRef.current = null;
    bufferRef.current = "";
    tokenCountRef.current = 0;
    reasoningRef.current = "";
    setReasoning("");
    setThinkingState(false);
    setResponse("");
    setError(null);
    setStatus("idle");
    statusRef.current = "idle";
  }, [setThinkingState]);

  return { response, status, error, thinking, reasoning, start, stop, restore, reset };
}