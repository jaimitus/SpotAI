import { FileText, X, Upload, Search, Database, Trash2 } from "lucide-react";
import { useState, useCallback, DragEvent } from "react";
import { isSupportedFile, ragGetStats, ragIndexFiles, ragQuery, ragRemoveDocument, type RagStats, type RagSearchResult } from "../lib/tauri";
import { t } from "../lib/i18n";

interface RagPanelProps {
  onQueryResults: (results: RagSearchResult[], query: string) => void;
  onClose: () => void;
}

export function RagPanel({ onQueryResults, onClose }: RagPanelProps) {
  const [stats, setStats] = useState<RagStats | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load stats on mount
  useState(() => {
    ragGetStats().then(setStats).catch(console.error);
  });

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

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const supportedFiles = files.filter(f => isSupportedFile(f.name));

    if (supportedFiles.length === 0) {
      setError(t("rag.unsupportedFiles"));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const filePaths = supportedFiles.map(f => f.path || f.name);
      const result = await ragIndexFiles(filePaths);
      
      // Refresh stats
      const newStats = await ragGetStats();
      setStats(newStats);

      console.log(`Indexed ${Object.keys(result).length} files`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rag.indexError"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleQuery = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await ragQuery(query.trim(), 5);
      onQueryResults(result.results, result.query);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rag.queryError"));
    } finally {
      setIsLoading(false);
    }
  }, [query, onQueryResults]);

  const handleRemoveDocument = useCallback(async (docPath: string) => {
    try {
      await ragRemoveDocument(docPath);
      const newStats = await ragGetStats();
      setStats(newStats);
    } catch (err) {
      console.error("Failed to remove document:", err);
    }
  }, []);

  return (
    <div className="rag-panel" style={{ 
      padding: "16px",
      backgroundColor: "var(--background)",
      borderRadius: "8px",
      border: "1px solid var(--border)",
    }}>
      {/* Header */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: "16px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Database size={20} />
          <h3 style={{ margin: 0, fontSize: "16px" }}>{t("rag.title")}</h3>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px",
            color: "var(--foreground)",
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{
          display: "flex",
          gap: "16px",
          marginBottom: "16px",
          padding: "8px",
          backgroundColor: "var(--muted)",
          borderRadius: "4px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <FileText size={16} />
            <span style={{ fontSize: "13px" }}>
              {stats.documentCount} {t("rag.documents")}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Database size={16} />
            <span style={{ fontSize: "13px" }}>
              {stats.chunkCount} {t("rag.chunks")}
            </span>
          </div>
        </div>
      )}

      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDragging ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "8px",
          padding: "24px",
          textAlign: "center",
          backgroundColor: isDragging ? "var(--accent)/10" : "transparent",
          transition: "all 0.2s",
          marginBottom: "16px",
        }}
      >
        <Upload size={32} style={{ marginBottom: "8px", opacity: 0.7 }} />
        <p style={{ margin: "0 0 4px", fontSize: "14px" }}>
          {t("rag.dropFiles")}
        </p>
        <p style={{ margin: 0, fontSize: "12px", opacity: 0.7 }}>
          {t("rag.supportedFormats")}
        </p>
      </div>

      {/* Query Form */}
      <form onSubmit={handleQuery} style={{ marginBottom: "16px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("rag.queryPlaceholder")}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--input)",
              color: "var(--foreground)",
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: "4px",
              border: "none",
              backgroundColor: isLoading ? "var(--muted)" : "var(--accent)",
              color: isLoading ? "var(--muted-foreground)" : "var(--accent-foreground)",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {isLoading ? <Upload size={16} className="animate-spin" /> : <Search size={16} />}
            {t("rag.search")}
          </button>
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: "8px 12px",
          backgroundColor: "var(--destructive)/10",
          border: "1px solid var(--destructive)",
          borderRadius: "4px",
          color: "var(--destructive)",
          fontSize: "13px",
          marginBottom: "16px",
        }}>
          {error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "13px",
          opacity: 0.7,
        }}>
          <Upload size={16} className="animate-spin" />
          {t("rag.processing")}
        </div>
      )}

      {/* Info */}
      <div style={{
        fontSize: "11px",
        opacity: 0.7,
        marginTop: "16px",
        paddingTop: "16px",
        borderTop: "1px solid var(--border)",
      }}>
        {t("rag.info")}
      </div>
    </div>
  );
}
