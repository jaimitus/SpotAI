//! RAG (Retrieval-Augmented Generation) module for local document indexing and QA.
//!
//! This module provides:
//! - Document ingestion from PDF, TXT, MD, RS, PY files
//! - Text chunking with smart splitting for code and markdown
//! - Vector embeddings using Ollama (nomic-embed-text) or hash-based fallback
//! - Semantic search over indexed documents with sqlite-vec
//! - Integration with Ollama/LLM providers for QA
//! - Full PDF support with pdf-extract

use reqwest::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sqlite_vec::sqlite3_vec_init;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once};
use text_splitter::{ChunkConfig, MarkdownSplitter, TextSplitter};
use tokio::sync::RwLock;

/// Supported file extensions for indexing
const SUPPORTED_EXTENSIONS: &[&str] =
    &["pdf", "txt", "md", "rs", "py", "toml", "json", "js", "ts"];

/// Embedding dimensions used for hash-fallback vectors (Ollama's
/// nomic-embed-text emits exactly 384 dims, so both paths stay compatible).
const EMBEDDING_DIMENSIONS: usize = 384;

/// sqlite-vec registers itself as a SQLite auto-extension, which must happen
/// exactly once per process before any connection is opened.
static REGISTER_SQLITE_VEC: Once = Once::new();

fn register_sqlite_vec() {
    REGISTER_SQLITE_VEC.call_once(|| {
        // SAFETY: sqlite3_auto_extension stores a raw pointer to the C-compatible
        // init function (it takes the SQLite api-routines struct, which is why the
        // declaration here is a 0-arg extern fn); the module is never unloaded.
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite3_vec_init as *const (),
            )));
        }
    });
}

/// App-level chunk configuration (separate from text_splitter::ChunkConfig)
#[derive(Debug, Clone)]
pub struct RagChunkConfig {
    pub max_chunk_size: usize,
    pub chunk_overlap: usize,
}

impl Default for RagChunkConfig {
    fn default() -> Self {
        Self {
            max_chunk_size: 512,
            chunk_overlap: 50,
        }
    }
}

/// Metadata for each chunk
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChunkMetadata {
    pub file_type: String,
    pub file_size: u64,
    pub created_at: i64,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
}

/// Search result from RAG query
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub chunk_id: String,
    pub document_path: String,
    pub content: String,
    pub similarity: f32,
    pub metadata: ChunkMetadata,
}

/// Query result for RAG
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagQueryResult {
    pub results: Vec<SearchResult>,
    pub query: String,
    pub total_chunks_searched: usize,
}

/// Statistics about the RAG index
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagStats {
    pub document_count: usize,
    pub chunk_count: usize,
}

/// State for the RAG system. `rusqlite::Connection` is Send but not Sync, so
/// it lives behind a plain `std::sync::Mutex` (Send + Sync) instead of a tokio
/// RwLock; every SQL statement locks briefly and never across an `.await`.
pub struct RagState {
    db_path: RwLock<Option<PathBuf>>,
    conn: Mutex<Option<Connection>>,
    config: RwLock<RagChunkConfig>,
    ollama_host: RwLock<String>,
    client: Client,
}

impl RagState {
    pub fn new() -> Self {
        Self {
            db_path: RwLock::new(None),
            conn: Mutex::new(None),
            config: RwLock::new(RagChunkConfig::default()),
            ollama_host: RwLock::new("http://127.0.0.1:11434".to_string()),
            client: Client::new(),
        }
    }

