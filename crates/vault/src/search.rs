//! Hybrid search: BM25 + vector with reciprocal rank fusion.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub applet_id: Option<String>,
}

fn default_limit() -> usize {
    10
}
