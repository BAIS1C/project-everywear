//! ew-vault: hybrid search engine for local knowledge.
//!
//! Combines Tantivy (BM25 full-text) with LanceDB (vector/embedding)
//! for RAG retrieval. Used by Kasai and Mymories applets.
//!
//! Architecture:
//! - Tantivy index for keyword/BM25 search
//! - LanceDB for vector similarity (embeddings from local model)
//! - Reciprocal rank fusion to merge results
//! - All data stays local; no cloud calls

pub mod index;
pub mod schema;
pub mod search;

pub use index::{item_file_size, item_favorite, item_id, MediaFilter, SortField, VaultIndex};
pub use schema::{AudioDocument, ImageDocument, VaultItem, VideoDocument};
pub use search::SearchRequest;
