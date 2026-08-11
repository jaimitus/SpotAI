import { Database, FileText, Search, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { t } from "../lib/i18n";
import type { Language } from "../types";
import {
  isSupportedFile,
  listenDragDrop,
  ragGetStats,
  ragIndexFiles,
  ragQuery,
  ragRemoveDocument,
  type RagSearchResult,
  type RagStats,
} from "../lib/tauri";

interface RagPanelProps {
  lang: Language;
  onClose: () => void;
}

export function RagPanel({ lang, onClose }: RagPanelProps) {
  const [stats, setStats] = useState<RagStats | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState<{current: number; total: number; fileName: string} | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RagSearchResult[]>([]);
  const [lastQuery, setLastQuery] = useState("");

  const loadStats = useCallback(() => {
    void ragGetStats()
      .then(setStats)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  /** Indexes the given file paths (Tauri absolute paths or plain names). */
  const indexPaths = useCallback(
    async (paths: string[]) => {
      const supported = paths.filter((p) => isSupportedFile(p.split(/[\\/]/).pop() ?? p));
      if (supported.length === 0) {
        setError(t(lang, "ragUnsupportedFiles"));
        return;
      }
      setIsLoading(true);
      setIndexingProgress({ current: 0, total: supported.length, fileName: t(lang, "ragAnalyzingStructure") });
      setError(null);
      try {
        for (let i = 0; i < supported.length; i++) {
          setIndexingProgress({ current: i, total: supported.length, fileName: supported[i].split(/[\\/]/).pop() ?? supported[i] });
          await ragIndexFiles([supported[i]]);
        }
        setIndexingProgress({ current: supported.length, total: supported.length, fileName: t(lang, "ragReady") });
        setResults([]);
        loadStats();
        setTimeout(() => setIndexingProgress(null), 1500);
      } catch (err) {
        setIndexingProgress(null);
        setError(err instanceof Error ? err.message : t(lang, "ragIndexError"));
      } finally {
        setIsLoading(false);
      }
    },
    [lang, loadStats],
  );

  // Browser-mode fallback: HTML5 drag & drop. Inside the desktop app Tauri's
  // `dragDropEnabled` (default) intercepts file drops at the OS/window level
  // and delivers them through onDragDropEvent below — the HTML5 drop event
  // never carries the files there.
  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const names = Array.from(e.dataTransfer.files).map((f) => f.name);
      if (names.length > 0) await indexPaths(names);
    },
    [indexPaths],
  );

  // Native Tauri drag & drop: subscribe to the window-level drop events, which
  // carry the real file paths, and drive the same highlight state as HTML5.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    void listenDragDrop((event) => {
      if (!mounted) return;
      if (event.type === "enter" || event.type === "over") {
        setIsDragging(true);
      } else if (event.type === "leave") {
        setIsDragging(false);
      } else {
        setIsDragging(false);
        // A cancelled drop can carry no paths; treat it like a leave.
        if (event.paths.length > 0) void indexPaths(event.paths);
      }
    }).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [indexPaths]);

  const handleQuery = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!query.trim()) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await ragQuery(query.trim(), 5);
        setResults(result.results);
        setLastQuery(result.query);
      } catch (err) {
        setError(err instanceof Error ? err.message : t(lang, "ragQueryError"));
      } finally {
        setIsLoading(false);
      }
    },
    [query, lang],
  );

  const handleRemoveDocument = useCallback(
    async (docPath: string) => {
      try {
        await ragRemoveDocument(docPath);
        setResults((current) => current.filter((r) => r.documentPath !== docPath));
        loadStats();
      } catch {
        // Keep the row; the failure is non-critical.
      }
    },
    [loadStats],
  );

  return (
    <div className="flex flex-col gap-3 border-b border-[var(--pe-border-faint)] bg-[var(--pe-bg-2)] px-3 py-2.5 pe-pop">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--pe-violet-strong)]">
          <Database className="h-3.5 w-3.5" />
          {t(lang, "ragTitle")}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--pe-text-faint)]">
          {stats && (
            <span>
              {stats.documentCount} {t(lang, "ragDocuments")} · {stats.chunkCount}{" "}
              {t(lang, "ragChunks")}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            title={t(lang, "dismiss")}
            className="rounded-md p-1 text-[var(--pe-text-muted)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-text)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Drop zone */}
      <div
        data-testid="rag-drop-zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-4 text-center transition ${
          isDragging
            ? "border-[var(--pe-violet-strong)] bg-violet-400/10"
            : indexingProgress
              ? "border-emerald-400/50 bg-emerald-400/10"
              : "border-[var(--pe-border)] bg-[var(--pe-input)]"
        }`}
      >
        {indexingProgress ? (
          <>
            <Upload className="h-5 w-5 animate-pulse text-emerald-400" />
            <div className="text-[11px] font-medium text-emerald-400">
              {t(lang, "ragIndexing")} {indexingProgress.current}/{indexingProgress.total}
            </div>
            <div className="text-[10px] text-emerald-400/80 truncate max-w-full">
              {indexingProgress.fileName}
            </div>
          </>
        ) : (
          <>
            <Upload className={`h-5 w-5 ${isDragging ? "text-[var(--pe-violet-strong)]" : "text-[var(--pe-text-muted)]"}`} />
            <div className="text-[11px] text-[var(--pe-text-soft)]">{t(lang, "ragDropFiles")}</div>
            <div className="text-[10px] text-[var(--pe-text-faint)]">{t(lang, "ragSupportedFormats")}</div>
          </>
        )}
      </div>

      {/* Query form */}
      <form onSubmit={handleQuery} className="flex items-center gap-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "ragQueryPlaceholder")}
          disabled={isLoading}
          className="min-w-0 flex-1 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-input)] px-2.5 py-1.5 text-[11px] text-[var(--pe-text)] outline-none transition placeholder:text-[var(--pe-text-faint)] focus:border-violet-400/40 focus:ring-1 focus:ring-violet-400/20"
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-500/90 px-2.5 py-1.5 text-[11px] font-medium text-zinc-950 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Upload className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          {t(lang, "ragSearch")}
        </button>
        {isLoading && (
          <span className="shrink-0 text-[10px] text-[var(--pe-text-faint)]">
            {t(lang, "ragProcessing")}
          </span>
        )}
      </form>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1.5 text-[11px] text-[var(--pe-rose-strong)]">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--pe-text-faint)]">
            {lastQuery} · {results.length} {t(lang, "ragChunks")}
          </div>
          {results.map((result) => (
            <div
              key={result.chunkId}
              className="rounded-lg border border-[var(--pe-border-soft)] bg-[var(--pe-input)] px-2.5 py-2"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-[var(--pe-violet-strong)]">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate" title={result.documentPath}>
                    {result.documentPath.split(/[\\/]/).pop()}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[10px] text-[var(--pe-emerald-strong)]">
                    {Math.round(result.similarity * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveDocument(result.documentPath)}
                    title={t(lang, "deleteChat")}
                    className="rounded p-0.5 text-[var(--pe-text-faint)] transition hover:bg-[var(--pe-hover)] hover:text-[var(--pe-rose-strong)]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </div>
              <div className="custom-scroll max-h-24 overflow-y-auto whitespace-pre-wrap break-words pr-1 font-mono text-[10px] leading-relaxed text-[var(--pe-text-soft)]">
                {result.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="text-[10px] leading-relaxed text-[var(--pe-text-faint)]">{t(lang, "ragInfo")}</div>
    </div>
  );
}