    /// Runs a closure against the open database connection. The lock guard is
    /// scoped to the closure, so no guard is ever held across an `.await`.
    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "RAG database lock poisoned".to_string())?;
        let conn = guard
            .as_ref()
            .ok_or_else(|| "RAG database not initialized".to_string())?;
        f(conn)
    }

    /// Initialize the RAG database at the specified path
    pub async fn initialize(&self, app_data_dir: &Path) -> Result<(), String> {
        register_sqlite_vec();

        let db_path = app_data_dir.join("rag_documents.db");

        // Load or create database (auto-extension already registered above).
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {e}"))?;

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                file_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                chunk_count INTEGER DEFAULT 0
            )",
            [],
        )
        .map_err(|e| format!("Failed to create documents table: {e}"))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding BLOB NOT NULL,
                line_start INTEGER,
                line_end INTEGER,
                FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
            )",
            [],
        )
        .map_err(|e| format!("Failed to create chunks table: {e}"))?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id)",
            [],
        )
        .map_err(|e| format!("Failed to create index: {e}"))?;

        *self.db_path.write().await = Some(db_path);
        *self
            .conn
            .lock()
            .map_err(|_| "RAG database lock poisoned".to_string())? = Some(conn);

        tracing::info!("RAG database initialized at {:?}", self.db_path.read().await);
        Ok(())
    }

    /// Generate embedding for text using Ollama's nomic-embed-text model.
    /// Falls back to a deterministic hash-based vector when Ollama is offline.
    async fn generate_embedding(&self, text: &str) -> Vec<f32> {
        let ollama_host = self.ollama_host.read().await.clone();
        match self.generate_embedding_ollama(&ollama_host, text).await {
            Ok(embedding) => embedding,
            Err(err) => {
                tracing::warn!("Ollama embedding failed ({err}), using hash fallback");
                self.generate_embedding_hash(text, EMBEDDING_DIMENSIONS)
            }
        }
    }

    /// Generate embedding using Ollama's nomic-embed-text model
    async fn generate_embedding_ollama(&self, host: &str, text: &str) -> Result<Vec<f32>, String> {
        #[derive(Serialize)]
        struct EmbedRequest {
            model: &'static str,
            prompt: String,
        }

        #[derive(Deserialize)]
        struct EmbedResponse {
            embedding: Vec<f32>,
        }

        let request = EmbedRequest {
            model: "nomic-embed-text",
            prompt: text.to_string(),
        };

        let url = format!("{}/api/embeddings", host.trim_end_matches('/'));

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Ollama request failed: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("Ollama returned status: {}", response.status()));
        }

        let embed_response: EmbedResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {e}"))?;

        Ok(embed_response.embedding)
    }

    /// Hash-based embedding fallback (deterministic, normalized)
    fn generate_embedding_hash(&self, text: &str, dimensions: usize) -> Vec<f32> {
        let mut embedding = vec![0.0f32; dimensions];
        for (i, ch) in text.chars().enumerate() {
            let hash = (ch as u32).wrapping_mul(31).wrapping_add(i as u32);
            embedding[i % dimensions] = ((hash as f32 / u32::MAX as f32) - 0.5) * 2.0;
        }
        // Normalize
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in &mut embedding {
                *x /= norm;
            }
        }
        embedding
    }

    /// Split text into chunks based on file type (text-splitter 0.13 API:
    /// `ChunkConfig::with_overlap` returns a `Result`).
    fn split_text(
        &self,
        text: &str,
        file_type: &str,
        config: &RagChunkConfig,
    ) -> Result<Vec<(String, Option<usize>, Option<usize>)>, String> {
        let base = ChunkConfig::new(config.max_chunk_size)
            .with_overlap(config.chunk_overlap)
            .map_err(|e| format!("Invalid chunk config: {e}"))?;

        match file_type {
            "md" | "markdown" => {
                let md_splitter = MarkdownSplitter::new(base);
                Ok(md_splitter
                    .chunks(text)
                    .enumerate()
                    .map(|(i, chunk)| (chunk.to_string(), Some(i * 10), Some((i + 1) * 10)))
                    .collect())
            }
            // Code files use the plain splitter too: tree-sitter grammars would
            // add heavy per-language deps for marginal gains on this feature.
            "rs" | "py" | "js" | "ts" => {
                let splitter = TextSplitter::new(base);
                Ok(splitter
                    .chunks(text)
                    .enumerate()
                    .map(|(i, chunk)| (chunk.to_string(), Some(i * 10), Some((i + 1) * 10)))
                    .collect())
            }
            _ => {
                let splitter = TextSplitter::new(base);
                Ok(splitter
                    .chunks(text)
                    .enumerate()
                    .map(|(_, chunk)| (chunk.to_string(), None, None))
                    .collect())
            }
        }
    }

    /// Extract text from PDF files
    fn extract_pdf_text(&self, file_path: &Path) -> Result<String, String> {
        use std::io::Read;

        let mut file =
            std::fs::File::open(file_path).map_err(|e| format!("Failed to open PDF: {e}"))?;

        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|e| format!("Failed to read PDF: {e}"))?;

        // pdf-extract's `extract_text_from_mem` works on bytes (the `extract_text`
        // variant takes a path).
        pdf_extract::extract_text_from_mem(&buffer)
            .map_err(|e| format!("Failed to extract PDF text: {e}"))
    }

    /// Index a single file
    pub async fn index_file(&self, file_path: &Path) -> Result<usize, String> {
        if !file_path.exists() {
            return Err(format!("File does not exist: {:?}", file_path));
        }

        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .ok_or_else(|| "File has no extension".to_string())?;

        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            return Err(format!("Unsupported file type: {ext}"));
        }

        // Read file content with special handling for PDFs
        let content = if ext == "pdf" {
            self.extract_pdf_text(file_path)?
        } else {
            fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {e}"))?
        };

        let file_size = content.len() as u64;
        let file_type = ext.clone();
        let doc_id = format!(
            "doc_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let doc_path = file_path.to_string_lossy().to_string();
        let indexed_at = chrono::Utc::now().timestamp();

        // Insert document record (no await while the connection is locked)
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO documents (id, path, file_type, file_size, indexed_at, chunk_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![doc_id, doc_path, file_type, file_size, indexed_at, 0],
            )
            .map_err(|e| format!("Failed to insert document: {e}"))?;
            Ok(())
        })?;

        // Split text into chunks
        let config = self.config.read().await;
        let chunks = self.split_text(&content, &ext, &config)?;

        let mut chunk_count = 0;
        for (chunk_idx, (chunk_content, line_start, line_end)) in chunks.iter().enumerate() {
            let chunk_id = format!("{doc_id}_chunk_{chunk_idx}");
            // Embedding generation is async (Ollama) — run it without holding
            // the connection lock.
            let embedding = self.generate_embedding(chunk_content).await;

            let embedding_bytes: Vec<u8> = embedding
                .iter()
                .flat_map(|x| x.to_le_bytes())
                .collect();

            self.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO chunks (id, document_id, chunk_index, content, embedding, line_start, line_end)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        chunk_id,
                        doc_id,
                        chunk_idx,
                        chunk_content,
                        embedding_bytes,
                        line_start.map(|l| l as i64),
                        line_end.map(|l| l as i64)
                    ],
                )
                .map_err(|e| format!("Failed to insert chunk: {e}"))?;
                Ok(())
            })?;

            chunk_count += 1;
        }

        // Update document chunk count
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE documents SET chunk_count = ?1 WHERE id = ?2",
                params![chunk_count, doc_id],
            )
            .map_err(|e| format!("Failed to update document: {e}"))?;
            Ok(())
        })?;

        Ok(chunk_count)
    }

    /// Index multiple files sequentially (embeddings hit Ollama, which is
    /// request-based, so a simple loop keeps the host and ordering predictable).
    pub async fn index_files(&self, file_paths: &[PathBuf]) -> Result<HashMap<String, usize>, String> {
        let mut indexed = HashMap::new();
        for path in file_paths {
            match self.index_file(path).await {
                Ok(count) => {
                    indexed.insert(path.to_string_lossy().to_string(), count);
                }
                Err(e) => {
                    tracing::warn!("Failed to index {:?}: {e}", path);
                }
            }
        }
        Ok(indexed)
    }

    /// Search for relevant chunks using vector similarity
    pub async fn search(&self, query: &str, top_k: usize) -> Result<Vec<SearchResult>, String> {
        // Generate query embedding using Ollama (async, before locking)
        let query_embedding = self.generate_embedding(query).await;
        let embedding_blob: Vec<u8> = query_embedding
            .iter()
            .flat_map(|x| x.to_le_bytes())
            .collect();

        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT c.id, c.document_id, c.content, c.line_start, c.line_end,
                            d.path, d.file_type, d.file_size, d.indexed_at,
                            vec_distance_cosine(c.embedding, ?1) as similarity
                     FROM chunks c
                     JOIN documents d ON c.document_id = d.id
                     ORDER BY similarity ASC
                     LIMIT ?2",
                )
                .map_err(|e| format!("Failed to prepare search query: {e}"))?;

            let results = stmt
                .query_map(params![embedding_blob, top_k], |row| {
                    let similarity: f64 = row.get("similarity")?;
                    // Convert distance to similarity (cosine distance = 1 - cosine similarity)
                    let similarity = (1.0 - similarity) as f32;

                    Ok(SearchResult {
                        chunk_id: row.get("id")?,
                        document_path: row.get("path")?,
                        content: row.get("content")?,
                        similarity,
                        metadata: ChunkMetadata {
                            file_type: row.get("file_type")?,
                            file_size: row.get("file_size")?,
                            created_at: row.get("indexed_at")?,
                            line_start: row.get::<_, Option<i64>>("line_start")?.map(|l| l as usize),
                            line_end: row.get::<_, Option<i64>>("line_end")?.map(|l| l as usize),
                        },
                    })
                })
                .map_err(|e| format!("Failed to execute search: {e}"))?;

            let mut search_results = Vec::new();
            for result in results {
                search_results.push(result.map_err(|e| format!("Failed to read result: {e}"))?);
            }
            Ok(search_results)
        })
    }

    /// Perform a RAG query: search + format context for LLM
    pub async fn query(&self, user_query: &str, top_k: usize) -> Result<RagQueryResult, String> {
        let search_results = self.search(user_query, top_k).await?;
        let total_chunks = search_results.len();

        Ok(RagQueryResult {
            results: search_results,
            query: user_query.to_string(),
            total_chunks_searched: total_chunks,
        })
    }

    /// Get statistics about indexed documents
    pub async fn get_stats(&self) -> Result<RagStats, String> {
        self.with_conn(|conn| {
            let doc_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
                .map_err(|e| format!("Failed to count documents: {e}"))?;

            let chunk_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
                .map_err(|e| format!("Failed to count chunks: {e}"))?;

            Ok(RagStats {
                document_count: doc_count as usize,
                chunk_count: chunk_count as usize,
            })
        })
    }

    /// Remove a document and its chunks from the index
    pub async fn remove_document(&self, doc_path: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM documents WHERE path = ?1", params![doc_path])
                .map_err(|e| format!("Failed to remove document: {e}"))?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spotai_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[tokio::test]
    async fn index_search_remove_roundtrip() {
        let state = RagState::new();
        let dir = test_dir("rag_roundtrip");
        let file = dir.join("sample.md");
        std::fs::write(
            &file,
            "# Sample\n\nThis document talks about the Rust programming language and local vector databases.",
        )
        .expect("write sample");

        state.initialize(&dir).await.expect("init db");

        let count = state.index_file(&file).await.expect("index file");
        assert!(count >= 1, "expected at least one chunk");

        let stats = state.get_stats().await.expect("stats");
        assert_eq!(stats.document_count, 1);
        assert_eq!(stats.chunk_count, count);

        // Ollama is offline in CI: the hash fallback must still return matches.
        let results = state.search("rust vector database", 5).await.expect("search");
        assert!(!results.is_empty(), "search should return chunks");
        assert_eq!(results[0].document_path, file.to_string_lossy());

        state
            .remove_document(&file.to_string_lossy())
            .await
            .expect("remove");
        let stats = state.get_stats().await.expect("stats after remove");
        assert_eq!(stats.document_count, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn unsupported_file_is_rejected() {
        let state = RagState::new();
        let dir = test_dir("rag_unsupported");
        let file = dir.join("notes.docx");
        std::fs::write(&file, "not supported").expect("write");
        state.initialize(&dir).await.expect("init db");
        assert!(state.index_file(&file).await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

