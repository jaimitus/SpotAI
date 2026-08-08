import {
  Check,
  ClipboardCopy,
  CornerDownLeft,
  Loader2,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { autoInsertText, isTauri, setClipboardText } from "../lib/tauri";
import type { StreamStatus } from "../types";
import { cn } from "../utils/cn";

interface ResponsePanelProps {
  response: string;
  status: StreamStatus;
  error: string | null;
  onStop: () => void;
  onClear: () => void;
}

export function ResponsePanel({
  response,
  status,
  error,
  onStop,
  onClear,
}: ResponsePanelProps) {
  const [copied, setCopied] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "streaming") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [response, status]);

  if (status === "idle" && !response && !error) {
    return null;
  }

  const handleCopy = async () => {
    await setClipboardText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleAutoInsert = async () => {
    setInsertError(null);
    try {
      await autoInsertText(response);
    } catch (cause) {
      setInsertError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleBottomResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri()) return;

    try {
      void getCurrentWindow().startResizing("South");
    } catch {
      //
    }

    const startY = e.clientY;
    const initialHeight = window.innerHeight;
    const initialWidth = window.innerWidth;
    const appWindow = getCurrentWindow();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(260, Math.min(1400, initialHeight + deltaY));
      void appWindow.setSize(new LogicalSize(initialWidth, newHeight));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleCornerResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri()) return;

    try {
      void getCurrentWindow().startResizing("SouthEast");
    } catch {
      //
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidth = window.innerWidth;
    const initialHeight = window.innerHeight;
    const appWindow = getCurrentWindow();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const newWidth = Math.max(460, Math.min(1400, initialWidth + deltaX));
      const newHeight = Math.max(260, Math.min(1400, initialHeight + deltaY));
      void appWindow.setSize(new LogicalSize(newWidth, newHeight));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.07]",
        "bg-[#07090e]/80 backdrop-blur-sm",
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {status === "streaming" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
              <span className="text-cyan-300/80">Streaming</span>
              <span className="inline-flex gap-0.5">
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400 [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400 [animation-delay:300ms]" />
              </span>
            </>
          ) : status === "error" ? (
            <span className="text-rose-400">Error</span>
          ) : status === "done" ? (
            <span className="text-emerald-400/80">Done</span>
          ) : (
            <span>Response</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {status === "streaming" && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          )}
          {response && (
            <>
              {status !== "streaming" && (
                <button
                  type="button"
                  onClick={() => void handleAutoInsert()}
                  title="Paste the response into the previously focused application"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
                >
                  <CornerDownLeft className="h-3 w-3" />
                  Auto-Insert
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </button>
            </>
          )}
          {(response || error) && status !== "streaming" && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        className="custom-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {error && (
          <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">
            {error}
          </div>
        )}
        {insertError && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            Auto-Insert failed: {insertError}. The response remains on the clipboard.
          </div>
        )}

        {response ? (
          <div className="markdown-body text-[13px] leading-relaxed text-zinc-200">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                code({ className, children, ...props }) {
                  const isBlock = /language-/.test(className || "");
                  if (!isBlock) {
                    return (
                      <code
                        className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12px] text-cyan-200"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                pre({ children }) {
                  return (
                    <pre className="my-2 overflow-x-auto rounded-lg border border-white/10 bg-[#0a0c12] p-3 text-[12px] leading-relaxed">
                      {children}
                    </pre>
                  );
                },
                a({ href, children }) {
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 underline decoration-cyan-400/30 underline-offset-2 hover:decoration-cyan-400"
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {response}
            </ReactMarkdown>
            {status === "streaming" && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-cyan-400/80 align-middle" />
            )}
          </div>
        ) : status === "streaming" ? (
          <div className="flex items-center gap-2 text-[12px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            Waiting for the first token...
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {/* Bottom resize handle bar (generous 20px hit area) */}
      <div
        onMouseDown={handleBottomResize}
        className="flex h-5 w-full cursor-s-resize items-center justify-center border-t border-white/[0.08] bg-white/[0.03] hover:bg-cyan-500/15 transition-all group select-none relative shrink-0"
        title="Drag anywhere here to resize window height"
      >
        <div className="flex items-center gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
          <div className="h-1 w-12 rounded-full bg-zinc-500 group-hover:bg-cyan-400 group-hover:scale-x-110 transition-all shadow-sm" />
        </div>
        
        {/* Generous 32x32px corner hit zone */}
        <div
          onMouseDown={handleCornerResize}
          className="absolute right-0 bottom-0 w-8 h-8 flex items-center justify-center cursor-se-resize text-zinc-400 hover:text-cyan-300 hover:bg-cyan-400/20 rounded-tl transition-all z-20"
          title="Drag corner to resize window width & height"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" className="translate-x-0.5 translate-y-0.5">
            <path d="M8 2L2 8M9 5L5 9M9 8.5L8.5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </div>
  );
}
