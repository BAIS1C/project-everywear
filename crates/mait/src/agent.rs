//! Agent identity: composed from trait shards.

use crate::shard::MaitManifest;
use serde::{Deserialize, Serialize};

/// A composed agent identity that can be handed to Kasai or NPC runtimes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentIdentity {
    pub manifest: MaitManifest,
    #[serde(default)]
    pub active_shard_ids: Vec<String>,
}

impl AgentIdentity {
    pub fn from_manifest(manifest: MaitManifest) -> Self {
        let active_shard_ids = manifest
            .aesthetic_shards
            .iter()
            .map(|shard| shard.id().to_string())
            .collect();

        Self {
            manifest,
            active_shard_ids,
        }
    }
}
