import {
  Check,
  ClipboardCopy,
  CornerDownLeft,
  Loader2,
  MessageSquarePlus,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { autoInsertText, setClipboardText } from "../lib/tauri";
import { t } from "../lib/i18n";
import type { ChatMessage, Conversation, Language, StreamStatus } from "../types";
import { cn } from "../utils/cn";
import { ChatsMenu } from "./ChatsMenu";

export interface ChatsMenuData {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

interface ResponsePanelProps {
  messages: ChatMessage[];
  current: string;
  status: StreamStatus;
  error: string | null;
  lang?: Language;
  onStop: () => void;
  onNewChat: () => void;
  onAutoInsertSuccess?: () => void;
  chats?: ChatsMenuData;
}

function CodeBlock({ children, lang }: { children: React.ReactNode; lang?: Language }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? "";
    await setClipboardText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group/pre relative">
      <button
        type="button"
        onClick={() => void handleCopy()}
        title={t(lang, "copyCodeBlock")}
        aria-label={t(lang, "copyCodeBlock")}
        className="absolute right-2 top-2 rounded-md border border-[var(--pe-code-border)] bg-[#0c0e14]/90 p-1.5 text-[var(--pe-text-soft)] opacity-0 shadow-lg transition hover:text-cyan-300 focus-visible:opacity-100 group-hover/pre:opacity-100"
      >
        {copied ? (
          <Check className="h-3 w-3 text-[var(--pe-emerald-strong)]" />
        ) : (
          <ClipboardCopy className="h-3 w-3" />
        )}
      </button>
      <pre
        ref={preRef}
        className="my-2 overflow-x-auto rounded-lg border border-[var(--pe-code-border)] bg-[#0a0c12] p-3 text-[12px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

function Markdown({
  content,
  lang,
  streaming,
}: {
  content: string;
  lang: Language;
  streaming?: boolean;
}) {
  return (
    <div className="markdown-body text-[13px] leading-relaxed text-[var(--pe-text)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const isBlock = /language-/.test(className || "");
            if (!isBlock) {
              return (
                <code
                  className="rounded bg-[var(--pe-code-inline)] px-1 py-0.5 font-mono text-[12px] text-[var(--pe-accent-strong)]"
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
            return <CodeBlock lang={lang}>{children}</CodeBlock>;
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
        {content}
      </ReactMarkdown>
      {streaming && (
        <span className="pe-caret ml-0.5 inline-block h-3.5 w-1.5 bg-cyan-400/80 align-middle" />
      )}
    </div>
  );
}

function AssistantMessage({
  content,
  streaming,
  lang,
}: {
  content: string;
  streaming?: boolean;
  lang: Language;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await setClipboardText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group/msg relative">
      {!streaming && (
        <button
          type="button"
          onClick={() => void handleCopy()}
          title={t(lang, "copy")}
          aria-label={t(lang, "copy")}
          className="absolute right-0 top-0 z-10 rounded-md border border-[var(--pe-code-border)] bg-[#0c0e14]/90 p-1.5 text-[var(--pe-text-muted)] opacity-0 shadow-lg transition hover:text-cyan-300 focus-visible:opacity-100 group-hover/msg:opacity-100"
        >
          {copied ? (
            <Check className="h-3 w-3 text-[var(--pe-emerald-strong)]" />
          ) : (
            <ClipboardCopy className="h-3 w-3" />
          )}
        </button>
      )}
      <Markdown content={content} lang={lang} streaming={streaming} />
    </div>
  );
}

export function ResponsePanel({
  messages,
  current,
  status,
  error,
  lang = "en",
  onStop,
  onNewChat,
  onAutoInsertSuccess,
  chats,
}: ResponsePanelProps) {
  const [insertError, setInsertError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [current, status, messages.length]);

  const lastAssistantContent = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return "";
  }, [messages]);

  const insertTarget =
    status === "done" && current ? current : lastAssistantContent;
  const canAutoInsert = status !== "streaming" && Boolean(insertTarget);
  const showPanel = messages.length > 0 || status !== "idle" || Boolean(error);
  if (!showPanel) return null;

  const handleAutoInsert = async () => {
    setInsertError(null);
    try {
      await autoInsertText(insertTarget);
      onAutoInsertSuccess?.();
    } catch (cause) {
      setInsertError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--pe-border-soft)]",
        "bg-[var(--pe-bg-3)] backdrop-blur-sm",
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--pe-border-soft)] px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] text-[var(--pe-text-muted)]">
          {status === "streaming" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
              <span className="text-[var(--pe-accent-strong)]">{t(lang, "streaming")}</span>
              <span className="inline-flex gap-0.5">
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400 [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400 [animation-delay:300ms]" />
              </span>
            </>
          ) : status === "error" ? (
            <span className="text-[var(--pe-rose-strong)]">{t(lang, "error")}</span>
          ) : status === "done" ? (
            <span className="text-[var(--pe-emerald-strong)]">{t(lang, "done")}</span>
          ) : (
            <span>{t(lang, "response")}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {status === "streaming" && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
            >
              <Square className="h-3 w-3 fill-current" />
              {t(lang, "stop")}
            </button>
          )}
          {canAutoInsert && (
            <button
              type="button"
              onClick={() => void handleAutoInsert()}
              title={t(lang, "pasteIntoFocusedApp")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
            >
              <CornerDownLeft className="h-3 w-3" />
              {t(lang, "autoInsert")}
            </button>
          )}
          {chats && (
            <ChatsMenu
              conversations={chats.conversations}
              activeId={chats.activeId}
              lang={lang}
              onSelect={chats.onSelect}
              onRename={chats.onRename}
              onDelete={chats.onDelete}
              onNewChat={onNewChat}
            />
          )}
          {(messages.length > 0 || status !== "idle") && (
            <button
              type="button"
              onClick={onNewChat}
              title={t(lang, "newChat")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
            >
              <MessageSquarePlus className="h-3 w-3" />
              {t(lang, "newChat")}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="custom-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-[var(--pe-rose-strong)]">
            {error}
          </div>
        )}
        {insertError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-[var(--pe-amber-strong)]">
            {t(lang, "autoInsertFailed")}: {insertError}. {t(lang, "remainsOnClipboard")}
          </div>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[12px] leading-relaxed text-[var(--pe-accent-strong)]">
                {message.content}
              </div>
            </div>
          ) : (
            <div key={index} className="flex">
              <div className="min-w-0 flex-1">
                <AssistantMessage content={message.content} lang={lang} />
              </div>
            </div>
          ),
        )}

        {(current || status !== "idle") && (
          <div className="flex">
            <div className="min-w-0 flex-1">
              {current ? (
                <AssistantMessage
                  content={current}
                  streaming={status === "streaming"}
                  lang={lang}
                />
              ) : status === "streaming" ? (
                <div className="flex items-center gap-2 text-[12px] text-[var(--pe-text-muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                  {t(lang, "waitingToken")}
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
