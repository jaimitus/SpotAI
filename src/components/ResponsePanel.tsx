import {
  Check,
  ClipboardCopy,
  CornerDownLeft,
  Download,
  Loader2,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Square,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import {
  autoInsertText,
  downloadTextFile,
  exportTextToFile,
  isTauri,
  pickSavePath,
  setClipboardText,
} from "../lib/tauri";
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
  onTogglePin: (id: string) => void;
}

interface ResponsePanelProps {
  messages: ChatMessage[];
  current: string;
  status: StreamStatus;
  error: string | null;
  lang?: Language;
  model?: string;
  chatTitle?: string;
  onStop: () => void;
  onNewChat: () => void;
  onAutoInsertSuccess?: () => void;
  onRegenerate?: () => void;
  onEditPrompt?: (content: string) => void;
  chats?: ChatsMenuData;
}

/** Rough token estimate (English ≈ 4 chars/token) for the response footer. */
function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

function shortModel(model: string): string {
  return model.includes(":")
    ? model.split(":")[0]
    : model.replace(/-latest$/, "");
}

function buildMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [
    `# ${title || "SpotAI conversation"}`,
    "",
    `_Exported ${new Date().toISOString()}_`,
    "",
  ];
  for (const message of messages) {
    lines.push(
      message.role === "user" ? "## 👤 User" : "## 🤖 Assistant",
      "",
      message.content,
      "",
    );
  }
  return lines.join("\n");
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

const SPEECH_LANGS: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  de: "de-DE",
  pt: "pt-PT",
  fr: "fr-FR",
};

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
  const [speaking, setSpeaking] = useState(false);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const handleCopy = async () => {
    await setClipboardText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const toggleSpeech = () => {
    if (!ttsSupported) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = SPEECH_LANGS[lang] ?? "en-US";
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    // Any previously queued speech is dropped so only this reply is read.
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  return (
    <div className="group/msg relative">
      {!streaming && (
        <div className="absolute right-0 top-0 z-10 flex items-center gap-1">
          {ttsSupported && content.trim() && (
            <button
              type="button"
              onClick={toggleSpeech}
              title={t(lang, speaking ? "stopSpeaking" : "readAloud")}
              aria-label={t(lang, speaking ? "stopSpeaking" : "readAloud")}
              className="rounded-md border border-[var(--pe-code-border)] bg-[#0c0e14]/90 p-1.5 text-[var(--pe-text-muted)] opacity-0 shadow-lg transition hover:text-cyan-300 focus-visible:opacity-100 group-hover/msg:opacity-100"
            >
              <Volume2
                className={cn(
                  "h-3 w-3",
                  speaking && "animate-pulse text-[var(--pe-accent-strong)]",
                )}
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            title={t(lang, "copy")}
            aria-label={t(lang, "copy")}
            className="rounded-md border border-[var(--pe-code-border)] bg-[#0c0e14]/90 p-1.5 text-[var(--pe-text-muted)] opacity-0 shadow-lg transition hover:text-cyan-300 focus-visible:opacity-100 group-hover/msg:opacity-100"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[var(--pe-emerald-strong)]" />
            ) : (
              <ClipboardCopy className="h-3 w-3" />
            )}
          </button>
        </div>
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
  model,
  chatTitle,
  onStop,
  onNewChat,
  onAutoInsertSuccess,
  onRegenerate,
  onEditPrompt,
  chats,
}: ResponsePanelProps) {
  const [insertError, setInsertError] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
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

  const handleExport = async () => {
    setExportMsg(null);
    try {
      const markdown = buildMarkdown(chatTitle || "", messages);
      if (isTauri()) {
        const path = await pickSavePath("spotai-chat.md");
        if (!path) return;
        await exportTextToFile(path, markdown);
      } else {
        downloadTextFile("spotai-chat.md", markdown);
      }
      setExportMsg(t(lang, "chatExported"));
    } catch (cause) {
      setExportMsg(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const lastMessage = messages[messages.length - 1];
  const canRegenerate =
    Boolean(onRegenerate) &&
    status !== "streaming" &&
    lastMessage?.role === "assistant";
  const lastAssistant =
    lastMessage?.role === "assistant" ? lastMessage.content : lastAssistantContent;
  const tokenCount =
    status === "done" && current
      ? estimateTokens(current)
      : lastAssistant
        ? estimateTokens(lastAssistant)
        : 0;
  // Once a completed reply is appended to `messages`, the transient `current`
  // buffer mirrors it — skip it so the answer is not rendered twice.
  const showTransient =
    Boolean(current || status !== "idle") &&
    !(
      current &&
      lastMessage?.role === "assistant" &&
      current === lastMessage.content
    );

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
          {tokenCount > 0 && status === "done" && (
            <span className="text-[var(--pe-text-faint)]">
              · ≈{tokenCount.toLocaleString()} {t(lang, "tokens")}
              {model ? ` · ${shortModel(model)}` : ""}
            </span>
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
          {canRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              title={t(lang, "regenerate")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
            >
              <RefreshCw className="h-3 w-3" />
              {t(lang, "regenerate")}
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => void handleExport()}
              title={t(lang, "exportChat")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--pe-text-soft)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
            >
              <Download className="h-3 w-3" />
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
              onTogglePin={chats.onTogglePin}
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
        {exportMsg && (
          <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-[12px] text-[var(--pe-accent-strong)]">
            {exportMsg}
          </div>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="group/msg flex justify-end">
              <div className="relative max-w-[85%]">
                {onEditPrompt && (
                  <button
                    type="button"
                    onClick={() => onEditPrompt(message.content)}
                    title={t(lang, "editPrompt")}
                    aria-label={t(lang, "editPrompt")}
                    className="absolute -left-8 top-1 z-10 rounded-md border border-[var(--pe-code-border)] bg-[var(--pe-bg-2)] p-1.5 text-[var(--pe-text-muted)] opacity-0 shadow-lg transition hover:text-[var(--pe-accent-strong)] focus-visible:opacity-100 group-hover/msg:opacity-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                <div className="whitespace-pre-wrap rounded-xl rounded-tr-sm border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-[12px] leading-relaxed text-[var(--pe-accent-strong)]">
                  {message.content}
                </div>
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

        {showTransient && (
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
